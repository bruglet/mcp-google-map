import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { withAccounting } from "./requestAccounting.js";

const GROUNDING_ENDPOINT = "https://mapstools.googleapis.com/mcp";

export class GroundingLiteService {
  private clientPromise: Promise<Client> | null = null;
  private readonly apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = process.env.GOOGLE_MAPS_GROUNDING_API_KEY || apiKey || process.env.GOOGLE_MAPS_API_KEY || "";
    if (!this.apiKey) throw new Error("Google Maps API Key is required for Grounding Lite");
    if (process.env.GOOGLE_MAPS_GROUNDING_TERMS_ACK !== "true") {
      throw new Error(
        "GROUNDING_UNAVAILABLE: set GOOGLE_MAPS_GROUNDING_TERMS_ACK=true after accepting the Grounding Lite data-use terms"
      );
    }
  }

  async searchPlaces(textQuery: string): Promise<any> {
    const client = await this.client();
    return withAccounting(
      {
        api: "grounding-lite",
        operation: "search_places",
        tier: "T1",
        units: 1,
        parentTool: "maps_grounded_search",
        reason: "semantic Google Maps place discovery",
        fanout: "S",
      },
      async () => {
        const result = await client.callTool({ name: "search_places", arguments: { text_query: textQuery } });
        if (result.isError) throw new Error("Grounding Lite search_places returned an error");
        return result;
      },
      { unavailableOnError: true }
    );
  }

  async resolveNames(queries: Array<{ text: string }>, locationBias?: unknown, regionCode?: string): Promise<any> {
    if (queries.length > 20) throw new Error("Grounding Lite resolve_names accepts at most 20 queries per request.");
    const client = await this.client();
    return withAccounting(
      {
        api: "grounding-lite",
        operation: "resolve_names",
        tier: "T1",
        units: 1,
        parentTool: "maps_resolve_names",
        reason: "explicit Place ID resolution",
        fanout: "S",
      },
      async () => {
        const result = await client.callTool({
          name: "resolve_names",
          arguments: {
            queries,
            ...(locationBias ? { location_bias: locationBias } : {}),
            ...(regionCode ? { region_code: regionCode } : {}),
          },
        });
        if (result.isError) throw new Error("Grounding Lite resolve_names returned an error");
        return result;
      },
      { unavailableOnError: true }
    );
  }

  async resolveMapsUrls(urls: string[]): Promise<any> {
    if (urls.length > 20) throw new Error("Grounding Lite resolve_maps_urls accepts at most 20 URLs per request.");
    const client = await this.client();
    return withAccounting(
      {
        api: "grounding-lite",
        operation: "resolve_maps_urls",
        tier: "T1",
        units: 1,
        parentTool: "maps_resolve_maps_urls",
        reason: "explicit Maps URL resolution",
        fanout: "S",
      },
      async () => {
        const result = await client.callTool({ name: "resolve_maps_urls", arguments: { urls } });
        if (result.isError) throw new Error("Grounding Lite resolve_maps_urls returned an error");
        return result;
      },
      { unavailableOnError: true }
    );
  }

  async resolveMapsUrlsToPlaceIds(urls: string[]): Promise<string[]> {
    const result = await this.resolveMapsUrls(urls);
    const values = extractIndexedPlaceIds(result, "entities");
    if (!values || values.length < urls.length || values.some((value) => !value))
      throw new Error("GROUNDING_UNAVAILABLE: Maps URL resolution returned incomplete structured identities");
    return values.slice(0, urls.length) as string[];
  }

  private client(): Promise<Client> {
    if (!this.clientPromise) {
      this.clientPromise = this.connect().catch((error) => {
        this.clientPromise = null;
        throw new Error(`GROUNDING_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    return this.clientPromise;
  }

  private async connect(): Promise<Client> {
    const client = new Client({ name: "bruglet-mcp-google-map", version: "0.1.0" }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(GROUNDING_ENDPOINT), {
      requestInit: { headers: { "X-Goog-Api-Key": this.apiKey } },
      reconnectionOptions: {
        maxReconnectionDelay: 5000,
        initialReconnectionDelay: 250,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: 1,
      },
    });
    await client.connect(transport);
    return client;
  }
}

/**
 * Extract Grounding Lite resolver identities without collapsing failed
 * entries. The service guarantees that `entities` and `results` are aligned
 * with the input indices, so callers must preserve empty positions.
 */
export function extractIndexedPlaceIds(
  result: any,
  collection: "entities" | "results"
): Array<string | undefined> | undefined {
  for (const payload of structuredPayloads(result)) {
    const entries = payload?.[collection];
    if (!Array.isArray(entries)) continue;
    return entries.map((entry: any) => {
      if (typeof entry === "string") return normalizePlaceResource(entry);
      const candidate = entry?.entity?.place || entry?.place || entry?.placeId || entry?.place_id;
      return typeof candidate === "string" ? normalizePlaceResource(candidate) : undefined;
    });
  }
  return undefined;
}

function normalizePlaceResource(value: string): string {
  return value.startsWith("places/") ? value.slice("places/".length) : value;
}

function structuredPayloads(result: any): any[] {
  const payloads: any[] = [];
  if (result?.structuredContent) payloads.push(result.structuredContent);

  const content = result?.content;
  for (const block of Array.isArray(content) ? content : content ? [content] : []) {
    if (typeof block?.text !== "string") continue;
    try {
      payloads.push(JSON.parse(block.text));
    } catch {
      // An unparseable text block is preserved in the raw tool response. It
      // cannot be used for a structured internal location handoff.
    }
  }

  if (!payloads.length && result) payloads.push(result);
  return payloads;
}
