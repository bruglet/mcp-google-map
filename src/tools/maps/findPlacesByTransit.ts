import { z } from "zod";
import { TransitDiscoveryService } from "../../services/TransitDiscoveryService.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
import { locationInputSchema, locationInputsToStrings } from "../../services/location.js";
import { GroundingLiteService } from "../../services/GroundingLiteService.js";

const NAME = "maps_find_places_by_transit";
const DESCRIPTION =
  "Discover places matching a semantic request and rank bounded finalists by transit accessibility from one origin, returning exact itineraries for the finalists. Use for requests such as 'find a good grocery store within 30 minutes by transit'; use maps_search_places for non-transit discovery and maps_compare_places for comparing already-simple candidates across any mode. Non-time objectives use a duration-based shortlist, so they are bounded heuristics. Cost: T1 | Fan-out: L.";
const SCHEMA = {
  origin: locationInputSchema.describe("Transit starting point as a query, Place ID, coordinates, or Maps URL."),
  query: z
    .string()
    .describe(
      "Natural-language description of the places to discover, including the relevant category and qualitative criteria."
    ),
  departure_time: z.string().optional().describe("ISO 8601 transit departure time; defaults to now."),
  max_minutes: z
    .number()
    .positive()
    .optional()
    .describe("Optional maximum one-way transit duration in minutes used to exclude coarse candidates."),
  objective: z
    .enum(["fastest", "fewest_transfers", "least_walking", "balanced"])
    .default("fastest")
    .describe("Ranking goal; least_walking and fewest_transfers also guide Google transit requests."),
  planner_mode: z
    .enum(["conservative", "thorough"])
    .default("conservative")
    .describe(
      "Use conservative by default; choose thorough only when broader discovery is clearly warranted. Thorough can exact-route up to 10 finalists instead of 3."
    ),
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
