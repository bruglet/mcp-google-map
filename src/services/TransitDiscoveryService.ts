import { GroundingLiteService, GroundingLocationBias } from "./GroundingLiteService.js";
import { GoogleMapsTools } from "./toolclass.js";
import { NewPlacesService } from "./NewPlacesService.js";
import { RoutesService, TransitPreference } from "./RoutesService.js";
import {
  computeBoundedTransitMatrix,
  inferredTransitPreference,
  scoreItinerary,
  getTransitTimingError,
  TransitTimingError,
  TransitItineraryService,
} from "./TransitItineraryService.js";
import { PlannerMode, plannerLimits } from "./costPolicy.js";
import { createPlaceUrl } from "./mapsUrlService.js";
import { LocationInput, parseLocationInput } from "./location.js";

const DISCOVERY_BIAS_RADIUS_METERS = 25_000;

interface DiscoveryBias {
  lat: number;
  lng: number;
  radius: number;
}

interface DiscoveryResult {
  candidates: TransitPlaceCandidate[];
  groundingUnavailable: boolean;
}

export interface TransitPlaceCandidate {
  name: string;
  placeId?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  googleMapsUrl?: string;
  coarseDurationSeconds?: number;
  exactItinerary?: unknown;
}

export class TransitDiscoveryService {
  constructor(private readonly apiKey?: string) {}

  async findPlacesByTransit(params: {
    origin: string;
    originInput?: LocationInput;
    query: string;
    departureTime?: Date;
    objective?: "fastest" | "fewest_transfers" | "least_walking" | "balanced";
    plannerMode?: PlannerMode;
    maxMinutes?: number;
  }): Promise<any> {
    const placesService = new NewPlacesService(this.apiKey);
    const discoveryBias = await this.resolveDiscoveryBias(
      params.originInput || parseLocationInput(params.origin),
      placesService,
      "maps_find_places_by_transit"
    );
    const discovery = await this.discover(
      params.query,
      params.plannerMode,
      "maps_find_places_by_transit",
      discoveryBias,
      placesService
    );
    const candidates = discovery.candidates;
    if (!candidates.length) throw new Error(`No places found for "${params.query}".`);
    const routes = new RoutesService(this.apiKey);
    const itinerary = new TransitItineraryService(routes);
    const effectiveTransitPreference = inferredTransitPreference(params.objective);
    const selected = candidates.slice(0, plannerLimits(params.plannerMode).candidatesPerGroup);
    const destinations = selected.map((candidate) => locationString(candidate));
    const matrix = await computeBoundedTransitMatrix(
      routes,
      {
        origins: [params.origin],
        destinations,
        departureTime: params.departureTime,
        transitPreference: effectiveTransitPreference,
        parentTool: "maps_find_places_by_transit",
      },
      plannerLimits(params.plannerMode).matrixElements
    );
    const matrixUnavailableCount = selected.filter(
      (_candidate, index) => matrix.durations[0]?.[index]?.value == null
    ).length;
    const ranked = selected
      .map((candidate, index) => ({ ...candidate, coarseDurationSeconds: matrix.durations[0]?.[index]?.value ?? null }))
      .filter((candidate) => candidate.coarseDurationSeconds !== null)
      .filter(
        (candidate) => params.maxMinutes === undefined || candidate.coarseDurationSeconds! <= params.maxMinutes * 60
      )
      .sort((left, right) => scoreCandidate(left, right, params.objective || "fastest"));
    const finalistPool = ranked.slice(0, plannerLimits(params.plannerMode).exactRoutes);
    const finalists: TransitPlaceCandidate[] = [];
    const invalidFinalists: Array<TransitPlaceCandidate & { timingError: TransitTimingError }> = [];
    const warnings: string[] = [
      ...(discovery.groundingUnavailable
        ? ["Semantic Grounding discovery was unavailable; literal Places results were used."]
        : []),
      ...(matrixUnavailableCount
        ? [
            `Transit Matrix found no route for ${matrixUnavailableCount} of ${selected.length} discovered candidates at the requested departure time.`,
          ]
        : []),
    ];
    for (const candidate of finalistPool) {
      const hydrated = await this.hydrateCandidate(candidate, placesService, "maps_find_places_by_transit");
      if (!isCompleteCandidateIdentity(hydrated)) {
        warnings.push("A shortlisted place was omitted because Google did not return a human-readable identity.");
        continue;
      }
      try {
        hydrated.exactItinerary = await itinerary.routeFixedPath({
          locations: [params.origin, locationString(hydrated)],
          departureTime: params.departureTime,
          objective: params.objective,
          plannerMode: params.plannerMode,
          parentTool: "maps_find_places_by_transit",
        });
        if (
          params.maxMinutes !== undefined &&
          (hydrated.exactItinerary as any).totalElapsedSeconds > params.maxMinutes * 60
        ) {
          warnings.push(
            `A candidate was omitted because its exact transit time exceeded ${params.maxMinutes} minutes.`
          );
          continue;
        }
        finalists.push(hydrated);
      } catch (error) {
        const timingError = getTransitTimingError(error);
        if (!timingError) throw error;
        invalidFinalists.push({ ...hydrated, timingError });
      }
    }
    finalists.sort(
      (left, right) =>
        scoreItinerary(left.exactItinerary as any, params.objective || "fastest") -
        scoreItinerary(right.exactItinerary as any, params.objective || "fastest")
    );
    if (invalidFinalists.length) {
      warnings.push(
        `${invalidFinalists.length} exact finalist(s) were excluded because Google returned invalid chronology; their exact times were not verified against max_minutes.`
      );
      if (!finalists.length) warnings.push("No transit itinerary could be ranked safely from the exact finalists.");
    }
    return {
      query: params.query,
      origin: params.origin,
      candidates: finalists,
      invalidFinalists,
      warnings: [
        ...(ranked.length > finalistPool.length
          ? [`${ranked.length - finalistPool.length} candidates were not exact-routed due to the planner guard.`]
          : []),
        ...warnings,
      ],
    };
  }

