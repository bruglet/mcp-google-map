import { assertMatrixLimit, withAccounting } from "./requestAccounting.js";

const ROUTES_API_BASE = "https://routes.googleapis.com";

const TRAVEL_MODE_MAP: Record<string, string> = {
  driving: "DRIVE",
  walking: "WALK",
  bicycling: "BICYCLE",
  transit: "TRANSIT",
};

export type RouteDetailLevel = "summary" | "steps" | "geometry" | "full";
export type TrafficMode = "none" | "aware" | "optimal";
export type TransitMode =
  | "BUS"
  | "SUBWAY"
  | "TRAIN"
  | "LIGHT_RAIL"
  | "RAIL"
  | "bus"
  | "subway"
  | "train"
  | "light_rail"
  | "rail";
export type TransitPreference = "LESS_WALKING" | "FEWER_TRANSFERS" | "less_walking" | "fewer_transfers";

/** Shared caller-facing route policy. API-specific enum casing is adapted below. */
export interface RouteOptions {
  mode: "driving" | "walking" | "bicycling" | "transit";
  departure_time?: string;
  arrival_time?: string;
  alternatives?: boolean;
  detail_level?: RouteDetailLevel;
  traffic?: TrafficMode;
  transit_modes?: Array<"bus" | "subway" | "train" | "light_rail" | "rail">;
  transit_preference?: "less_walking" | "fewer_transfers";
}

export function parseDuration(duration: string | undefined): number {
  if (!duration) return 0;
  const match = duration.match(/^([0-9]+(?:\.[0-9]+)?)s$/);
  return match ? Number(match[1]) : 0;
}

export function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
}

export function formatDuration(seconds: number): string {
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return mins > 0
      ? `${hours} hour${hours > 1 ? "s" : ""} ${mins} min${mins > 1 ? "s" : ""}`
      : `${hours} hour${hours > 1 ? "s" : ""}`;
  }
  const mins = Math.round(seconds / 60);
  return `${mins} min${mins !== 1 ? "s" : ""}`;
}

export function buildRoutesFieldMask(
  detailLevel: RouteDetailLevel = "summary",
  includeWaypointOptimization = false
): string {
  const fields = [
    "routes.distanceMeters",
    "routes.duration",
    "routes.description",
    "routes.legs.distanceMeters",
    "routes.legs.duration",
    "routes.legs.startLocation",
    "routes.legs.endLocation",
  ];
  if (detailLevel === "steps" || detailLevel === "full") {
    fields.push(
      "routes.legs.steps.travelMode",
      "routes.legs.steps.navigationInstruction",
      "routes.legs.steps.distanceMeters",
      "routes.legs.steps.staticDuration",
      "routes.legs.steps.startLocation",
      "routes.legs.steps.endLocation",
      "routes.legs.steps.transitDetails"
    );
  }
  if (detailLevel === "geometry" || detailLevel === "full") {
    fields.push("routes.polyline.encodedPolyline", "routes.legs.polyline.encodedPolyline");
  }
  if (detailLevel === "full" || includeWaypointOptimization) fields.push("routes.optimizedIntermediateWaypointIndex");
  return [...new Set(fields)].join(",");
}

export const ROUTE_MATRIX_FIELD_MASK = "originIndex,destinationIndex,distanceMeters,duration,status,condition";

function toWaypoint(location: string): any {
  const coordinateMatch = location.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (coordinateMatch) {
    return { location: { latLng: { latitude: Number(coordinateMatch[1]), longitude: Number(coordinateMatch[2]) } } };
  }
  if (location.startsWith("place_id:")) return { placeId: location.slice("place_id:".length) };
  return { address: location };
}

function buildRouteModifiers(params: { avoidTolls?: boolean; avoidHighways?: boolean }, travelMode: string): any {
  const routeModifiers: Record<string, boolean> = {};
  if (params.avoidTolls) routeModifiers.avoidTolls = true;
  if (params.avoidHighways) routeModifiers.avoidHighways = true;
  if (Object.keys(routeModifiers).length === 0) return undefined;
  if (travelMode !== "DRIVE")
    throw new Error('Route modifiers "avoid_tolls" and "avoid_highways" are only supported with mode "driving".');
  return routeModifiers;
}

