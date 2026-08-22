import { RouteDetailLevel, RoutesService, TransitMode, TransitPreference, parseDuration } from "./RoutesService.js";
import { createDirectionsUrl } from "./mapsUrlService.js";
import { plannerLimits, PlannerMode } from "./costPolicy.js";
import { recordRequest } from "./requestAccounting.js";

export interface TransitLeg {
  from: string;
  to: string;
  durationSeconds: number;
  arrivalTime: string;
  departureTime: string;
  firstTransitDepartureTime?: string;
  lastTransitArrivalTime?: string;
  transfers?: number;
  walkingSeconds?: number;
  transitSeconds?: number;
  waitingSeconds?: number;
  lines: string[];
  stops: string[];
  route: any;
  googleMapsNavigationUrl: string;
}

export interface TransitItinerary {
  mode: "transit";
  detailLevel: RouteDetailLevel;
  objective: "fastest" | "fewest_transfers" | "least_walking" | "balanced";
  departureTime: string;
  arrivalTime: string;
  totalElapsedSeconds: number;
  travelSeconds: number;
  dwellSeconds: number;
  walkingSeconds?: number;
  transitSeconds?: number;
  waitingSeconds?: number;
  transfers?: number;
  legs: TransitLeg[];
  warnings: string[];
}

export type TransitTimingErrorCode = "TRANSIT_CHRONOLOGY_INVALID";

export interface TransitTimingError {
  code: TransitTimingErrorCode;
  message: string;
}

export class TransitChronologyError extends Error {
  readonly code: TransitTimingErrorCode = "TRANSIT_CHRONOLOGY_INVALID";

  constructor(message: string) {
    super(`TRANSIT_CHRONOLOGY_INVALID: ${message}`);
    this.name = "TransitChronologyError";
  }
}

export function getTransitTimingError(error: unknown): TransitTimingError | undefined {
  return error instanceof TransitChronologyError ? { code: error.code, message: error.message } : undefined;
}

export function inferredTransitPreference(
  objective: TransitItinerary["objective"] | undefined,
  explicit?: TransitPreference
): TransitPreference | undefined {
  if (explicit) return explicit;
  if (objective === "least_walking") return "LESS_WALKING";
  if (objective === "fewest_transfers") return "FEWER_TRANSFERS";
  return undefined;
}

export class TransitItineraryService {
  private readonly routeCache = new Map<string, Promise<Awaited<ReturnType<RoutesService["computeRoutes"]>>>>();

  constructor(private readonly routesService: RoutesService) {}