  async optimizeErrands(params: {
    origin: string;
    originInput?: LocationInput;
    errands: Array<{ query?: string; location?: string; dwell_minutes?: number }>;
    finalDestination?: string;
    returnToOrigin?: boolean;
    departureTime?: Date;
    objective?: "fastest" | "fewest_transfers" | "least_walking" | "balanced";
    plannerMode?: PlannerMode;
  }): Promise<any> {
    if (!params.errands.length) throw new Error("At least one errand is required.");
    const mode = params.plannerMode || "conservative";
    const limits = plannerLimits(mode);
    const discoveryQueries = new Set(
      params.errands.filter((errand) => !errand.location && errand.query).map((errand) => errand.query as string)
    );
    if (discoveryQueries.size > limits.groundingSearches)
      throw new Error(
        `Errand planning projects ${discoveryQueries.size} Grounding Lite searches; the ${mode} planner limit is ${limits.groundingSearches}.`
      );
    const placesService = new NewPlacesService(this.apiKey);
    const discoveryBias = discoveryQueries.size
      ? await this.resolveDiscoveryBias(
          params.originInput || parseLocationInput(params.origin),
          placesService,
          "maps_optimize_transit_errands"
        )
      : undefined;
    const discoveryCache = new Map<string, Promise<DiscoveryResult>>();
    const discoverOnce = (query: string) => {
      const cached = discoveryCache.get(query);
      if (cached) return cached;
      const request = this.discover(query, mode, "maps_optimize_transit_errands", discoveryBias, placesService);
      discoveryCache.set(query, request);
      return request;
    };
    const groups: TransitPlaceCandidate[][] = [];
    let groundingUnavailable = false;
    for (const errand of params.errands) {
      if (errand.location) groups.push([{ name: errand.location, address: errand.location }]);
      else if (errand.query) {
        const discovery = await discoverOnce(errand.query);
        groundingUnavailable ||= discovery.groundingUnavailable;
        groups.push(discovery.candidates.slice(0, Math.min(4, limits.candidatesPerGroup)));
      } else throw new Error("Each errand needs either query or location.");
    }
    if (groups.some((group) => !group.length)) throw new Error("At least one errand has no candidate locations.");
    const finalDestination = params.finalDestination || (params.returnToOrigin ? params.origin : undefined);
    const effectiveTransitPreference = inferredTransitPreference(params.objective);
    const initialCandidateCounts = groups.map((group) => group.length);
    const reduction = trimErrandCandidateGroups(
      groups,
      params.errands.map((errand) => !errand.location),
      params.origin,
      finalDestination,
      limits.matrixElements
    );
    const trimmedGroups = reduction.groups;
    const matrixEdges = reduction.matrixEdges;
    console.error(
      `[COST PLAN] ${"maps_optimize_transit_errands"} projects ${matrixEdges.length} transit matrix elements after reducing ${reduction.removedCandidateCounts.reduce((sum, count) => sum + count, 0)} candidates from an initial projection of ${reduction.initialMatrixElements}.`
    );
    if (matrixEdges.length > limits.matrixElements)
      throw new Error(
        `Errand planner projects ${matrixEdges.length} matrix elements; the ${mode} planner limit is ${limits.matrixElements}.`
      );
    const durations = await computeTargetedTransitDurations(
      new RoutesService(this.apiKey),
      matrixEdges,
      params.departureTime,
      "maps_optimize_transit_errands",
      effectiveTransitPreference
    );
    const coarse = beamErrandOrders(trimmedGroups, params.origin, finalDestination, durations, mode).slice(
      0,
      limits.exactRoutes
    );
    const exact: any[] = [];
    const invalidFinalists: Array<{
      order: Array<{ groupIndex: number; location: string }>;
      timingError: TransitTimingError;
    }> = [];
    const itinerary = new TransitItineraryService(new RoutesService(this.apiKey));
    for (const candidate of coarse) {
      const locations = [
        params.origin,
        ...candidate.order.map((choice) => locationString(choice.candidate)),
        ...(finalDestination ? [finalDestination] : []),
      ];
      const order = candidate.order.map((choice) => ({
        groupIndex: choice.groupIndex,
        location: locationString(choice.candidate),
      }));
      try {
        exact.push({
          order,
          itinerary: await itinerary.routeFixedPath({
            locations,
            departureTime: params.departureTime,
            objective: params.objective,
            dwellMinutes: candidate.order.map((choice) => params.errands[choice.groupIndex].dwell_minutes || 0),
            transitPreference: effectiveTransitPreference,
            plannerMode: params.plannerMode,
            parentTool: "maps_optimize_transit_errands",
          }),
        });
      } catch (error) {
        const timingError = getTransitTimingError(error);
        if (!timingError) throw error;
        invalidFinalists.push({ order, timingError });
      }
    }
    exact.sort(
      (left, right) =>
        scoreItinerary(left.itinerary, params.objective || "fastest") -
        scoreItinerary(right.itinerary, params.objective || "fastest")
    );
    const warnings = [
      ...(groundingUnavailable
        ? ["Semantic Grounding discovery was unavailable; literal Places results were used."]
        : []),
      ...(invalidFinalists.length
        ? [
            `${invalidFinalists.length} exact finalist(s) were excluded because Google returned invalid chronology.`,
            ...(exact.length ? [] : ["No transit itinerary could be ranked safely from the exact finalists."]),
          ]
        : []),
    ];
    return {
      selected: exact[0] || null,
      alternatives: exact.slice(1, 3),
      invalidFinalists,
      warnings,
      candidateCounts: trimmedGroups.map((group) => group.length),
      matrixElements: matrixEdges.length,
      guardReductions: {
        plannerMode: mode,
        exactItineraries: coarse.length,
        maxCandidatesPerErrand: Math.min(4, limits.candidatesPerGroup),
        initialCandidateCounts,
        finalCandidateCounts: trimmedGroups.map((group) => group.length),
        removedCandidateCounts: reduction.removedCandidateCounts,
        initialMatrixElements: reduction.initialMatrixElements,
        finalMatrixElements: matrixEdges.length,
      },
    };
  }

