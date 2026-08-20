import { z } from "zod";
import { GroundingLiteService } from "../../services/GroundingLiteService.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";

const NAME = "maps_resolve_names";
const DESCRIPTION =
  "Resolve up to 20 specific place names or addresses to canonical Google Maps Place IDs through Grounding Lite. Do not use for broad category searches. Cost: T1 | Fan-out: S.";
const SCHEMA = {
  queries: z
    .array(z.object({ text: z.string() }))
    .min(1)
    .max(20)
    .describe("Specific names or addresses to resolve"),
  region_code: z.string().length(2).optional().describe("Optional two-letter region code"),
};
export type ResolveNamesParams = z.infer<z.ZodObject<typeof SCHEMA>>;

async function ACTION(params: ResolveNamesParams): Promise<{ content: any[]; isError?: boolean }> {
  try {
    const result = await new GroundingLiteService(getCurrentApiKey()).resolveNames(
      params.queries,
      undefined,
      params.region_code
    );
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (error: any) {
    return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
  }
}

export const ResolveNames = { NAME, DESCRIPTION, SCHEMA, ACTION };