  async routeFixedPath(params: {
    locations: string[];
    departureTime?: Date;
    dwellMinutes?: number[];
    detailLevel?: RouteDetailLevel;
    transitModes?: TransitMode[];
    transitPreference?: TransitPreference;
    objective?: TransitItinerary["objective"];
    plannerMode?: PlannerMode;
    parentTool?: string;
  }): Promise<TransitItinerary> {
    if (params.locations.length < 2) throw new Error("A transit itinerary requires at least two locations.");
    const limits = plannerLimits(params.plannerMode);
    if (params.locations.length - 2 > limits.fixedStops)
      throw new Error(
        `This itinerary has ${params.locations.length - 2} intermediate stops; the ${params.plannerMode || "conservative"} planner limit is ${limits.fixedStops}.`
      );
    const initialDeparture = params.departureTime || new Date();
    const effectiveTransitPreference = inferredTransitPreference(params.objective, params.transitPreference);
    // Steps are the default for this composite tool because lines, stops, and
    // transfers cannot be derived reliably from a summary-only route.
    const detailLevel = params.detailLevel || "steps";
    let nextDeparture = initialDeparture;
    let dwellMilliseconds = 0;
    const legs: TransitLeg[] = [];
    const warnings: string[] = [];
    let largestTimingDiscrepancyMilliseconds = 0;
    let transitSegmentCount = 0;
    let missingTransitLineCount = 0;

    for (let index = 0; index < params.locations.length - 1; index++) {
      const from = params.locations[index];
      const to = params.locations[index + 1];
      const result = await this.computeCachedRoute({
        origin: from,
        destination: to,
        mode: "transit",
        departureTime: nextDeparture,
        detailLevel,
        transitModes: params.transitModes,
        transitPreference: effectiveTransitPreference,
        parentTool: params.parentTool || "maps_transit_itinerary",
      });
      const route = result.routes[0];
      const timing = validateTransitRoute(route, nextDeparture, result.total_duration.value, detailLevel);
      const durationSeconds = timing.durationMilliseconds / 1000;
      const arrivalTime = new Date(timing.arrivalTimeMilliseconds).toISOString();
      const summary = timing.summary;
      warnings.push(...timing.warnings);
      largestTimingDiscrepancyMilliseconds = Math.max(
        largestTimingDiscrepancyMilliseconds,
        timing.normalizationDifferenceMilliseconds
      );
      transitSegmentCount += summary.transitSegmentCount || 0;
      missingTransitLineCount += summary.missingTransitLineCount || 0;
      legs.push({
        from,
        to,
        durationSeconds,
        arrivalTime,
        departureTime: nextDeparture.toISOString(),
        firstTransitDepartureTime: timing.firstTransitDepartureTime,
        lastTransitArrivalTime: timing.lastTransitArrivalTime,
        transfers: summary.transfers,
        walkingSeconds: summary.walkingSeconds,
        transitSeconds: summary.transitSeconds,
        waitingSeconds: summary.waitingSeconds,
        lines: summary.lines,
        stops: summary.stops,
        route,
        googleMapsNavigationUrl: createDirectionsUrl({
          origin: { address: from },
          destination: { address: to },
          mode: "transit",
          navigate: true,
        }),
      });
      const dwellForNextLegMilliseconds =
        index < params.locations.length - 2 ? Math.max(0, params.dwellMinutes?.[index] || 0) * 60000 : 0;
      dwellMilliseconds += dwellForNextLegMilliseconds;
      nextDeparture = new Date(timing.arrivalTimeMilliseconds + dwellForNextLegMilliseconds);
    }

    const arrivalTime = legs[legs.length - 1].arrivalTime;
    const totalElapsedSeconds = (new Date(arrivalTime).getTime() - initialDeparture.getTime()) / 1000;
    const travelSeconds = legs.reduce((sum, leg) => sum + leg.durationSeconds, 0);
    const dwellSeconds = dwellMilliseconds / 1000;
    const finalArrivalMilliseconds = new Date(arrivalTime).getTime();
    const travelMilliseconds = legs.reduce((sum, leg) => sum + Math.round(leg.durationSeconds * 1000), 0);
    if (finalArrivalMilliseconds - initialDeparture.getTime() !== travelMilliseconds + dwellMilliseconds)
      throw new TransitChronologyError(
        "The itinerary leg durations and dwell times do not reconcile with its final arrival."
      );
    const walkingSeconds = sumKnown(legs.map((leg) => leg.walkingSeconds));
    const transitSeconds = sumKnown(legs.map((leg) => leg.transitSeconds));
    const waitingSeconds = sumKnown(legs.map((leg) => leg.waitingSeconds));
    const transfers = sumKnown(legs.map((leg) => leg.transfers));
    if (largestTimingDiscrepancyMilliseconds >= MATERIAL_TIMING_DIFFERENCE_MILLISECONDS) {
      const approximateMinutes = Math.round(largestTimingDiscrepancyMilliseconds / 60000);
      warnings.push(
        `Google timing estimates differed by approximately ${approximateMinutes} minutes; the validated schedule-aware arrival was used.`
      );
    }
    if (missingTransitLineCount)
      warnings.push(
        `Transit line details unavailable for ${missingTransitLineCount} of ${transitSegmentCount} transit segments.`
      );
    return {
      mode: "transit",
      detailLevel,
      objective: params.objective || "fastest",
      departureTime: initialDeparture.toISOString(),
      arrivalTime,
      totalElapsedSeconds,
      travelSeconds,
      dwellSeconds,
      walkingSeconds,
      transitSeconds,
      waitingSeconds,
      transfers,
      legs,
      warnings: [...new Set(warnings)],
    };
  }

