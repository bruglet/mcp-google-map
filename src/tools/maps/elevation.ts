import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";

const NAME = "maps_elevation";
const DESCRIPTION =
  "Return elevation in meters for one or more coordinates. Use when the user asks for altitude or needs elevation samples for terrain context; this is not a flood-risk assessment or a route-profile tool, so supply each point to sample. Cost: T2 | Fan-out: S-L by location count.";

const SCHEMA = {
  locations: z
    .array(
      z.object({
        latitude: z.number().describe("Latitude in decimal degrees."),
        longitude: z.number().describe("Longitude in decimal degrees."),
      })
    )
    .describe("Coordinates to sample in one batched request; results correspond to this input order."),
};

export type ElevationParams = z.infer<z.ZodObject<typeof SCHEMA>>;

async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }> {
  try {
    // Create a new PlacesSearcher instance with the current request's API key
    const apiKey = getCurrentApiKey();
    const placesSearcher = new PlacesSearcher(apiKey);
    const result = await placesSearcher.getElevation(params.locations);

    if (!result.success) {
      return {
        content: [{ type: "text", text: result.error || "Failed to get elevation data" }],
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
      content: [{ type: "text", text: `Error getting elevation data: ${errorMessage}` }],
    };
  }
}

export const Elevation = {
  NAME,
  DESCRIPTION,
  SCHEMA,
  ACTION,
};
