import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";

const NAME = "maps_search_along_route";
const DESCRIPTION =
  "Return minimal place candidates located along one route between an origin and destination. Use when the user wants food, fuel, or another stop that is on the way; use maps_search_nearby for places around one point and maps_plan_route when the stops are already known. Route geometry is required for this search, but ratings, hours, and reviews are not fetched. Cost: T2 | Fan-out: M.";

const SCHEMA = {
  textQuery: z
    .string()
    .describe("Place category or query to find along the route, such as restaurant, coffee shop, or gas station."),
  origin: z.string().describe("Route-start address, Place ID, landmark, or coordinates; pass a known value directly."),
  destination: z
    .string()
    .describe("Route-end address, Place ID, landmark, or coordinates; pass a known value directly."),
  mode: z
    .enum(["driving", "walking", "bicycling", "transit"])
    .optional()
    .describe("Travel mode used to establish the route corridor; defaults to walking."),
  maxResults: z.number().optional().describe("Maximum candidates to return; defaults to 5 and cannot exceed 20."),
};

export type SearchAlongRouteParams = z.infer<z.ZodObject<typeof SCHEMA>>;

async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }> {
  try {
    const apiKey = getCurrentApiKey();
    const searcher = new PlacesSearcher(apiKey);
    const result = await searcher.searchAlongRoute(params);

    if (!result.success) {
      return {
        content: [{ type: "text", text: result.error || "Failed to search along route" }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }],
      isError: false,
    };
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      isError: true,
      content: [{ type: "text", text: `Error searching along route: ${errorMessage}` }],
    };
  }
}

export const SearchAlongRoute = {
  NAME,
  DESCRIPTION,
  SCHEMA,
  ACTION,
};