  async optimizeFixedStops(params: {
    origin: string;
    stops: string[];
    finalDestination?: string;
    returnToOrigin?: boolean;
    departureTime?: Date;
    dwellMinutes?: number[];
    detailLevel?: RouteDetailLevel;
    transitModes?: TransitMode[];
    transitPreference?: TransitPreference;
    objective?: TransitItinerary["objective"];
    plannerMode?: PlannerMode;
  }): Promise<{
    best: TransitItinerary | null;
    alternatives: TransitItinerary[];
    coarseOrders: string[][];
    invalidFinalists: Array<{ locations: string[]; timingError: TransitTimingError }>;
    warnings: string[];
  }> {
    const limits = plannerLimits(params.plannerMode);
    if (params.stops.length === 0) throw new Error("At least one fixed transit stop is required.");
    if (params.stops.length > limits.fixedStops)
      throw new Error(
        `This request has ${params.stops.length} stops; the ${params.plannerMode || "conservative"} planner limit is ${limits.fixedStops}.`
      );
    const final = params.finalDestination || (params.returnToOrigin ? params.origin : undefined);
    const effectiveTransitPreference = inferredTransitPreference(params.objective, params.transitPreference);
    const nodes = [...new Set([params.origin, ...params.stops, ...(final ? [final] : [])])];
    const matrixEdges = buildFixedStopMatrixEdges(params.origin, params.stops, final);
    const edgeDurations = await computeTargetedTransitMatrix(
      this.routesService,
      matrixEdges,
      {
        departureTime: params.departureTime,
        transitModes: params.transitModes,
        transitPreference: effectiveTransitPreference,
        parentTool: "maps_plan_transit",
      },
      limits.matrixElements
    );
    const durations = Array.from({ length: nodes.length }, () => Array(nodes.length).fill(null));
    const nodeIndexes = new Map(nodes.map((node, index) => [node, index]));
    for (const [key, duration] of edgeDurations) {
      const [origin, destination] = key.split("\u0000");
      const originIndex = nodeIndexes.get(origin);
      const destinationIndex = nodeIndexes.get(destination);
      if (originIndex !== undefined && destinationIndex !== undefined)
        durations[originIndex][destinationIndex] = duration;
    }
    const orders = orderCandidates(
      params.origin,
      params.stops,
      final,
      nodes,
      durations,
      params.plannerMode || "conservative"
    );
    const finalists = orders.slice(0, limits.exactRoutes);
    const exact: TransitItinerary[] = [];
    const invalidFinalists: Array<{ locations: string[]; timingError: TransitTimingError }> = [];
    for (const order of finalists) {
      try {
        exact.push(
          await this.routeFixedPath({
            locations: order,
            departureTime: params.departureTime,
            dwellMinutes: reorderedDwellMinutes(order, params.stops, params.dwellMinutes),
            detailLevel: params.detailLevel,
            transitModes: params.transitModes,
            transitPreference: effectiveTransitPreference,
            objective: params.objective,
            plannerMode: params.plannerMode,
            parentTool: "maps_plan_transit",
          })
        );
      } catch (error) {
        const timingError = getTransitTimingError(error);
        if (!timingError) throw error;
        invalidFinalists.push({ locations: order, timingError });
      }
    }
    exact.sort(
      (left, right) =>
        scoreItinerary(left, params.objective || "fastest") - scoreItinerary(right, params.objective || "fastest")
    );
    await recordRequest({
      api: "local",
      operation: "transit_optimizer",
      tier: "T0",
      units: 0,
      parentTool: "maps_plan_transit",
      reason: "local order optimization",
      fanout: "L",
    });
    return {
      best: exact[0] || null,
      alternatives: exact.slice(1, 3),
      coarseOrders: orders,
      invalidFinalists,
      warnings: invalidFinalists.length
        ? [
            `${invalidFinalists.length} exact transit finalist(s) were excluded because Google returned invalid chronology.`,
            ...(exact.length ? [] : ["No transit itinerary could be ranked safely from the exact finalists."]),
          ]
        : [],
    };
  }

  private computeCachedRoute(
    params: Parameters<RoutesService["computeRoutes"]>[0]
  ): Promise<Awaited<ReturnType<RoutesService["computeRoutes"]>>> {
    const key = JSON.stringify({
      ...params,
      departureTime: params.departureTime?.toISOString(),
      arrivalTime: params.arrivalTime?.toISOString(),
    });
    const cached = this.routeCache.get(key);
    if (cached) return cached;
    const request = this.routesService.computeRoutes(params);
    this.routeCache.set(key, request);
    return request;
  }
}

function reorderedDwellMinutes(
  order: string[],
  stops: string[],
  dwellMinutes: number[] | undefined
): number[] | undefined {
  if (!dwellMinutes) return undefined;
  const dwellByStop = new Map(stops.map((stop, index) => [stop, dwellMinutes[index] || 0]));
  return order
    .slice(1)
    .map((location, index, destinations) => (index === destinations.length - 1 ? 0 : (dwellByStop.get(location) ?? 0)));
}

