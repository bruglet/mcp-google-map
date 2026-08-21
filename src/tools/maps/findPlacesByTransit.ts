import { z } from "zod";
import { TransitDiscoveryService } from "../../services/TransitDiscoveryService.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
import { locationInputSchema, locationInputsToStrings } from "../../services/location.js";
import { GroundingLiteService } from "../../services/GroundingLiteService.js";

const NAME = "maps_find_places_by_transit";
const DESCRIPTION =
  "Discover a bounded set of literal and semantic place candidates near one origin, then rank transit-reachable finalists with exact chronological itineraries. Use for requests such as 'find a Walmart within 60 minutes by transit'; use maps_search_places when transit accessibility is not part of the request, maps_transit_itinerary for a fixed path, and maps_plan_transit when all stops are already known. Results combine origin-biased Grounding Lite and minimal Places search; max_minutes filters actual one-way transit time, and non-time objectives use a duration-based shortlist heuristic. Cost: T1/T2 | Fan-out: L.";
const SCHEMA = {
  origin: locationInputSchema.describe("Transit starting point as a query, Place ID, coordinates, or Maps URL."),
  query: z
    .string()
    .describe(
      "Describe the branch or category and any qualitative criteria, such as 'Walmart stores near Los Angeles' or 'a quiet grocery store'. Literal brand/category requests use Places search for branch recall and qualitative requests also use Grounding Lite."
    ),
  departure_time: z.string().optional().describe("ISO 8601 transit departure time; defaults to now."),
  max_minutes: z
    .number()
    .positive()
    .optional()
    .describe(
      "Optional maximum one-way transit duration in minutes. Candidates are shortlisted with a transit matrix and excluded again if exact routing exceeds this limit; this is not a geographic radius."
    ),
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
      originInput:
        params.origin.kind === "maps_url"
          ? { kind: "place_id", value: origin.slice("place_id:".length) }
          : params.origin,
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
