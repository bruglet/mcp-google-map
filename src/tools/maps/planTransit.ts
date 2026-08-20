import { z } from "zod";
import { TransitItineraryService } from "../../services/TransitItineraryService.js";
import { RoutesService } from "../../services/RoutesService.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
import { locationInputSchema, locationInputsToStrings } from "../../services/location.js";
import { GroundingLiteService } from "../../services/GroundingLiteService.js";

const NAME = "maps_plan_transit";
const DESCRIPTION =
  "Find the best order for known transit stops using a bounded coarse matrix, local optimization, and chronological exact reranking. Cost: T1 | Fan-out: L; matrix elements are counted.";
const SCHEMA = {
  origin: locationInputSchema.describe("Starting point"),
  stops: z.array(locationInputSchema).min(1).describe("Known stops whose order may change"),
  final_destination: locationInputSchema.optional(),
  return_to_origin: z.boolean().default(false),
  departure_time: z.string().optional(),
  dwell_minutes: z.array(z.number().int().min(0)).optional(),
  detail_level: z.enum(["summary", "steps", "geometry", "full"]).default("steps"),
  objective: z.enum(["fastest", "fewest_transfers", "least_walking", "balanced"]).default("fastest"),
  planner_mode: z.enum(["conservative", "thorough"]).default("conservative"),
  transit_modes: z.array(z.enum(["bus", "subway", "train", "light_rail", "rail"])).optional(),
  transit_preference: z.enum(["less_walking", "fewer_transfers"]).optional(),
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