interface TransitRouteSummary {
  lines: string[];
  stops: string[];
  transitSegmentCount?: number;
  missingTransitLineCount?: number;
  transfers?: number;
  walkingSeconds?: number;
  transitSeconds?: number;
  waitingSeconds?: number;
}

interface TransitRouteTiming {
  durationMilliseconds: number;
  arrivalTimeMilliseconds: number;
  normalizationDifferenceMilliseconds: number;
  firstTransitDepartureTime?: string;
  lastTransitArrivalTime?: string;
  warnings: string[];
  summary: TransitRouteSummary;
}

const MATERIAL_TIMING_DIFFERENCE_MILLISECONDS = 300000;

function validateTransitRoute(
  route: any,
  departureTime: Date,
  normalizedDurationSeconds: number | undefined,
  detailLevel: RouteDetailLevel
): TransitRouteTiming {
  const routeDurationMilliseconds = parseDurationMilliseconds(route?.duration);
  if (routeDurationMilliseconds === undefined)
    throw new TransitChronologyError("Google returned no valid raw route duration.");
  const warnings: string[] = [];
  let normalizationDifferenceMilliseconds = 0;
  const routeLegs = Array.isArray(route?.legs) ? route.legs : [];
  if (!routeLegs.length)
    warnings.push("Google returned no route legs; only aggregate door-to-door timing is available.");
  else {
    const legDurations = routeLegs.map((leg: any) => parseDurationMilliseconds(leg?.duration));
    if (legDurations.every((duration: number | undefined) => duration !== undefined)) {
      const summedLegDurationMilliseconds = legDurations.reduce(
        (sum: number, duration: number | undefined) => sum + (duration || 0),
        0
      );
      normalizationDifferenceMilliseconds = Math.max(
        normalizationDifferenceMilliseconds,
        Math.abs(routeDurationMilliseconds - summedLegDurationMilliseconds)
      );
    } else warnings.push("Google omitted a route-leg duration; aggregate route timing was retained.");
  }

  const normalizedDurationMilliseconds = secondsToMilliseconds(normalizedDurationSeconds);
  if (normalizedDurationMilliseconds !== undefined)
    normalizationDifferenceMilliseconds = Math.max(
      normalizationDifferenceMilliseconds,
      Math.abs(normalizedDurationMilliseconds - routeDurationMilliseconds)
    );
  const aggregateArrivalTimeMilliseconds = departureTime.getTime() + routeDurationMilliseconds;

  const summary: TransitRouteSummary = { lines: [], stops: [] };
  if (detailLevel === "summary")
    return {
      durationMilliseconds: routeDurationMilliseconds,
      arrivalTimeMilliseconds: aggregateArrivalTimeMilliseconds,
      normalizationDifferenceMilliseconds,
      warnings,
      summary,
    };

  const steps = routeLegs.flatMap((leg: any) => (Array.isArray(leg.steps) ? leg.steps : []));
  if (!steps.length)
    return {
      durationMilliseconds: routeDurationMilliseconds,
      arrivalTimeMilliseconds: aggregateArrivalTimeMilliseconds,
      normalizationDifferenceMilliseconds,
      warnings,
      summary,
    };

  const lines = new Set<string>();
  const stops = new Set<string>();
  let walkingMilliseconds = 0;
  let transitMilliseconds = 0;
  let transitStepCount = 0;
  let missingTransitLineCount = 0;
  let walkingDurationsComplete = true;
  let transitTimestampsComplete = true;
  let categoryBreakdownComplete = true;
  let firstTransitDepartureMilliseconds: number | undefined;
  let lastTransitArrivalMilliseconds: number | undefined;
  let latestKnownTransitEventMilliseconds: number | undefined;
  let lastKnownTransitEventMilliseconds: number | undefined;
  let lastTransitStepIndex = -1;

  for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
    const step = steps[stepIndex];
    const mode = step.travelMode || "";
    if (mode === "WALK") {
      const durationMilliseconds = parseDurationMilliseconds(step.staticDuration || step.duration);
      if (durationMilliseconds === undefined) {
        walkingDurationsComplete = false;
        categoryBreakdownComplete = false;
      } else walkingMilliseconds += durationMilliseconds;
      continue;
    }

    if (!step.transitDetails) {
      categoryBreakdownComplete = false;
      continue;
    }
    lastTransitStepIndex = stepIndex;
    transitStepCount++;
    const stopDetails = step.transitDetails.stopDetails;
    const departureMilliseconds = parseTimestampMilliseconds(stopDetails?.departureTime);
    const arrivalMilliseconds = parseTimestampMilliseconds(stopDetails?.arrivalTime);
    if (departureMilliseconds === undefined || arrivalMilliseconds === undefined) {
      transitTimestampsComplete = false;
      categoryBreakdownComplete = false;
    }
    for (const eventMilliseconds of [departureMilliseconds, arrivalMilliseconds]) {
      if (eventMilliseconds === undefined) continue;
      if (eventMilliseconds < departureTime.getTime())
        throw new TransitChronologyError("Google returned a transit event before the requested leg departure.");
      if (lastKnownTransitEventMilliseconds !== undefined && eventMilliseconds < lastKnownTransitEventMilliseconds)
        throw new TransitChronologyError("Google returned non-chronological transit events.");
      lastKnownTransitEventMilliseconds = eventMilliseconds;
      latestKnownTransitEventMilliseconds = eventMilliseconds;
    }
    if (departureMilliseconds !== undefined && arrivalMilliseconds !== undefined) {
      transitMilliseconds += arrivalMilliseconds - departureMilliseconds;
      firstTransitDepartureMilliseconds ??= departureMilliseconds;
      lastTransitArrivalMilliseconds = arrivalMilliseconds;
    }

    const line = step.transitDetails.transitLine;
    const lineName = line?.name || line?.shortName;
    if (lineName) lines.add(lineName);
    else missingTransitLineCount++;
    const departureStop = stopDetails?.departureStop?.name?.text;
    const arrivalStop = stopDetails?.arrivalStop?.name?.text;
    if (departureStop) stops.add(departureStop);
    if (arrivalStop) stops.add(arrivalStop);
  }

  if (!walkingDurationsComplete)
    warnings.push("Google omitted a walking-step duration; walking and waiting breakdowns are incomplete.");
  if (!transitTimestampsComplete)
    warnings.push("Google omitted a transit timestamp; vehicle and waiting breakdowns are incomplete.");
  if (!categoryBreakdownComplete && walkingDurationsComplete && transitTimestampsComplete)
    warnings.push("Google returned an unclassified route step; the waiting breakdown is unavailable.");

  let scheduleLowerBoundMilliseconds = latestKnownTransitEventMilliseconds;
  if (transitTimestampsComplete && lastTransitArrivalMilliseconds !== undefined && lastTransitStepIndex >= 0) {
    const postTransitSteps = steps.slice(lastTransitStepIndex + 1);
    const postTransitWalkingDurations = postTransitSteps.map((step: any) =>
      step.travelMode === "WALK" ? parseDurationMilliseconds(step.staticDuration || step.duration) : undefined
    );
    if (
      postTransitSteps.length &&
      postTransitWalkingDurations.every((duration: number | undefined) => duration !== undefined)
    )
      scheduleLowerBoundMilliseconds =
        lastTransitArrivalMilliseconds +
        postTransitWalkingDurations.reduce((sum: number, duration: number | undefined) => sum + (duration || 0), 0);
  }
  const arrivalTimeMilliseconds = Math.max(
    aggregateArrivalTimeMilliseconds,
    scheduleLowerBoundMilliseconds ?? aggregateArrivalTimeMilliseconds
  );
  const durationMilliseconds = arrivalTimeMilliseconds - departureTime.getTime();
  normalizationDifferenceMilliseconds = Math.max(
    normalizationDifferenceMilliseconds,
    arrivalTimeMilliseconds - aggregateArrivalTimeMilliseconds
  );

  summary.lines = [...lines];
  summary.stops = [...stops];
  summary.transitSegmentCount = transitStepCount;
  summary.missingTransitLineCount = missingTransitLineCount;
  if (transitStepCount === 0 && steps.every((step: any) => step.travelMode === "WALK")) {
    if (walkingDurationsComplete)
      normalizationDifferenceMilliseconds = Math.max(
        normalizationDifferenceMilliseconds,
        Math.abs(walkingMilliseconds - durationMilliseconds)
      );
    summary.transfers = 0;
    summary.walkingSeconds = durationMilliseconds / 1000;
    summary.transitSeconds = 0;
    summary.waitingSeconds = 0;
  } else {
    summary.transfers = transitStepCount ? Math.max(0, transitStepCount - 1) : undefined;
    summary.walkingSeconds = walkingDurationsComplete ? walkingMilliseconds / 1000 : undefined;
    summary.transitSeconds = transitTimestampsComplete ? transitMilliseconds / 1000 : undefined;
    if (categoryBreakdownComplete && walkingDurationsComplete && transitTimestampsComplete) {
      const classifiedMilliseconds = walkingMilliseconds + transitMilliseconds;
      if (classifiedMilliseconds <= durationMilliseconds)
        summary.waitingSeconds = (durationMilliseconds - classifiedMilliseconds) / 1000;
      else
        warnings.push(
          "Walking and transit estimates exceed door-to-door elapsed time; waiting was omitted rather than forcing reconciliation."
        );
    }
  }
  return {
    durationMilliseconds,
    arrivalTimeMilliseconds,
    normalizationDifferenceMilliseconds,
    firstTransitDepartureTime:
      !transitTimestampsComplete || firstTransitDepartureMilliseconds === undefined
        ? undefined
        : new Date(firstTransitDepartureMilliseconds).toISOString(),
    lastTransitArrivalTime:
      !transitTimestampsComplete || lastTransitArrivalMilliseconds === undefined
        ? undefined
        : new Date(lastTransitArrivalMilliseconds).toISOString(),
    warnings,
    summary,
  };
}

