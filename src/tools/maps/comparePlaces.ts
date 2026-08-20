import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";

const NAME = "maps_compare_places";
const DESCRIPTION =
  "Compare bounded candidate places side-by-side. Search and basic identity are returned by default; optional enrichment and route-matrix comparison are explicit. Travel mode is configurable and defaults to transit when a user location is supplied. planner_mode controls the candidate and high-tier enrichment caps. Cost: T1-T4 | Fan-out: M.";

const SCHEMA = {
  query: z.string().describe("Search query (e.g., 'ramen near Shibuya', 'hotels in Taipei')"),
  userLocation: z
    .object({
      latitude: z.number().describe("Your latitude"),
      longitude: z.number().describe("Your longitude"),
    })
    .optional()
    .describe("Your current location — if provided, adds distance and drive time to each result"),
  limit: z.number().int().min(1).max(10).optional().describe("Max places to compare (default: 5; planner-capped)"),
  mode: z
    .enum(["driving", "walking", "bicycling", "transit"])
    .default("transit")
    .describe("Optional comparison travel mode"),
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
    .describe("Optional Place Details groups"),
  planner_mode: z.enum(["conservative", "thorough"]).default("conservative"),
};

export type ComparePlacesParams = z.infer<z.ZodObject<typeof SCHEMA>>;

async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }> {
  try {
    const apiKey = getCurrentApiKey();
    const searcher = new PlacesSearcher(apiKey);
    const result = await searcher.comparePlaces(params);

    return {
      content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }],
      isError: false,
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error comparing places: ${error.message}` }],
    };
  }
}

export const ComparePlaces = { NAME, DESCRIPTION, SCHEMA, ACTION };
