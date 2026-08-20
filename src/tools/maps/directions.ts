import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";

const NAME = "maps_directions";
const DESCRIPTION =
  "Get directions between two points. Defaults to a compact summary; request steps when the user needs turn-by-turn or transit line details, and geometry only when a polyline is required. Driving traffic defaults to none; traffic-aware/optimal promotes the request to Routes Pro. Cost: T1-T2 | Fan-out: S.";

const SCHEMA = {
  origin: z.string().describe("Starting point address or coordinates"),
  destination: z.string().describe("Destination address or coordinates"),
  mode: z
    .enum(["driving", "walking", "bicycling", "transit"])
    .default("driving")
    .describe("Travel mode for directions"),
  departure_time: z.string().optional().describe("Departure time (ISO string format)"),
  arrival_time: z.string().optional().describe("Arrival time (ISO string format)"),
  alternatives: z.boolean().optional().describe("Request alternate routes. Defaults false."),
  detail_level: z
    .enum(["summary", "steps", "geometry", "full"])
    .default("summary")
    .describe("Response detail. Summary is smallest; geometry/full add encoded polylines."),
  traffic: z
    .enum(["none", "aware", "optimal"])
    .default("none")
    .describe("Driving traffic policy. none is cheapest/default; aware and optimal use traffic-aware routing."),
  transit_modes: z
    .array(z.enum(["bus", "subway", "train", "light_rail", "rail"]))
    .optional()
    .describe("Optional preferred transit modes."),
  transit_preference: z.enum(["less_walking", "fewer_transfers"]).optional().describe("Optional transit preference."),
  avoid_tolls: z
    .boolean()
    .optional()
    .describe('Avoid toll roads where reasonable. Only supported with mode "driving".'),
  avoid_highways: z
    .boolean()
    .optional()
    .describe('Avoid highways where reasonable. Only supported with mode "driving".'),
};

export type DirectionsParams = z.infer<z.ZodObject<typeof SCHEMA>>;

async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }> {
  try {
    // Create a new PlacesSearcher instance with the current request's API key
    const apiKey = getCurrentApiKey();
    const placesSearcher = new PlacesSearcher(apiKey);
    const result = await placesSearcher.getDirections(
      params.origin,
      params.destination,
      params.mode,
      params.departure_time,
      params.arrival_time,
      params.avoid_tolls,
      params.avoid_highways,
      params.traffic,
      params.alternatives,
      params.detail_level,
      params.transit_modes,
      params.transit_preference
    );

    if (!result.success) {
      return {
        content: [{ type: "text", text: result.error || "Failed to get directions" }],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result.data, null, 2),
        },
      ],
      isError: false,
    };
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      isError: true,
      content: [{ type: "text", text: `Error getting directions: ${errorMessage}` }],
    };
  }
}

export const Directions = {
  NAME,
  DESCRIPTION,
  SCHEMA,
  ACTION,
};