function parseDurationMilliseconds(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?s$/.test(value)) return undefined;
  const seconds = parseDuration(value);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined;
}

function secondsToMilliseconds(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 1000) : undefined;
}

function parseTimestampMilliseconds(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : undefined;
}

function sumKnown(values: Array<number | undefined>): number | undefined {
  return values.every((value) => value !== undefined)
    ? values.reduce((sum, value) => sum + (value || 0), 0)
    : undefined;
}

function orderCandidates(
  origin: string,
  stops: string[],
  final: string | undefined,
  nodes: string[],
  durations: any[][],
  mode: PlannerMode
): string[][] {
  const limit = mode === "thorough" ? 24 : 12;
  return stops.length <= 8
    ? heldKarpCandidates(origin, stops, final, nodes, durations, limit)
    : beamSearchCandidates(origin, stops, final, nodes, durations, mode, limit);
}

function coarseScore(order: string[], nodes: string[], durations: any[][]): number {
  const index = new Map(nodes.map((node, nodeIndex) => [node, nodeIndex]));
  return order.slice(0, -1).reduce((sum, node, position) => {
    const from = index.get(node);
    const to = index.get(order[position + 1]);
    return (
      sum +
      (from === undefined || to === undefined
        ? Number.MAX_SAFE_INTEGER / Math.max(order.length, 1)
        : durations[from]?.[to]?.value || Number.MAX_SAFE_INTEGER / Math.max(order.length, 1))
    );
  }, 0);
}

