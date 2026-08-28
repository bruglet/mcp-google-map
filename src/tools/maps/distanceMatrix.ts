import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";

const NAME = "maps_distance_matrix";
const DESCRIPTION =
  "Return distance, duration, and availability for every origin-destination pair. Use to compare many route pairs or shortlist candidates; use maps_directions for one detailed route and the transit planners for stop ordering. Usage is billed per origins x destinations element, and this direct tool is limited to 100 elements. Cost: T1-T2 | Fan-out: M/L.";

const SCHEMA = {
  origins: z
    .array(z.string())
    .describe(
      "Origin addresses, raw Place IDs, places/<id> resource names, or latitude,longitude strings; pass known values directly."
    ),
  destinations: z
    .array(z.string())
    .describe(
      "Destination addresses, raw Place IDs, places/<id> resource names, or latitude,longitude strings; every origin is paired with every destination."
    ),
  mode: z
    .enum(["driving", "walking", "bicycling", "transit"])
    .default("driving")
    .describe("Travel mode for all matrix pairs; defaults to driving."),
  departure_time: z
    .string()
    .optional()
    .describe(
      "Departure time in ISO 8601 format (e.g. 2026-03-21T09:00:00Z). Controls time-dependent routing and transit schedules; it does not enable live driving traffic unless traffic is aware or optimal."
    ),
  avoid_tolls: z
    .boolean()
    .optional()
    .describe('Avoid toll roads where reasonable. Only supported with mode "driving".'),
  avoid_highways: z
    .boolean()
    .optional()
    .describe('Avoid highways where reasonable. Only supported with mode "driving".'),
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
};

export type DistanceMatrixParams = z.infer<z.ZodObject<typeof SCHEMA>>;

async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }> {
  try {
    // Create a new PlacesSearcher instance with the current request's API key
    const apiKey = getCurrentApiKey();
    const placesSearcher = new PlacesSearcher(apiKey);
    const result = await placesSearcher.calculateDistanceMatrix(
      params.origins,
      params.destinations,
      params.mode,
      params.departure_time,
      params.avoid_tolls,
      params.avoid_highways,
      params.traffic,
      params.transit_modes,
      params.transit_preference
    );

    if (!result.success) {
      return {
        content: [{ type: "text", text: result.error || "Failed to calculate distance matrix" }],
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
      content: [{ type: "text", text: `Error calculating distance matrix: ${errorMessage}` }],
    };
  }
}

export const DistanceMatrix = {
  NAME,
  DESCRIPTION,
  SCHEMA,
  ACTION,
};
