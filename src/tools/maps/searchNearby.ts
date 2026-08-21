import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";

const NAME = "maps_search_nearby";
const DESCRIPTION =
  "Find nearby candidate places of a specific type and return minimal identity and location data. Use for requests such as 'cafes within 1 km of here'; use maps_search_places for a descriptive text query and maps_grounded_search for qualitative discovery. Filters can restrict results without returning ratings or hours. Cost: T2 | Fan-out: S.";

const SCHEMA = {
  center: z
    .object({
      value: z.string().describe("Search-center address or landmark, or coordinates formatted as latitude,longitude."),
      isCoordinates: z.boolean().default(false).describe("Set true only when value is a latitude,longitude pair."),
    })
    .describe("Center of the radius search; pass a known address directly instead of geocoding it first."),
  keyword: z
    .string()
    .optional()
    .describe("Places type to find, such as restaurant, cafe, hotel, gas_station, or hospital."),
  radius: z.number().default(1000).describe("Search radius in meters; defaults to 1000."),
  openNow: z
    .boolean()
    .default(false)
    .describe("Set true to filter to places open now; opening hours are not returned."),
  minRating: z
    .number()
    .min(0)
    .max(5)
    .optional()
    .describe("Optional 0-5 minimum-rating filter; ratings are not returned."),
};

export type SearchNearbyParams = z.infer<z.ZodObject<typeof SCHEMA>>;

async function ACTION(params: SearchNearbyParams): Promise<{ content: any[]; isError?: boolean }> {
  try {
    // Create a new PlacesSearcher instance with the current request's API key
    const apiKey = getCurrentApiKey();
    const placesSearcher = new PlacesSearcher(apiKey);
    const result = await placesSearcher.searchNearby(params);

    if (!result.success) {
      return {
        content: [{ type: "text", text: result.error || "Search failed" }],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `location: ${JSON.stringify(result.location, null, 2)}\n` + JSON.stringify(result.data, null, 2),
        },
      ],
      isError: false,
    };
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      isError: true,
      content: [{ type: "text", text: `Error searching nearby places: ${errorMessage}` }],
    };
  }
}

export const SearchNearby = {
  NAME,
  DESCRIPTION,
  SCHEMA,
  ACTION,
};
