import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";

const NAME = "maps_directions";
const DESCRIPTION =
  "Return a route between one origin and destination, including distance and duration, with optional steps, transit details, or geometry. Use for a specific A-to-B route; use maps_distance_matrix to compare many pairs, maps_plan_route for non-transit multi-stop routing, or maps_transit_itinerary for an ordered multi-leg transit trip. Summary is the default, and traffic-aware driving is higher-tier. Cost: T1-T2 | Fan-out: S.";

const SCHEMA = {
  origin: z.string().describe("Starting address, Place ID, or latitude,longitude; pass a known value directly."),
  destination: z
    .string()
    .describe("Destination address, Place ID, or latitude,longitude; pass a known value directly."),
  mode: z
    .enum(["driving", "walking", "bicycling", "transit"])
    .default("driving")
    .describe("Travel mode; defaults to driving."),
  departure_time: z.string().optional().describe("ISO 8601 departure time; mutually exclusive with arrival_time."),
  arrival_time: z
    .string()
    .optional()
    .describe("ISO 8601 desired arrival time; mutually exclusive with departure_time."),
  alternatives: z
    .boolean()
    .optional()
    .describe("Set true only when the user wants alternate routes; defaults to false."),
  detail_level: z
    .enum(["summary", "steps", "geometry", "full"])
    .default("summary")
    .describe(
      "Use summary for time/distance, steps for instructions or transit lines, geometry for a polyline, and full only when both are needed."
    ),
  traffic: z
    .enum(["none", "aware", "optimal"])
    .default("none")
    .describe(
      "Driving-only traffic policy. none is the default; aware and optimal use higher-tier traffic-aware routing."
    ),
  transit_modes: z
    .array(z.enum(["bus", "subway", "train", "light_rail", "rail"]))
    .optional()
    .describe("Transit modes to prefer when mode is transit; omit to allow all supported modes."),
  transit_preference: z
    .enum(["less_walking", "fewer_transfers"])
    .optional()
    .describe("Transit-only preference; omit when fastest overall travel is more important."),
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
