import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";

const NAME = "maps_explore_area";
const DESCRIPTION =
  "Explore nearby categories in one call. Candidate search is cheap and detail enrichment is opt-in; enrich_top_n defaults to 0. Use for a neighborhood overview, not generic reviews/photos. Cost: T1-T4 | Fan-out: M.";

const SCHEMA = {
  location: z.string().describe("Address or landmark to explore around"),
  types: z
    .array(z.string())
    .optional()
    .describe(
      "Place types to search (default: restaurant, cafe, tourist_attraction). Must be Places API (New) type names. Examples: hotel, bar, park, museum"
    ),
  radius: z.number().optional().describe("Search radius in meters (default: 1000)"),
  enrich_top_n: z
    .number()
    .int()
    .min(0)
    .max(10)
    .default(0)
    .describe("Number of top results per type to enrich; default 0"),
  include: z
    .array(
      z.enum([
        "contact",
        "hours",
        "ratings",
        "price",
        "reviews",
        "accessibility",
        "amenities",
        "parking",
        "ai_summaries",
      ])
    )
    .optional()
    .describe("Optional detail groups for enriched candidates"),
};

export type ExploreAreaParams = z.infer<z.ZodObject<typeof SCHEMA>>;

async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }> {
  try {
    const apiKey = getCurrentApiKey();
    const searcher = new PlacesSearcher(apiKey);
    const result = await searcher.exploreArea(params);

    return {
      content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }],
      isError: false,
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error exploring area: ${error.message}` }],
    };
  }
}

export const ExploreArea = { NAME, DESCRIPTION, SCHEMA, ACTION };
