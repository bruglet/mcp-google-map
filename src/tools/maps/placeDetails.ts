import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
import { PlaceFieldGroup } from "../../services/costPolicy.js";

const NAME = "maps_place_details";
const DESCRIPTION =
  "Get details for a known Google Place ID. Defaults to identity, address, coordinates, type, and a local Google Maps URL. Optional contact, hours, ratings, price, reviews, accessibility, amenities, parking, or AI summary groups increase the Places billing tier; request only what the user needs. Cost: T1-T4 | Fan-out: S.";

const SCHEMA = {
  placeId: z.string().describe("Google Maps place ID"),
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
      "Optional semantic enrichment groups. Defaults to none; reviews, parking, amenities, and summaries are highest-tier data."
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
