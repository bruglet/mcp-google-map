import assert from "node:assert/strict";
import test from "node:test";
import { createDirectionsUrl, createPlaceUrl } from "../src/services/mapsUrlService.js";
import { locationInputToString, locationInputsToStrings, normalizeLocation } from "../src/services/location.js";
import { GroundingLiteService, extractIndexedPlaceIds } from "../src/services/GroundingLiteService.js";
import serverConfigs, { filterTools } from "../src/config.js";

test("Maps URL generation is local and uses api=1", () => {
  let outboundCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    outboundCalls++;
    throw new Error("URL generation must not fetch");
  };
  try {
    const url = createDirectionsUrl({
      origin: { placeId: "origin-id", label: "Origin" },
      destination: { placeId: "destination-id", label: "Destination" },
      mode: "transit",
      navigate: true,
    });
    assert.match(url, /api=1/);
    assert.match(url, /travelmode=transit/);
    assert.match(url, /dir_action=navigate/);
    assert.equal(outboundCalls, 0);
    assert.match(createPlaceUrl({ placeId: "only-place-id" }), /query_place_id=only-place-id/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("structured locations stay local until a resolver is explicitly selected", () => {
  const coordinates = normalizeLocation({ kind: "coordinates", latitude: 1, longitude: 2, label: "Point" });
  assert.deepEqual(coordinates.coordinates, { latitude: 1, longitude: 2 });
  assert.equal(locationInputToString({ kind: "place_id", value: "abc" }), "place_id:abc");
  assert.equal(
    normalizeLocation({ kind: "maps_url", value: "https://maps.app.goo.gl/example" }).resolutionSource,
    "input"
  );
});

test("request-scoped Maps URL resolution deduplicates repeated URLs", async () => {
  const calls: string[][] = [];
  const repeated = "https://maps.app.goo.gl/example";
  const resolved = await locationInputsToStrings(
    [
      { kind: "maps_url", value: repeated },
      { kind: "query", value: "Somewhere" },
      { kind: "maps_url", value: repeated },
    ],
    async (urls) => {
      calls.push(urls);
      return ["place-id"];
    }
  );
  assert.deepEqual(calls, [[repeated]]);
  assert.deepEqual(resolved, ["place_id:place-id", "Somewhere", "place_id:place-id"]);
});

test("Grounding resolver identities preserve input-index correspondence on mixed failures", () => {
  const values = extractIndexedPlaceIds(
    {
      structuredContent: {
        entities: [{ place: "places/first" }, {}, { place: "places/third" }],
        failedRequests: { "1": { code: 5 } },
      },
    },
    "entities"
  );
  assert.deepEqual(values, ["first", undefined, "third"]);
});

test("Grounding Lite prefers its dedicated server-side key", () => {
  const originalGroundingKey = process.env.GOOGLE_MAPS_GROUNDING_API_KEY;
  const originalMapsKey = process.env.GOOGLE_MAPS_API_KEY;
  const originalTermsAck = process.env.GOOGLE_MAPS_GROUNDING_TERMS_ACK;
  try {
    process.env.GOOGLE_MAPS_GROUNDING_API_KEY = "grounding-key";
    process.env.GOOGLE_MAPS_API_KEY = "main-maps-key";
    process.env.GOOGLE_MAPS_GROUNDING_TERMS_ACK = "true";
    const service = new GroundingLiteService("request-context-key") as unknown as { apiKey: string };
    assert.equal(service.apiKey, "grounding-key");
  } finally {
    if (originalGroundingKey === undefined) delete process.env.GOOGLE_MAPS_GROUNDING_API_KEY;
    else process.env.GOOGLE_MAPS_GROUNDING_API_KEY = originalGroundingKey;
    if (originalMapsKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = originalMapsKey;
    if (originalTermsAck === undefined) delete process.env.GOOGLE_MAPS_GROUNDING_TERMS_ACK;
    else process.env.GOOGLE_MAPS_GROUNDING_TERMS_ACK = originalTermsAck;
  }
});

test("Grounding place search sends the documented origin-bias contract", async () => {
  const originalTermsAck = process.env.GOOGLE_MAPS_GROUNDING_TERMS_ACK;
  type ToolCall = { name: string; arguments: Record<string, unknown> };
  const calls: ToolCall[] = [];
  try {
    process.env.GOOGLE_MAPS_GROUNDING_TERMS_ACK = "true";
    const service = new GroundingLiteService("test-key");
    (
      service as unknown as {
        client: () => Promise<{ callTool: (request: ToolCall) => Promise<{ structuredContent: { places: never[] } }> }>;
      }
    ).client = async () => ({
      callTool: async (request: ToolCall) => {
        calls.push(request);
        return { structuredContent: { places: [] } };
      },
    });

    await service.searchPlaces("quiet coffee shop", "test", {
      circle: {
        center: { latitude: 34.023, longitude: -118.286 },
        radius_meters: 25_000,
      },
    });

    assert.deepEqual(calls, [
      {
        name: "search_places",
        arguments: {
          text_query: "quiet coffee shop",
          location_bias: {
            circle: {
              center: { latitude: 34.023, longitude: -118.286 },
              radius_meters: 25_000,
            },
          },
        },
      },
    ]);
    const locationBias = calls[0].arguments.location_bias as { circle: Record<string, unknown> };
    assert.equal("radius" in locationBias.circle, false);
  } finally {
    if (originalTermsAck === undefined) delete process.env.GOOGLE_MAPS_GROUNDING_TERMS_ACK;
    else process.env.GOOGLE_MAPS_GROUNDING_TERMS_ACK = originalTermsAck;
  }
});

test("tool filtering fails closed for empty or unknown profiles", () => {
  const original = process.env.GOOGLE_MAPS_ENABLED_TOOLS;
  try {
    process.env.GOOGLE_MAPS_ENABLED_TOOLS = "does_not_exist";
    assert.throws(() => filterTools(serverConfigs[0].tools), /Unknown tools/);
    process.env.GOOGLE_MAPS_ENABLED_TOOLS = "";
    assert.throws(() => filterTools(serverConfigs[0].tools), /cannot be empty/);
  } finally {
    if (original === undefined) delete process.env.GOOGLE_MAPS_ENABLED_TOOLS;
    else process.env.GOOGLE_MAPS_ENABLED_TOOLS = original;
  }
});

test("disabled inherited tools are not registered", () => {
  const names = serverConfigs[0].tools.map((tool) => tool.name);
  for (const disabled of [
    "maps_timezone",
    "maps_weather",
    "maps_air_quality",
    "maps_static_map",
    "maps_local_rank_tracker",
  ]) {
    assert.equal(names.includes(disabled), false, `${disabled} is disabled`);
  }
  for (const enabled of ["maps_create_url", "maps_grounded_search", "maps_transit_itinerary", "maps_plan_transit"]) {
    assert.equal(names.includes(enabled), true, `${enabled} is registered`);
  }
});