interface CoarseState {
  score: number;
  path: number[];
}

function edgeScore(from: string, to: string, nodes: string[], durations: any[][]): number {
  const index = new Map(nodes.map((node, nodeIndex) => [node, nodeIndex]));
  const fromIndex = index.get(from);
  const toIndex = index.get(to);
  const value = fromIndex === undefined || toIndex === undefined ? undefined : durations[fromIndex]?.[toIndex]?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER / 4;
}

function retainStates(states: CoarseState[], limit: number): CoarseState[] {
  return states.sort((left, right) => left.score - right.score).slice(0, limit);
}

/** Return k-best coarse orders using a Held-Karp-style dynamic program. */
function heldKarpCandidates(
  origin: string,
  stops: string[],
  final: string | undefined,
  nodes: string[],
  durations: any[][],
  limit: number
): string[][] {
  const stateLimit = Math.max(limit, 4);
  const states = new Map<string, CoarseState[]>();
  const key = (mask: number, last: number) => `${mask}:${last}`;

  for (let index = 0; index < stops.length; index++) {
    states.set(key(1 << index, index), [{ score: edgeScore(origin, stops[index], nodes, durations), path: [index] }]);
  }

  const fullMask = (1 << stops.length) - 1;
  for (let mask = 1; mask <= fullMask; mask++) {
    for (let last = 0; last < stops.length; last++) {
      if ((mask & (1 << last)) === 0) continue;
      const current = states.get(key(mask, last)) || [];
      for (const state of current) {
        for (let next = 0; next < stops.length; next++) {
          if (mask & (1 << next)) continue;
          const nextMask = mask | (1 << next);
          const nextKey = key(nextMask, next);
          const nextStates = states.get(nextKey) || [];
          nextStates.push({
            score: state.score + edgeScore(stops[last], stops[next], nodes, durations),
            path: [...state.path, next],
          });
          states.set(nextKey, retainStates(nextStates, stateLimit));
        }
      }
    }
  }

  const completed: CoarseState[] = [];
  for (let last = 0; last < stops.length; last++) {
    for (const state of states.get(key(fullMask, last)) || []) {
      completed.push({
        score: state.score + (final ? edgeScore(stops[last], final, nodes, durations) : 0),
        path: state.path,
      });
    }
  }

  const seen = new Set<string>();
  return completed
    .sort((left, right) => left.score - right.score)
    .filter((state) => {
      const orderKey = state.path.join(",");
      if (seen.has(orderKey)) return false;
      seen.add(orderKey);
      return true;
    })
    .slice(0, limit)
    .map((state) => [origin, ...state.path.map((index) => stops[index]), ...(final ? [final] : [])]);
}

