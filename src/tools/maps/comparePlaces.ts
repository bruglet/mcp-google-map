import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";

const NAME = "maps_compare_places";
const DESCRIPTION =
  "Search for a bounded set of places and compare their basic data side by side, optionally adding travel times from one user location or selected detail groups. Use when the user is choosing among alternatives; use maps_search_places for discovery without comparison and maps_place_details for one already-known Place ID. Route comparison requires userLocation, and enrichment is opt-in and may be high-tier. Cost: T1-T4 | Fan-out: M.";

const SCHEMA = {
  query: z.string().describe("Focused comparison query including category and area, such as 'ramen near Shibuya'."),
  userLocation: z
    .object({
      latitude: z.number().describe("User-origin latitude in decimal degrees."),
      longitude: z.number().describe("User-origin longitude in decimal degrees."),
    })
    .optional()
    .describe("Optional route-comparison origin; when supplied, adds distance and travel time to each result."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Maximum candidates to compare; defaults to 5 and is planner-capped."),
  mode: z
    .enum(["driving", "walking", "bicycling", "transit"])
    .default("transit")
    .describe("Travel mode for route comparisons from userLocation; defaults to transit."),
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
      "Place Details groups to add for candidates. Omit for a minimal comparison; reviews, parking, amenities, and AI summaries are highest-tier."
    ),
  planner_mode: z
    .enum(["conservative", "thorough"])
    .default("conservative")
    .describe(
      "Use conservative by default; choose thorough only when the request needs more candidates or enrichments."
    ),
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
