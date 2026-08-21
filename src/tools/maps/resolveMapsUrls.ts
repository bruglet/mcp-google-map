import { z } from "zod";
import { GroundingLiteService } from "../../services/GroundingLiteService.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";

const NAME = "maps_resolve_maps_urls";
const DESCRIPTION =
  "Resolve up to 20 Google Maps or maps.app.goo.gl URLs to canonical place identities while preserving input correspondence and mixed failures. Use when the user supplies Maps links and a Place ID or structured identity is needed; do not use it merely to return or share an existing URL, and do not scrape shortened URLs manually. Cost: T1 | Fan-out: S.";
const SCHEMA = {
  urls: z
    .array(z.string().url())
    .min(1)
    .max(20)
    .describe(
      "Google Maps or maps.app.goo.gl URLs to resolve together, in the order results should be returned; maximum 20."
    ),
};
export type ResolveMapsUrlsParams = z.infer<z.ZodObject<typeof SCHEMA>>;

async function ACTION(params: ResolveMapsUrlsParams): Promise<{ content: any[]; isError?: boolean }> {
  try {
    const result = await new GroundingLiteService(getCurrentApiKey()).resolveMapsUrls(params.urls);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (error: any) {
    return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
  }
}

export const ResolveMapsUrls = { NAME, DESCRIPTION, SCHEMA, ACTION };