/** Bounded beam search plus local 2-opt for larger stop sets. */
function beamSearchCandidates(
  origin: string,
  stops: string[],
  final: string | undefined,
  nodes: string[],
  durations: any[][],
  mode: PlannerMode,
  limit: number
): string[][] {
  const beamWidth = mode === "thorough" ? 32 : 16;
  let beam: Array<{ path: number[]; remaining: number[]; score: number }> = [
    { path: [], remaining: stops.map((_, index) => index), score: 0 },
  ];

  while (beam.some((state) => state.remaining.length > 0)) {
    const expanded: Array<{ path: number[]; remaining: number[]; score: number }> = [];
    for (const state of beam) {
      for (const next of state.remaining) {
        const previous = state.path.length ? stops[state.path.at(-1)!] : origin;
        expanded.push({
          path: [...state.path, next],
          remaining: state.remaining.filter((index) => index !== next),
          score: state.score + edgeScore(previous, stops[next], nodes, durations),
        });
      }
    }
    expanded.sort((left, right) => left.score - right.score);
    beam = expanded.slice(0, beamWidth);
  }

  const seen = new Set<string>();
  return beam
    .map((state) => {
      const order = [origin, ...state.path.map((index) => stops[index]), ...(final ? [final] : [])];
      return twoOpt(order, nodes, durations, Boolean(final));
    })
    .sort((left, right) => coarseScore(left, nodes, durations) - coarseScore(right, nodes, durations))
    .filter((order) => {
      const orderKey = order.join("\u0000");
      if (seen.has(orderKey)) return false;
      seen.add(orderKey);
      return true;
    })
    .slice(0, limit);
}

function twoOpt(order: string[], nodes: string[], durations: any[][], hasFixedFinal: boolean): string[] {
  let best = [...order];
  let bestScore = coarseScore(best, nodes, durations);
  let improved = true;
  let rounds = 0;
  while (improved && rounds++ < order.length) {
    improved = false;
    const lastMovableIndex = hasFixedFinal ? best.length - 2 : best.length - 1;
    for (let start = 1; start < lastMovableIndex; start++) {
      for (let end = start + 1; end <= lastMovableIndex; end++) {
        const candidate = [...best.slice(0, start), ...best.slice(start, end + 1).reverse(), ...best.slice(end + 1)];
        const score = coarseScore(candidate, nodes, durations);
        if (score < bestScore) {
          best = candidate;
          bestScore = score;
          improved = true;
        }
      }
    }
  }
  return best;
}

export function scoreItinerary(itinerary: TransitItinerary, objective: TransitItinerary["objective"]): number {
  const elapsed = itinerary.totalElapsedSeconds;
  const walking = itinerary.walkingSeconds ?? Number.MAX_SAFE_INTEGER;
  const transfers = itinerary.transfers ?? Number.MAX_SAFE_INTEGER;
  if (objective === "fewest_transfers") return transfers * 1_000_000_000_000 + elapsed * 1_000 + walking;
  if (objective === "least_walking") return walking * 1_000_000_000_000 + elapsed * 1_000 + transfers;
  if (objective === "balanced") return elapsed / 60 + transfers * 8 + (walking / 60) * 1.5;
  return elapsed * 1_000_000_000 + transfers * 1_000_000 + walking;
}

