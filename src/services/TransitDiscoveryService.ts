import { GroundingLiteService } from "./GroundingLiteService.js";
import { NewPlacesService } from "./NewPlacesService.js";
import { RoutesService } from "./RoutesService.js";
import { computeBoundedTransitMatrix, scoreItinerary, TransitItineraryService } from "./TransitItineraryService.js";
import { PlannerMode, plannerLimits } from "./costPolicy.js";

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
    query: string;
    departureTime?: Date;
    objective?: "fastest" | "fewest_transfers" | "least_walking" | "balanced";
    plannerMode?: PlannerMode;
    maxMinutes?: number;
  }): Promise<any> {
    const candidates = await this.discover(params.query, params.plannerMode);
    if (!candidates.length) throw new Error(`No places found for "${params.query}".`);
    const routes = new RoutesService(this.apiKey);
    const itinerary = new TransitItineraryService(routes);
    const selected = candidates.slice(0, plannerLimits(params.plannerMode).candidatesPerGroup);
    const destinations = selected.map((candidate) => locationString(candidate));
    const matrix = await computeBoundedTransitMatrix(
      routes,
      {
        origins: [params.origin],
        destinations,
        departureTime: params.departureTime,
      },
      plannerLimits(params.plannerMode).matrixElements
    );
    const ranked = selected
      .map((candidate, index) => ({ ...candidate, coarseDurationSeconds: matrix.durations[0]?.[index]?.value ?? null }))
      .filter((candidate) => candidate.coarseDurationSeconds !== null)
      .filter(
        (candidate) => params.maxMinutes === undefined || candidate.coarseDurationSeconds! <= params.maxMinutes * 60
      )
      .sort((left, right) => scoreCandidate(left, right, params.objective || "fastest"));
    const finalists = ranked.slice(0, plannerLimits(params.plannerMode).exactRoutes);
    for (const candidate of finalists) {
      candidate.exactItinerary = await itinerary.routeFixedPath({
        locations: [params.origin, locationString(candidate)],
        departureTime: params.departureTime,
        objective: params.objective,
      });
    }
    finalists.sort(
      (left, right) =>
        scoreItinerary(left.exactItinerary as any, params.objective || "fastest") -
        scoreItinerary(right.exactItinerary as any, params.objective || "fastest")
    );
    return {
      query: params.query,
      origin: params.origin,
      candidates: finalists,
      warnings:
        ranked.length > finalists.length
          ? [`${ranked.length - finalists.length} candidates were not exact-routed due to the planner guard.`]
          : [],
    };
  }

  async optimizeErrands(params: {
    origin: string;
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
    const groups: TransitPlaceCandidate[][] = [];
    for (const errand of params.errands) {
      if (errand.location) groups.push([{ name: errand.location, address: errand.location }]);
      else if (errand.query)
        groups.push((await this.discover(errand.query, mode)).slice(0, Math.min(4, limits.candidatesPerGroup)));
      else throw new Error("Each errand needs either query or location.");
    }
    if (groups.some((group) => !group.length)) throw new Error("At least one errand has no candidate locations.");
    const finalDestination = params.finalDestination || (params.returnToOrigin ? params.origin : undefined);
    const matrixEdges = buildErrandMatrixEdges(params.origin, groups, finalDestination);
    console.error(
      `[COST PLAN] ${"maps_optimize_transit_errands"} projects ${matrixEdges.length} transit matrix elements before execution.`
    );
    if (matrixEdges.length > limits.matrixElements)
      throw new Error(
        `Errand planner projects ${matrixEdges.length} matrix elements; the ${mode} planner limit is ${limits.matrixElements}.`
      );
    const durations = await computeTargetedTransitDurations(
      new RoutesService(this.apiKey),
      matrixEdges,
      params.departureTime
    );
    const coarse = beamErrandOrders(groups, params.origin, finalDestination, durations, mode).slice(
      0,
      limits.exactRoutes
    );
    const exact: any[] = [];
    const itinerary = new TransitItineraryService(new RoutesService(this.apiKey));
    for (const candidate of coarse) {
      const locations = [
        params.origin,
        ...candidate.order.map((choice) => locationString(choice.candidate)),
        ...(finalDestination ? [finalDestination] : []),
      ];
      exact.push({
        order: candidate.order.map((choice) => ({
          groupIndex: choice.groupIndex,
          location: locationString(choice.candidate),
        })),
        itinerary: await itinerary.routeFixedPath({
          locations,
          departureTime: params.departureTime,
          objective: params.objective,
          dwellMinutes: candidate.order.map((choice) => params.errands[choice.groupIndex].dwell_minutes || 0),
        }),
      });
    }
    exact.sort(
      (left, right) =>
        scoreItinerary(left.itinerary, params.objective || "fastest") -
        scoreItinerary(right.itinerary, params.objective || "fastest")
    );
    return {
      selected: exact[0],
      alternatives: exact.slice(1, 3),
      candidateCounts: groups.map((group) => group.length),
      matrixElements: matrixEdges.length,
      guardReductions: {
        plannerMode: mode,
        exactItineraries: coarse.length,
        maxCandidatesPerErrand: Math.min(4, limits.candidatesPerGroup),
      },
    };
  }

  private async discover(query: string, mode: PlannerMode = "conservative"): Promise<TransitPlaceCandidate[]> {
    try {
      const grounded = await new GroundingLiteService(this.apiKey).searchPlaces(query);
      const parsed = extractGroundedPlaces(grounded);
      if (parsed.length) return parsed;
    } catch {
      // Places search is a deliberately minimal fallback when Grounding Lite is unavailable.
    }
    const places = await new NewPlacesService(this.apiKey).searchText({
      textQuery: query,
      maxResultCount: plannerLimits(mode).candidatesPerGroup,
    });
    return places.map((place: any) => ({
      name: place.name,
      placeId: place.place_id,
      address: place.formatted_address,
      latitude: place.geometry?.location?.lat,
      longitude: place.geometry?.location?.lng,
    }));
  }
}

function locationString(candidate: TransitPlaceCandidate): string {
  if (candidate.placeId) return `place_id:${candidate.placeId}`;
  if (candidate.latitude !== undefined && candidate.longitude !== undefined)
    return `${candidate.latitude},${candidate.longitude}`;
  return candidate.address || candidate.name;
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
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    const placeId = node.placeId || node.place_id || node.id;
    const name = node.name || node.displayName?.text || node.display_name;
    const location = node.location || node.coordinates;
    const latitude = location?.latitude ?? location?.lat;
    const longitude = location?.longitude ?? location?.lng;
    if (
      (placeId || name) &&
      (latitude !== undefined || node.formattedAddress || node.formatted_address || node.googleMapsLinks)
    ) {
      const key = String(placeId || `${name}|${latitude}|${longitude}`);
      if (!seen.has(key)) {
        seen.add(key);
        found.push({
          name: typeof name === "string" ? name : String(placeId),
          placeId,
          address: node.formattedAddress || node.formatted_address,
          latitude,
          longitude,
          googleMapsUrl: node.googleMapsLinks?.placeUrl || node.google_maps_url,
        });
      }
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return found;
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
  departureTime?: Date
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
      });
      for (let index = 0; index < batch.length; index++) {
        const seconds = matrix.durations[0]?.[index]?.value;
        if (typeof seconds === "number") durations.set(`${origin}\u0000${batch[index]}`, seconds);
      }
    }
  }
  return durations;
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
