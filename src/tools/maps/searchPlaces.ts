import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";

const NAME = "maps_search_places";
const DESCRIPTION =
  "Search for candidate places from a descriptive text query and return minimal identity, address, coordinates, type, Place ID, and Maps URL data. Use for requests such as 'Italian restaurants in Manhattan'; use maps_search_nearby for a specific type within a radius and maps_grounded_search for qualitative or unusual criteria. Rich details are not returned; call maps_place_details only for selected finalists. Cost: T2 | Fan-out: S.";

const SCHEMA = {
  query: z
    .string()
    .describe(
      "Descriptive place query including the relevant category and area, such as 'Italian restaurants in Manhattan'."
    ),
  locationBias: z
    .object({
      latitude: z.number().describe("Latitude in decimal degrees for the result bias."),
      longitude: z.number().describe("Longitude in decimal degrees for the result bias."),
      radius: z.number().optional().describe("Bias radius in meters; defaults to 5000."),
    })
    .optional()
    .describe("Optional geographic bias; this influences ranking rather than imposing a strict boundary."),
  openNow: z.boolean().optional().describe("Set true to filter to places open now; opening hours are not returned."),
  minRating: z.number().optional().describe("Optional 1.0-5.0 minimum-rating filter; ratings are not returned."),
  includedType: z.string().optional().describe("Optional Places type filter such as restaurant, cafe, or hotel."),
};

export type SearchPlacesParams = z.infer<z.ZodObject<typeof SCHEMA>>;

async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }> {
  try {
    const apiKey = getCurrentApiKey();
    const placesSearcher = new PlacesSearcher(apiKey);
    const result = await placesSearcher.searchText({
      query: params.query,
      locationBias: params.locationBias,
      openNow: params.openNow,
      minRating: params.minRating,
      includedType: params.includedType,
    });

    if (!result.success) {
      return {
        content: [{ type: "text", text: result.error || "Failed to search places" }],
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
      content: [{ type: "text", text: `Error searching places: ${errorMessage}` }],
    };
  }
}

export const SearchPlaces = {
  NAME,
  DESCRIPTION,
  SCHEMA,
  ACTION,
};
