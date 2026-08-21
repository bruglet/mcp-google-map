import { z } from "zod";
import { GroundingLiteService } from "../../services/GroundingLiteService.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";

const NAME = "maps_grounded_search";
const DESCRIPTION =
  "Search Google Maps semantically and return grounded place suggestions, Maps links, structured output, and required attribution. Use for qualitative or unusual requests such as 'a quiet cafe suitable for reading'; use maps_search_places for conventional text search, maps_search_nearby for type-and-radius search, and the resolver tools for already-known names or URLs. Treat Grounding Lite as discovery and preserve its attribution. Cost: T1 | Fan-out: S.";
const SCHEMA = {
  text_query: z
    .string()
    .describe("Specific natural-language place request including the user's qualitative criteria and relevant area."),
};
export type GroundedSearchParams = z.infer<z.ZodObject<typeof SCHEMA>>;

async function ACTION(params: GroundedSearchParams): Promise<{ content: any[]; isError?: boolean }> {
  try {
    const result = await new GroundingLiteService(getCurrentApiKey()).searchPlaces(params.text_query);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (error: any) {
    return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
  }
}

export const GroundedSearch = { NAME, DESCRIPTION, SCHEMA, ACTION };
