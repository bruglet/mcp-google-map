import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";

const NAME = "maps_search_along_route";
const DESCRIPTION =
  "Search for places along a route. A route geometry is requested internally because the Places search needs it, while candidate fields remain minimal. Use for family drives, meals, fuel, and stops that should be on the way. Cost: T2 | Fan-out: M.";

const SCHEMA = {
  textQuery: z.string().describe("What to search for along the route (e.g. 'restaurant', 'coffee shop', 'temple')"),
  origin: z.string().describe("Route start point — address or landmark name"),
  destination: z.string().describe("Route end point — address or landmark name"),
  mode: z
    .enum(["driving", "walking", "bicycling", "transit"])
    .optional()
    .describe("Travel mode for the route (default: walking)"),
  maxResults: z.number().optional().describe("Max results to return (default: 5, max: 20)"),
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
