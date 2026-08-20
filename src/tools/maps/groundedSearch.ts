import { z } from "zod";
import { GroundingLiteService } from "../../services/GroundingLiteService.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";

const NAME = "maps_grounded_search";
const DESCRIPTION =
  "Search Google Maps semantically through Maps Grounding Lite. Prefer this for unusual or qualitative place discovery. Preserve returned attribution. Cost: T1 | Fan-out: S.";
const SCHEMA = { text_query: z.string().describe("Specific semantic place search query") };
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