  private async discover(
    query: string,
    mode: PlannerMode = "conservative",
    parentTool = "maps_find_places_by_transit",
    locationBias?: DiscoveryBias,
    placesService = new NewPlacesService(this.apiKey)
  ): Promise<DiscoveryResult> {
    const groundedCandidates: TransitPlaceCandidate[] = [];
    let groundingUnavailable = false;
    try {
      const grounded = await new GroundingLiteService(this.apiKey).searchPlaces(
        query,
        parentTool,
        locationBias ? toGroundingLocationBias(locationBias) : undefined
      );
      groundedCandidates.push(...extractGroundedPlaces(grounded).slice(0, plannerLimits(mode).candidatesPerGroup));
    } catch {
      groundingUnavailable = true;
    }

    const places = await placesService.searchText({
      textQuery: query,
      locationBias,
      maxResultCount: plannerLimits(mode).candidatesPerGroup,
      parentTool,
    });
    const placeCandidates = places.map(candidateFromPlace);
    const candidates = mergeCandidates([...placeCandidates, ...groundedCandidates])
      .sort((left, right) => compareDiscoveryDistance(left, right, locationBias))
      .slice(0, plannerLimits(mode).candidatesPerGroup);
    if (!candidates.length && groundingUnavailable)
      throw new Error(
        `No places found for "${query}": semantic Grounding discovery was unavailable and literal Places returned no candidates.`
      );
    return { candidates, groundingUnavailable };
  }