export interface TransitMatrixParams {
  origins: string[];
  destinations: string[];
  departureTime?: Date;
  transitModes?: TransitMode[];
  transitPreference?: TransitPreference;
  parentTool?: string;
}

/** Split planner matrices into valid transit requests while guarding total elements. */
export async function computeBoundedTransitMatrix(
  routesService: RoutesService,
  params: TransitMatrixParams,
  maxElements: number
): Promise<Awaited<ReturnType<RoutesService["computeRouteMatrix"]>>> {
  const totalElements = params.origins.length * params.destinations.length;
  if (totalElements > maxElements)
    throw new Error(
      `Transit planner matrix projects ${totalElements} elements, exceeding the ${maxElements}-element ${maxElements <= 100 ? "conservative" : "thorough"} planner guard.`
    );
  const distances = Array.from({ length: params.origins.length }, () => Array(params.destinations.length).fill(null));
  const durations = Array.from({ length: params.origins.length }, () => Array(params.destinations.length).fill(null));
  for (let destinationStart = 0; destinationStart < params.destinations.length; destinationStart += 100) {
    const destinationBatch = params.destinations.slice(destinationStart, destinationStart + 100);
    const rowsPerRequest = Math.max(1, Math.floor(100 / Math.max(1, destinationBatch.length)));
    for (let originStart = 0; originStart < params.origins.length; originStart += rowsPerRequest) {
      const originBatch = params.origins.slice(originStart, originStart + rowsPerRequest);
      const result = await routesService.computeRouteMatrix({
        origins: originBatch,
        destinations: destinationBatch,
        mode: "transit",
        departureTime: params.departureTime,
        transitModes: params.transitModes,
        transitPreference: params.transitPreference,
        parentTool: params.parentTool,
      });
      for (let row = 0; row < originBatch.length; row++) {
        if (result.distances[row])
          distances[originStart + row].splice(destinationStart, destinationBatch.length, ...result.distances[row]);
        if (result.durations[row])
          durations[originStart + row].splice(destinationStart, destinationBatch.length, ...result.durations[row]);
      }
    }
  }
  return {
    distances,
    durations,
    origin_addresses: params.origins,
    destination_addresses: params.destinations,
  };
}

interface TransitMatrixEdge {
  origin: string;
  destination: string;
}

function buildFixedStopMatrixEdges(origin: string, stops: string[], final?: string): TransitMatrixEdge[] {
  const edges = new Map<string, TransitMatrixEdge>();
  const add = (from: string, to: string) => {
    if (from === to) return;
    edges.set(`${from}\u0000${to}`, { origin: from, destination: to });
  };
  for (const stop of stops) add(origin, stop);
  for (const from of stops) for (const to of stops) add(from, to);
  if (final) for (const stop of stops) add(stop, final);
  return [...edges.values()];
}

export async function computeTargetedTransitMatrix(
  routesService: RoutesService,
  edges: TransitMatrixEdge[],
  params: Omit<TransitMatrixParams, "origins" | "destinations">,
  maxElements: number
): Promise<Map<string, { value: number; text: string } | null>> {
  const uniqueEdges = new Map(edges.map((edge) => [`${edge.origin}\u0000${edge.destination}`, edge]));
  if (uniqueEdges.size > maxElements)
    throw new Error(
      `Transit planner matrix projects ${uniqueEdges.size} elements, exceeding the ${maxElements}-element ${maxElements <= 100 ? "conservative" : "thorough"} planner guard.`
    );

  const byOrigin = new Map<string, string[]>();
  for (const edge of uniqueEdges.values()) {
    const destinations = byOrigin.get(edge.origin) || [];
    destinations.push(edge.destination);
    byOrigin.set(edge.origin, destinations);
  }

  const durations = new Map<string, { value: number; text: string } | null>();
  for (const [origin, destinations] of byOrigin) {
    for (let start = 0; start < destinations.length; start += 100) {
      const batch = destinations.slice(start, start + 100);
      const matrix = await routesService.computeRouteMatrix({
        origins: [origin],
        destinations: batch,
        mode: "transit",
        departureTime: params.departureTime,
        transitModes: params.transitModes,
        transitPreference: params.transitPreference,
        parentTool: params.parentTool,
      });
      for (let index = 0; index < batch.length; index++) {
        durations.set(`${origin}\u0000${batch[index]}`, matrix.durations[0]?.[index] || null);
      }
    }
  }
  return durations;
}