function addTimeOptions(body: any, params: { departureTime?: Date; arrivalTime?: Date }): void {
  if (params.arrivalTime && params.departureTime)
    throw new Error("departure_time and arrival_time are mutually exclusive.");
  if (params.arrivalTime) body.arrivalTime = params.arrivalTime.toISOString();
  else if (params.departureTime) body.departureTime = params.departureTime.toISOString();
}

function addTransitOptions(
  body: any,
  params: { transitModes?: TransitMode[]; transitPreference?: TransitPreference },
  travelMode: string
): void {
  if (!params.transitModes && !params.transitPreference) return;
  if (travelMode !== "TRANSIT") throw new Error("Transit modes and preferences require mode transit.");
  body.transitPreferences = {};
  if (params.transitModes?.length) {
    body.transitPreferences.allowedTravelModes = params.transitModes.map((mode) => mode.toUpperCase());
  }
  if (params.transitPreference) {
    body.transitPreferences.routingPreference = params.transitPreference.toUpperCase();
  }
}

function addTrafficPreference(body: any, traffic: TrafficMode | undefined, travelMode: string): void {
  const selected = traffic || "none";
  if (selected === "none") return;
  if (travelMode !== "DRIVE") throw new Error("Traffic preference is only supported with mode driving.");
  body.routingPreference = selected === "optimal" ? "TRAFFIC_AWARE_OPTIMAL" : "TRAFFIC_AWARE";
}