  private async resolveDiscoveryBias(
    originInput: LocationInput,
    placesService: NewPlacesService,
    parentTool: string
  ): Promise<DiscoveryBias> {
    if (originInput.kind === "coordinates")
      return { lat: originInput.latitude, lng: originInput.longitude, radius: DISCOVERY_BIAS_RADIUS_METERS };

    if (originInput.kind === "place_id") {
      const place = await placesService.getPlaceDetails(originInput.value, [], parentTool);
      const coordinates = coordinatesFromPlace(place);
      if (coordinates) return { ...coordinates, radius: DISCOVERY_BIAS_RADIUS_METERS };
      throw new Error("The transit origin Place ID did not return coordinates for discovery bias.");
    }

    if (originInput.kind === "query") {
      const result = await new GoogleMapsTools(this.apiKey).geocode(originInput.value, parentTool);
      if (result.location)
        return { lat: result.location.lat, lng: result.location.lng, radius: DISCOVERY_BIAS_RADIUS_METERS };
    }

    throw new Error("The transit origin could not be converted to coordinates for discovery bias.");
  }

  private async hydrateCandidate(
    candidate: TransitPlaceCandidate,
    placesService: NewPlacesService,
    parentTool: string
  ): Promise<TransitPlaceCandidate> {
    if (!needsCandidateHydration(candidate)) return withLocalPlaceUrl(candidate);
    if (!candidate.placeId) return candidate;
    try {
      return withLocalPlaceUrl(
        mergeCandidate(
          candidate,
          candidateFromPlace(await placesService.getPlaceDetails(candidate.placeId, [], parentTool))
        )
      );
    } catch {
      return candidate;
    }
  }
}

function locationString(candidate: TransitPlaceCandidate): string {
  if (candidate.placeId) return `place_id:${candidate.placeId}`;
  if (candidate.latitude !== undefined && candidate.longitude !== undefined)
    return `${candidate.latitude},${candidate.longitude}`;
  return candidate.address || candidate.name;
}

function toGroundingLocationBias(locationBias: DiscoveryBias): GroundingLocationBias {
  return {
    circle: {
      center: { latitude: locationBias.lat, longitude: locationBias.lng },
      radius_meters: locationBias.radius,
    },
  };
}

