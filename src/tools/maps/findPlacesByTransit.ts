import { z } from "zod";
import { TransitDiscoveryService } from "../../services/TransitDiscoveryService.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
import { locationInputSchema, locationInputsToStrings } from "../../services/location.js";
import { GroundingLiteService } from "../../services/GroundingLiteService.js";

const NAME = "maps_find_places_by_transit";
const DESCRIPTION =
  "Find semantic place candidates and rank them by transit time from an origin. Discovery is bounded and only finalists receive detailed routes. least_walking and fewest_transfers guide Google's transit preference automatically, but the duration-only shortlist means non-time objectives remain bounded heuristics. Cost: T1 | Fan-out: L.";
const SCHEMA = {
  origin: locationInputSchema,
  query: z.string(),
  departure_time: z.string().optional(),
  max_minutes: z.number().positive().optional(),
  objective: z.enum(["fastest", "fewest_transfers", "least_walking", "balanced"]).default("fastest"),
  planner_mode: z.enum(["conservative", "thorough"]).default("conservative"),
};
export type FindPlacesByTransitParams = z.infer<z.ZodObject<typeof SCHEMA>>;

async function ACTION(params: FindPlacesByTransitParams): Promise<{ content: any[]; isError?: boolean }> {
  try {
    const [origin] = await locationInputsToStrings(
      [params.origin],
      params.origin.kind === "maps_url"
        ? (urls) =>
            new GroundingLiteService(getCurrentApiKey()).resolveMapsUrlsToPlaceIds(urls, "maps_find_places_by_transit")
        : undefined
    );
    const result = await new TransitDiscoveryService(getCurrentApiKey()).findPlacesByTransit({
      ...params,
      origin,
      departureTime: params.departure_time ? new Date(params.departure_time) : undefined,
      maxMinutes: params.max_minutes,
      plannerMode: params.planner_mode,
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error: any) {
    return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
  }
}

export const FindPlacesByTransit = { NAME, DESCRIPTION, SCHEMA, ACTION };
