import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";

const NAME = "maps_batch_geocode";
const DESCRIPTION =
  "Convert up to 50 addresses or landmark names to coordinates while preserving input order and per-item failures. Use when the user needs coordinates for a list; use maps_geocode for one location, and do not geocode values merely to pass them to routes that already accept addresses. Each item consumes a separate Geocoding request. Cost: T1 | Fan-out: M/L.";

const SCHEMA = {
  addresses: z
    .array(z.string())
    .min(1)
    .max(50)
    .describe("Addresses or landmark names to convert, in the order results should be returned; maximum 50."),
};

export type BatchGeocodeParams = z.infer<z.ZodObject<typeof SCHEMA>>;

async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }> {
  try {
    const apiKey = getCurrentApiKey();
    const searcher = new PlacesSearcher(apiKey);
    const addresses: string[] = params.addresses;

    const uniqueAddresses = [...new Set(addresses)];
    const resolved = await Promise.all(
      uniqueAddresses.map(async (address: string) => {
        try {
          const result = await searcher.geocode(address, "maps_batch_geocode");
          return { address, ...result };
        } catch (error: any) {
          return { address, success: false, error: error.message };
        }
      })
    );
    const resultByAddress = new Map(resolved.map((result) => [result.address, result]));
    const results = addresses.map((address) => resultByAddress.get(address)!);

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ total: addresses.length, succeeded, failed, results }, null, 2),
        },
      ],
      isError: false,
    };
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      isError: true,
      content: [{ type: "text", text: `Error batch geocoding: ${errorMessage}` }],
    };
  }
}

export const BatchGeocode = {
  NAME,
  DESCRIPTION,
  SCHEMA,
  ACTION,
};