function candidateFromPlace(place: any): TransitPlaceCandidate {
  return withLocalPlaceUrl({
    name: typeof place.name === "string" ? place.name : "",
    placeId: typeof place.place_id === "string" ? place.place_id : undefined,
    address: typeof place.formatted_address === "string" ? place.formatted_address : undefined,
    latitude: place.geometry?.location?.lat,
    longitude: place.geometry?.location?.lng,
  });
}

function coordinatesFromPlace(place: any): { lat: number; lng: number } | undefined {
  const latitude = place?.geometry?.location?.lat;
  const longitude = place?.geometry?.location?.lng;
  return typeof latitude === "number" && typeof longitude === "number" ? { lat: latitude, lng: longitude } : undefined;
}

function withLocalPlaceUrl(candidate: TransitPlaceCandidate): TransitPlaceCandidate {
  candidate.googleMapsUrl = createPlaceUrl({
    label: candidate.name || candidate.address,
    address: candidate.address,
    placeId: candidate.placeId,
    coordinates:
      candidate.latitude !== undefined && candidate.longitude !== undefined
        ? { latitude: candidate.latitude, longitude: candidate.longitude }
        : undefined,
  });
  return candidate;
}

function mergeCandidate(existing: TransitPlaceCandidate, incoming: TransitPlaceCandidate): TransitPlaceCandidate {
  const merged = { ...existing };
  for (const key of ["name", "placeId", "address", "latitude", "longitude", "googleMapsUrl"] as const) {
    const value = incoming[key];
    if (
      value !== undefined &&
      value !== null &&
      value !== "" &&
      (merged[key] === undefined || merged[key] === null || merged[key] === "")
    )
      merged[key] = value as never;
  }
  return withLocalPlaceUrl(merged);
}

function mergeCandidates(candidates: TransitPlaceCandidate[]): TransitPlaceCandidate[] {
  const merged = new Map<string, TransitPlaceCandidate>();
  for (const candidate of candidates) {
    const key = candidate.placeId
      ? `place:${candidate.placeId}`
      : `candidate:${candidate.name}|${candidate.address}|${candidate.latitude}|${candidate.longitude}`;
    const existing = merged.get(key);
    merged.set(key, existing ? mergeCandidate(existing, candidate) : withLocalPlaceUrl({ ...candidate }));
  }
  return [...merged.values()];
}

function isCompleteCandidateIdentity(candidate: TransitPlaceCandidate): boolean {
  return Boolean(
    candidate.placeId && candidate.name && candidate.name !== candidate.placeId && !candidate.name.startsWith("places/")
  );
}

function needsCandidateHydration(candidate: TransitPlaceCandidate): boolean {
  return (
    !isCompleteCandidateIdentity(candidate) ||
    !candidate.address ||
    candidate.latitude === undefined ||
    candidate.longitude === undefined
  );
}

function compareDiscoveryDistance(
  left: TransitPlaceCandidate,
  right: TransitPlaceCandidate,
  origin?: DiscoveryBias
): number {
  const leftDistance = origin && distanceMeters(left, origin);
  const rightDistance = origin && distanceMeters(right, origin);
  if (leftDistance !== undefined && rightDistance !== undefined) return leftDistance - rightDistance;
  if (leftDistance !== undefined) return -1;
  if (rightDistance !== undefined) return 1;
  return left.name.localeCompare(right.name);
}

function distanceMeters(candidate: TransitPlaceCandidate, origin: DiscoveryBias): number | undefined {
  if (candidate.latitude === undefined || candidate.longitude === undefined) return undefined;
  const earthRadiusMeters = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(candidate.latitude - origin.lat);
  const longitudeDelta = toRadians(candidate.longitude - origin.lng);
  const latitudeOne = toRadians(origin.lat);
  const latitudeTwo = toRadians(candidate.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeOne) * Math.cos(latitudeTwo) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
}

