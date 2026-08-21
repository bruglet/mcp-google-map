import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";

const NAME = "maps_explore_area";
const DESCRIPTION =
  "Return bounded nearby candidates across several place categories for a neighborhood overview. Use when the user wants to explore what is around an area; use maps_search_nearby for one category and maps_compare_places for a focused side-by-side comparison. Enrichment is opt-in and can be high-tier; enrich_top_n defaults to 0 and does nothing without include groups. Cost: T1-T4 | Fan-out: M.";

const SCHEMA = {
  location: z
    .string()
    .describe("Address, landmark, or coordinates at the center of the area; pass known values directly."),
  types: z
    .array(z.string())
    .optional()
    .describe(
      "Places API type names to explore, such as hotel, bar, park, or museum; defaults to restaurant, cafe, and tourist_attraction."
    ),
  radius: z.number().optional().describe("Search radius in meters; defaults to 1000."),
  enrich_top_n: z
    .number()
    .int()
    .min(0)
    .max(10)
    .default(0)
    .describe("Number of top candidates per type to enrich; defaults to 0 and requires include groups."),
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
    .describe(
      "Detail groups for enriched finalists only; omit to keep all candidates minimal. Reviews, parking, amenities, and AI summaries are highest-tier."
    ),
  planner_mode: z
    .enum(["conservative", "thorough"])
    .default("conservative")
    .describe(
      "Use conservative by default; choose thorough only when the request clearly needs broader bounded exploration."
    ),
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