export class RoutesService {
  private readonly apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.GOOGLE_MAPS_API_KEY || "";
    if (!this.apiKey) throw new Error("Google Maps API Key is required");
  }

  async computeRoutes(params: {
    origin: string;
    destination: string;
    mode?: string;
    departureTime?: Date;
    arrivalTime?: Date;
    intermediates?: string[];
    optimizeWaypointOrder?: boolean;
    avoidTolls?: boolean;
    avoidHighways?: boolean;
    traffic?: TrafficMode;
    alternatives?: boolean;
    detailLevel?: RouteDetailLevel;
    transitModes?: TransitMode[];
    transitPreference?: TransitPreference;
    parentTool?: string;
  }): Promise<{
    routes: any[];
    summary: string;
    total_distance: { value: number; text: string };
    total_duration: { value: number; text: string };
    arrival_time: string;
    departure_time: string;
    optimizedIntermediateWaypointIndex?: number[];
  }> {
    const travelMode = TRAVEL_MODE_MAP[params.mode || "driving"] || "DRIVE";
    if (travelMode === "TRANSIT" && params.intermediates?.length)
      throw new Error("Transit routes do not support intermediate waypoints.");
    const detailLevel = params.detailLevel || "summary";
    const requestBody: any = {
      origin: toWaypoint(params.origin),
      destination: toWaypoint(params.destination),
      travelMode,
      computeAlternativeRoutes: Boolean(params.alternatives && !params.intermediates?.length),
    };
    addTrafficPreference(requestBody, params.traffic, travelMode);
    addTransitOptions(requestBody, params, travelMode);
    addTimeOptions(requestBody, params);
    const routeModifiers = buildRouteModifiers(params, travelMode);
    if (routeModifiers) requestBody.routeModifiers = routeModifiers;
    if (params.intermediates?.length) requestBody.intermediates = params.intermediates.map(toWaypoint);
    if (params.optimizeWaypointOrder && params.intermediates?.length && travelMode !== "TRANSIT")
      requestBody.optimizeWaypointOrder = true;

    const tier =
      Boolean(params.optimizeWaypointOrder) ||
      (travelMode === "DRIVE" && Boolean(params.traffic && params.traffic !== "none"))
        ? "T2"
        : "T1";
    const response = await withAccounting(
      {
        api: "routes",
        operation: "computeRoutes",
        tier,
        units: 1,
        parentTool: params.parentTool || "maps_directions",
        reason: `${params.mode || "driving"} ${detailLevel} route`,
        fanout: "S",
      },
      async () => {
        const response = await fetch(`${ROUTES_API_BASE}/directions/v2:computeRoutes`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": this.apiKey,
            "X-Goog-FieldMask": buildRoutesFieldMask(detailLevel, Boolean(params.optimizeWaypointOrder)),
          },
          body: JSON.stringify(requestBody),
        });
        if (!response.ok) throw new Error(await this.errorMessage(response));
        return response;
      }
    );
    const data = await response.json();
    if (!data.routes?.length)
      throw new Error(
        `No route found from "${params.origin}" to "${params.destination}" with mode: ${params.mode || "driving"}`
      );
    const route = data.routes[0];
    const result = {
      routes: data.routes,
      summary: route.description || "",
      total_distance: { value: route.distanceMeters || 0, text: formatDistance(route.distanceMeters || 0) },
      total_duration: { value: parseDuration(route.duration), text: formatDuration(parseDuration(route.duration)) },
      arrival_time: route.arrivalTime || "",
      departure_time: route.departureTime || "",
    };
    return route.optimizedIntermediateWaypointIndex
      ? { ...result, optimizedIntermediateWaypointIndex: route.optimizedIntermediateWaypointIndex }
      : result;
  }

  async computeRouteMatrix(params: {
    origins: string[];
    destinations: string[];
    mode?: string;
    departureTime?: Date;
    avoidTolls?: boolean;
    avoidHighways?: boolean;
    traffic?: TrafficMode;
    transitModes?: TransitMode[];
    transitPreference?: TransitPreference;
    parentTool?: string;
  }): Promise<{
    distances: any[][];
    durations: any[][];
    origin_addresses: string[];
    destination_addresses: string[];
    warning?: string;
  }> {
    const travelMode = TRAVEL_MODE_MAP[params.mode || "driving"] || "DRIVE";
    const totalPairs = params.origins.length * params.destinations.length;
    assertMatrixLimit(params.origins.length, params.destinations.length, 100);
    const requestBody: any = {
      origins: params.origins.map((origin) => ({ waypoint: toWaypoint(origin) })),
      destinations: params.destinations.map((destination) => ({ waypoint: toWaypoint(destination) })),
      travelMode,
    };
    addTrafficPreference(requestBody, params.traffic, travelMode);
    addTransitOptions(requestBody, params, travelMode);
    if (params.departureTime) requestBody.departureTime = params.departureTime.toISOString();
    const routeModifiers = buildRouteModifiers(params, travelMode);
    if (routeModifiers) requestBody.routeModifiers = routeModifiers;
    const tier = travelMode === "DRIVE" && params.traffic && params.traffic !== "none" ? "T2" : "T1";
    const response = await withAccounting(
      {
        api: "routes",
        operation: "computeRouteMatrix",
        tier,
        units: totalPairs,
        parentTool: params.parentTool || "maps_distance_matrix",
        reason: `${params.mode || "driving"} matrix`,
        fanout: totalPairs > 20 ? "L" : "M",
      },
      async () => {
        const response = await fetch(`${ROUTES_API_BASE}/distanceMatrix/v2:computeRouteMatrix`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": this.apiKey,
            "X-Goog-FieldMask": ROUTE_MATRIX_FIELD_MASK,
          },
          body: JSON.stringify(requestBody),
        });
        if (!response.ok) throw new Error(await this.errorMessage(response));
        return response;
      }
    );
    const elements: any[] = await response.json();
    const distances: any[][] = Array.from({ length: params.origins.length }, () =>
      Array(params.destinations.length).fill(null)
    );
    const durations: any[][] = Array.from({ length: params.origins.length }, () =>
      Array(params.destinations.length).fill(null)
    );
    let routeNotFoundCount = 0;
    for (const element of elements) {
      const i = element.originIndex;
      const j = element.destinationIndex;
      if (i === undefined || j === undefined) continue;
      if (element.condition === "ROUTE_NOT_FOUND" || element.status?.code) {
        routeNotFoundCount++;
        continue;
      }
      distances[i][j] = { value: element.distanceMeters || 0, text: formatDistance(element.distanceMeters || 0) };
      const seconds = parseDuration(element.duration);
      durations[i][j] = { value: seconds, text: formatDuration(seconds) };
    }
    return {
      distances,
      durations,
      origin_addresses: params.origins,
      destination_addresses: params.destinations,
      ...(routeNotFoundCount
        ? { warning: `${routeNotFoundCount} of ${totalPairs} matrix elements returned no route.` }
        : {}),
    };
  }

  private async errorMessage(response: Response): Promise<string> {
    const data = await response.json().catch(() => ({}));
    return data?.error?.message || `Google Routes API returned HTTP ${response.status}`;
  }
}