function scoreCandidate(left: TransitPlaceCandidate, right: TransitPlaceCandidate, objective: string): number {
  return (
    (left.coarseDurationSeconds || Number.MAX_SAFE_INTEGER) -
      (right.coarseDurationSeconds || Number.MAX_SAFE_INTEGER) ||
    (objective === "fastest" ? left.name.localeCompare(right.name) : 0)
  );
}

function extractGroundedPlaces(value: any): TransitPlaceCandidate[] {
  const found: TransitPlaceCandidate[] = [];
  const seen = new Set<string>();
  for (const payload of structuredPayloads(value)) {
    const places = payload?.places;
    if (!Array.isArray(places)) continue;
    for (const node of places) {
      const placeId = normalizePlaceId(node?.place || node?.placeId || node?.place_id || node?.id);
      const name = node?.displayName?.text || node?.name || node?.display_name;
      const location = node?.location || node?.coordinates;
      const latitude = location?.latitude ?? location?.lat;
      const longitude = location?.longitude ?? location?.lng;
      if (!placeId && typeof name !== "string") continue;
      const key = String(placeId || `${name}|${latitude}|${longitude}`);
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(
        withLocalPlaceUrl({
          name: typeof name === "string" ? name : "",
          placeId,
          address: node?.formattedAddress || node?.formatted_address,
          latitude,
          longitude,
          googleMapsUrl: node?.googleMapsLinks?.placeUrl || node?.googleMapsLinks?.placeUri,
        })
      );
    }
  }
  return found;
}

function normalizePlaceId(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return value.startsWith("places/") ? value.slice("places/".length) : value;
}

function structuredPayloads(value: any): any[] {
  const payloads: any[] = [];
  if (value?.structuredContent) payloads.push(value.structuredContent);
  const content = value?.content;
  for (const block of Array.isArray(content) ? content : content ? [content] : []) {
    if (typeof block?.text !== "string") continue;
    try {
      payloads.push(JSON.parse(block.text));
    } catch {
      // Ignore non-JSON narrative blocks; structured place data is handled above.
    }
  }
  if (!payloads.length && value) payloads.push(value);
  return payloads;
}

interface ErrandChoice {
  groupIndex: number;
  candidate: TransitPlaceCandidate;
}

interface MatrixEdge {
  origin: string;
  destination: string;
}

function buildErrandMatrixEdges(
  origin: string,
  groups: TransitPlaceCandidate[][],
  finalDestination?: string
): MatrixEdge[] {
  const edges = new Map<string, MatrixEdge>();
  const add = (from: string, to: string) => {
    if (from === to) return;
    edges.set(`${from}\u0000${to}`, { origin: from, destination: to });
  };
  for (const group of groups) for (const candidate of group) add(origin, locationString(candidate));
  for (let fromGroup = 0; fromGroup < groups.length; fromGroup++)
    for (let toGroup = 0; toGroup < groups.length; toGroup++) {
      if (fromGroup === toGroup) continue;
      for (const from of groups[fromGroup])
        for (const to of groups[toGroup]) add(locationString(from), locationString(to));
    }
  if (finalDestination)
    for (const group of groups) for (const candidate of group) add(locationString(candidate), finalDestination);
  return [...edges.values()];
}

async function computeTargetedTransitDurations(
  routesService: RoutesService,
  edges: MatrixEdge[],
  departureTime?: Date,
  parentTool = "maps_distance_matrix",
  transitPreference?: TransitPreference
): Promise<Map<string, number>> {
  const durations = new Map<string, number>();
  const byOrigin = new Map<string, Set<string>>();
  for (const edge of edges) {
    const destinations = byOrigin.get(edge.origin) || new Set<string>();
    destinations.add(edge.destination);
    byOrigin.set(edge.origin, destinations);
  }
  for (const [origin, destinations] of byOrigin) {
    const values = [...destinations];
    for (let start = 0; start < values.length; start += 100) {
      const batch = values.slice(start, start + 100);
      const matrix = await routesService.computeRouteMatrix({
        origins: [origin],
        destinations: batch,
        mode: "transit",
        departureTime,
        transitPreference,
        parentTool,
      });
      for (let index = 0; index < batch.length; index++) {
        const seconds = matrix.durations[0]?.[index]?.value;
        if (typeof seconds === "number") durations.set(`${origin}\u0000${batch[index]}`, seconds);
      }
    }
  }
  return durations;
}

