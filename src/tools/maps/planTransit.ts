import { z } from "zod";
import { TransitItineraryService } from "../../services/TransitItineraryService.js";
import { RoutesService } from "../../services/RoutesService.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
import { locationInputSchema, locationInputsToStrings } from "../../services/location.js";
import { GroundingLiteService } from "../../services/GroundingLiteService.js";

const NAME = "maps_plan_transit";
const DESCRIPTION =
  "Choose the visit order for known transit stops and return the best chronological itinerary plus bounded alternatives. Use when the user supplies fixed places but allows reordering; use maps_transit_itinerary when order is fixed and maps_optimize_transit_errands when branches must also be chosen. Exact rankings use complete destination arrival times including waiting and dwell, and valid itineraries report dwellSeconds; non-time objectives use a duration-based shortlist before exact rerouting, so they remain bounded heuristics rather than guaranteed global optima. Invalid exact finalists are returned in invalidFinalists and never ranked; best is null if every exact route is invalid. Cost: T1 | Fan-out: L; matrix elements are counted.";
const SCHEMA = {
  origin: locationInputSchema.describe("Trip starting point as a query, Place ID, coordinates, or Maps URL."),
  stops: z
    .array(locationInputSchema)
    .min(1)
    .describe("Known stops that may be reordered; use one location object per stop."),
  final_destination: locationInputSchema
    .optional()
    .describe("Optional fixed endpoint after all reordered stops; omit for an open-ended trip."),
  return_to_origin: z
    .boolean()
    .default(false)
    .describe("Set true to return to origin after all stops; do not combine with a different final_destination."),
  departure_time: z
    .string()
    .optional()
    .describe(
      "ISO 8601 timestamp for the requested start of the first leg; defaults to now. Later legs use complete arrival plus dwell."
    ),
  dwell_minutes: z
    .array(z.number().int().min(0))
    .optional()
    .describe(
      "Minutes spent at each named stop before reordering; the value follows that stop into its reordered position, and the terminal destination receives zero dwell."
    ),
  detail_level: z
    .enum(["summary", "steps", "geometry", "full"])
    .default("steps")
    .describe(
      "Use summary for timing only, steps for lines and transfers, geometry for polylines, or full when both are needed; defaults to steps."
    ),
  objective: z
    .enum(["fastest", "fewest_transfers", "least_walking", "balanced"])
    .default("fastest")
    .describe(
      "Ranking goal; least_walking and fewest_transfers also infer the matching Google transit preference unless transit_preference is explicit."
    ),
  planner_mode: z
    .enum(["conservative", "thorough"])
    .default("conservative")
    .describe(
      "Use conservative by default; choose thorough only when broader search is clearly warranted. Thorough can exact-route up to 10 finalists instead of 3."
    ),
  transit_modes: z
    .array(z.enum(["bus", "subway", "train", "light_rail", "rail"]))
    .optional()
    .describe("Transit modes to prefer for matrix and exact routes; omit to allow all supported modes."),
  transit_preference: z
    .enum(["less_walking", "fewer_transfers"])
    .optional()
    .describe("Explicit trip-wide preference. When supplied, it overrides any preference inferred from objective."),
};
export type PlanTransitParams = z.infer<z.ZodObject<typeof SCHEMA>>;

async function ACTION(params: PlanTransitParams): Promise<{ content: any[]; isError?: boolean }> {
  try {
    const allLocations = [
      params.origin,
      ...params.stops,
      ...(params.final_destination ? [params.final_destination] : []),
    ];
    const resolved = await locationInputsToStrings(
      allLocations,
      allLocations.some((location) => location.kind === "maps_url")
        ? (urls) => new GroundingLiteService(getCurrentApiKey()).resolveMapsUrlsToPlaceIds(urls, "maps_plan_transit")
        : undefined
    );
    const service = new TransitItineraryService(new RoutesService(getCurrentApiKey()));
    const result = await service.optimizeFixedStops({
      origin: resolved[0],
      stops: resolved.slice(1, params.stops.length + 1),
      finalDestination: params.final_destination ? resolved.at(-1) : undefined,
      returnToOrigin: params.return_to_origin,
      departureTime: params.departure_time ? new Date(params.departure_time) : undefined,
      dwellMinutes: params.dwell_minutes,
      detailLevel: params.detail_level,
      objective: params.objective,
      plannerMode: params.planner_mode,
      transitModes: params.transit_modes,
      transitPreference: params.transit_preference,
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error: any) {
    return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
  }
}

export const PlanTransit = { NAME, DESCRIPTION, SCHEMA, ACTION };
