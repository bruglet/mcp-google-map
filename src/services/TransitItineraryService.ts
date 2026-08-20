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
  walkingSeconds?: number;
  transitSeconds?: number;
  waitingSeconds?: number;
  transfers?: number;
  legs: TransitLeg[];
  warnings: string[];
}

export class TransitItineraryService {
  constructor(private readonly routesService: RoutesService) {}

  async routeFixedPath(params: {
    locations: string[];
    departureTime?: Date;
    dwellMinutes?: number[];
    detailLevel?: RouteDetailLevel;
    transitModes?: TransitMode[];
    transitPreference?: TransitPreference;
    objective?: TransitItinerary["objective"];
  }): Promise<TransitItinerary> {
    if (params.locations.length < 2) throw new Error("A transit itinerary requires at least two locations.");
    const initialDeparture = params.departureTime || new Date();
    // Steps are the default for this composite tool because lines, stops, and
    // transfers cannot be derived reliably from a summary-only route.
    const detailLevel = params.detailLevel || "steps";
    let nextDeparture = initialDeparture;
    const legs: TransitLeg[] = [];
    const warnings: string[] = [];

    for (let index = 0; index < params.locations.length - 1; index++) {
      const from = params.locations[index];
      const to = params.locations[index + 1];
      const result = await this.routesService.computeRoutes({
        origin: from,
        destination: to,
        mode: "transit",
        departureTime: nextDeparture,
        detailLevel,
        transitModes: params.transitModes,
        transitPreference: params.transitPreference,
      });
      const route = result.routes[0];
      const durationSeconds = result.total_duration.value;
      const arrivalTime =
        extractArrivalTime(route) || new Date(nextDeparture.getTime() + durationSeconds * 1000).toISOString();
      const departureTime = extractDepartureTime(route) || nextDeparture.toISOString();
      const summary = summarizeTransitRoute(route);
      legs.push({
        from,
        to,
        durationSeconds,
        arrivalTime,
        departureTime,
        transfers: summary.transfers,
        walkingSeconds: summary.walkingSeconds,
        transitSeconds: summary.transitSeconds,
        waitingSeconds:
          summary.walkingSeconds === undefined || summary.transitSeconds === undefined
            ? undefined
            : Math.max(0, durationSeconds - summary.walkingSeconds - summary.transitSeconds),
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
      nextDeparture = new Date(new Date(arrivalTime).getTime() + (params.dwellMinutes?.[index] || 0) * 60000);
    }

    const arrivalTime = legs[legs.length - 1].arrivalTime;
    // Intermediate dwell is already reflected in later leg departure/arrival
    // times. Do not add it a second time to the end-to-end elapsed duration.
    const totalElapsedSeconds = Math.max(
      0,
      Math.round((new Date(arrivalTime).getTime() - initialDeparture.getTime()) / 1000)
    );
    const travelSeconds = legs.reduce((sum, leg) => sum + leg.durationSeconds, 0);
    const walkingSeconds = sumKnown(legs.map((leg) => leg.walkingSeconds));
    const transitSeconds = sumKnown(legs.map((leg) => leg.transitSeconds));
    const waitingSeconds = sumKnown(legs.map((leg) => leg.waitingSeconds));
    const transfers = sumKnown(legs.map((leg) => leg.transfers));
    if (legs.some((leg) => !leg.lines.length))
      warnings.push("Some route legs did not include structured transit line details.");
    return {
      mode: "transit",
      detailLevel,
      objective: params.objective || "fastest",
      departureTime: initialDeparture.toISOString(),
      arrivalTime,
      totalElapsedSeconds,
      travelSeconds,
      walkingSeconds,
      transitSeconds,
      waitingSeconds,
      transfers,
      legs,
      warnings,
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
  }): Promise<{ best: TransitItinerary; alternatives: TransitItinerary[]; coarseOrders: string[][] }> {
    const limits = plannerLimits(params.plannerMode);
    if (params.stops.length === 0) throw new Error("At least one fixed transit stop is required.");
    if (params.stops.length > limits.fixedStops)
      throw new Error(
        `This request has ${params.stops.length} stops; the ${params.plannerMode || "conservative"} planner limit is ${limits.fixedStops}.`
      );
    const final = params.finalDestination || (params.returnToOrigin ? params.origin : undefined);
    const nodes = [params.origin, ...params.stops, ...(final ? [final] : [])];
    const matrix = await computeBoundedTransitMatrix(
      this.routesService,
      {
        origins: nodes,
        destinations: nodes,
        departureTime: params.departureTime,
        transitModes: params.transitModes,
        transitPreference: params.transitPreference,
      },
      limits.matrixElements
    );
    const orders = orderCandidates(
      params.origin,
      params.stops,
      final,
      nodes,
      matrix.durations,
      params.plannerMode || "conservative"
    );
    const finalists = orders.slice(0, limits.exactRoutes);
    const exact = await Promise.all(
      finalists.map((order) =>
        this.routeFixedPath({
          locations: order,
          departureTime: params.departureTime,
          dwellMinutes: params.dwellMinutes,
          detailLevel: params.detailLevel,
          transitModes: params.transitModes,
          transitPreference: params.transitPreference,
          objective: params.objective,
        })
      )
    );
    exact.sort(
      (left, right) =>
        scoreItinerary(left, params.objective || "fastest") - scoreItinerary(right, params.objective || "fastest")
    );
    if (!exact[0]) throw new Error("No viable transit itinerary remained after route evaluation.");
    await recordRequest({
      api: "local",
      operation: "transit_optimizer",
      tier: "T0",
      units: 0,
      parentTool: "maps_plan_transit",
      reason: "local order optimization",
      fanout: "L",
    });
    return { best: exact[0], alternatives: exact.slice(1, 3), coarseOrders: orders };
  }
}

function extractArrivalTime(route: any): string | undefined {
  const values: string[] = [];
  for (const leg of route?.legs || [])
    for (const step of leg.steps || []) {
      const value = step.transitDetails?.stopDetails?.arrivalTime;
      if (value) values.push(value);
    }
  return values.at(-1);
}

function extractDepartureTime(route: any): string | undefined {
  for (const leg of route?.legs || [])
    for (const step of leg.steps || []) {
      const value = step.transitDetails?.stopDetails?.departureTime;
      if (value) return value;
    }
  return undefined;
}

function summarizeTransitRoute(route: any): {
  lines: string[];
  stops: string[];
  transfers?: number;
  walkingSeconds?: number;
  transitSeconds?: number;
} {
  const lines = new Set<string>();
  const stops = new Set<string>();
  let transitSteps = 0;
  let walkingSeconds = 0;
  let transitSeconds = 0;
  let sawStructuredStep = false;
  for (const leg of route?.legs || [])
    for (const step of leg.steps || []) {
      sawStructuredStep = true;
      const mode = step.travelMode || "";
      const seconds = parseDuration(step.staticDuration || step.duration);
      if (mode === "WALK") walkingSeconds += seconds;
      if (step.transitDetails) {
        transitSteps++;
        transitSeconds += seconds;
        const line = step.transitDetails.transitLine;
        const name = line?.name || line?.shortName;
        if (name) lines.add(name);
        const departure = step.transitDetails.stopDetails?.departureStop?.name?.text;
        const arrival = step.transitDetails.stopDetails?.arrivalStop?.name?.text;
        if (departure) stops.add(departure);
        if (arrival) stops.add(arrival);
      }
    }
  return {
    lines: [...lines],
    stops: [...stops],
    ...(sawStructuredStep ? { transfers: Math.max(0, transitSteps - 1), walkingSeconds, transitSeconds } : {}),
  };
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
  if (params.destinations.length > 100)
    throw new Error("Transit planner matrices cannot exceed 100 destinations per request.");

  const distances = Array.from({ length: params.origins.length }, () => Array(params.destinations.length).fill(null));
  const durations = Array.from({ length: params.origins.length }, () => Array(params.destinations.length).fill(null));
  const rowsPerRequest = Math.max(1, Math.floor(100 / Math.max(1, params.destinations.length)));
  for (let start = 0; start < params.origins.length; start += rowsPerRequest) {
    const rowOrigins = params.origins.slice(start, start + rowsPerRequest);
    const result = await routesService.computeRouteMatrix({
      origins: rowOrigins,
      destinations: params.destinations,
      mode: "transit",
      departureTime: params.departureTime,
      transitModes: params.transitModes,
      transitPreference: params.transitPreference,
    });
    for (let row = 0; row < rowOrigins.length; row++) {
      distances[start + row] = result.distances[row] || distances[start + row];
      durations[start + row] = result.durations[row] || durations[start + row];
    }
  }
  return {
    distances,
    durations,
    origin_addresses: params.origins,
    destination_addresses: params.destinations,
  };
}