function trimErrandCandidateGroups(
  groups: TransitPlaceCandidate[][],
  reducibleGroups: boolean[],
  origin: string,
  finalDestination: string | undefined,
  maxElements: number
): {
  groups: TransitPlaceCandidate[][];
  matrixEdges: MatrixEdge[];
  initialMatrixElements: number;
  initialCandidateCounts: number[];
  removedCandidateCounts: number[];
} {
  const trimmedGroups = groups.map((group) => [...group]);
  const initialCandidateCounts = trimmedGroups.map((group) => group.length);
  const removedCandidateCounts = trimmedGroups.map(() => 0);
  const initialMatrixElements = buildErrandMatrixEdges(origin, trimmedGroups, finalDestination).length;
  let matrixEdges = buildErrandMatrixEdges(origin, trimmedGroups, finalDestination);

  while (matrixEdges.length > maxElements) {
    let groupToTrim = -1;
    for (let index = 0; index < trimmedGroups.length; index++) {
      if (!reducibleGroups[index] || trimmedGroups[index].length <= 1) continue;
      if (groupToTrim === -1 || trimmedGroups[index].length > trimmedGroups[groupToTrim].length) groupToTrim = index;
    }
    if (groupToTrim === -1) break;
    trimmedGroups[groupToTrim].pop();
    removedCandidateCounts[groupToTrim]++;
    matrixEdges = buildErrandMatrixEdges(origin, trimmedGroups, finalDestination);
  }

  return {
    groups: trimmedGroups,
    matrixEdges,
    initialMatrixElements,
    initialCandidateCounts,
    removedCandidateCounts,
  };
}

function beamErrandOrders(
  groups: TransitPlaceCandidate[][],
  origin: string,
  finalDestination: string | undefined,
  durations: Map<string, number>,
  mode: PlannerMode
): Array<{ order: ErrandChoice[]; score: number }> {
  const beamWidth = mode === "thorough" ? 64 : 32;
  let states: Array<{ order: ErrandChoice[]; remaining: number[]; score: number }> = [
    { order: [], remaining: groups.map((_, index) => index), score: 0 },
  ];
  while (states.some((state) => state.remaining.length)) {
    const next: Array<{ order: ErrandChoice[]; remaining: number[]; score: number }> = [];
    for (const state of states) {
      const from = state.order.length ? locationString(state.order.at(-1)!.candidate) : origin;
      for (const groupIndex of state.remaining) {
        for (const candidate of groups[groupIndex]) {
          const destination = locationString(candidate);
          const edge = durations.get(`${from}\u0000${destination}`) ?? Number.MAX_SAFE_INTEGER / 10;
          next.push({
            order: [...state.order, { groupIndex, candidate }],
            remaining: state.remaining.filter((index) => index !== groupIndex),
            score: state.score + edge,
          });
        }
      }
    }
    next.sort((left, right) => left.score - right.score || orderKey(left.order).localeCompare(orderKey(right.order)));
    states = next.slice(0, beamWidth);
  }
  return states
    .map((state) => ({
      order: state.order,
      score:
        state.score +
        (finalDestination
          ? (durations.get(`${locationString(state.order.at(-1)!.candidate)}\u0000${finalDestination}`) ??
            Number.MAX_SAFE_INTEGER / 10)
          : 0),
    }))
    .sort((left, right) => left.score - right.score || orderKey(left.order).localeCompare(orderKey(right.order)));
}

function orderKey(order: ErrandChoice[]): string {
  return order.map((choice) => `${choice.groupIndex}:${locationString(choice.candidate)}`).join("|");
}
