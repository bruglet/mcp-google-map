import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
import { PlaceFieldGroup } from "../../services/costPolicy.js";

const NAME = "maps_place_details";
const DESCRIPTION =
  "Get requested details for one known Google Place ID, returning basic identity, address, coordinates, type, and a Maps URL by default. Use after a search or resolver provides a Place ID; do not use it to discover candidates. Optional contact, hours, ratings, price, reviews, accessibility, amenities, parking, and AI summaries increase the billing tier, so request only data needed for the answer. Cost: T1-T4 | Fan-out: S.";

const SCHEMA = {
  placeId: z
    .string()
    .describe("Google Place ID normally returned by a search tool, maps_resolve_names, or maps_resolve_maps_urls."),
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
      "Detail groups to return in the same request. Omit for basic identity/location; reviews, parking, amenities, and AI summaries are highest-tier data."
    ),
};

export type PlaceDetailsParams = z.infer<z.ZodObject<typeof SCHEMA>>;

async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }> {
  try {
    const apiKey = getCurrentApiKey();
    const placesSearcher = new PlacesSearcher(apiKey);
    const result = await placesSearcher.getPlaceDetails(params.placeId, (params.include || []) as PlaceFieldGroup[]);

    if (!result.success) {
      return {
        content: [{ type: "text", text: result.error || "Failed to get place details" }],
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
      content: [{ type: "text", text: `Error getting place details: ${errorMessage}` }],
    };
  }
}

export const PlaceDetails = {
  NAME,
  DESCRIPTION,
  SCHEMA,
  ACTION,
};
