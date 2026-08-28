import assert from "node:assert/strict";
import test from "node:test";
import type { PlacesClient } from "@googlemaps/places";
import { NewPlacesService } from "../src/services/NewPlacesService.js";
import { PlacesSearcher } from "../src/services/PlacesSearcher.js";
import { RoutesService, buildRoutesFieldMask } from "../src/services/RoutesService.js";
import { GoogleMapsTools } from "../src/services/toolclass.js";

test("Place Details makes one minimal Places New request by default", async () => {
  const calls: Array<{ method: string; mask: string }> = [];
  const fakeClient = {
    getPlace: async (_request: unknown, options: { otherArgs: { headers: { "X-Goog-FieldMask": string } } }) => {
      calls.push({ method: "getPlace", mask: options.otherArgs.headers["X-Goog-FieldMask"] });
      return [{ name: "places/test", displayName: { text: "Test Place" }, location: { latitude: 1, longitude: 2 } }];
    },
  } as unknown as PlacesClient;
  const service = new NewPlacesService("test-key", fakeClient);

  await service.getPlaceDetails("test");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "getPlace");
  assert.match(calls[0].mask, /displayName/);
  assert.doesNotMatch(calls[0].mask, /reviews|rating|OpeningHours|price|Phone|website|parking/i);
});

test("Places search requests keep the default mask minimal", async () => {
  let mask = "";
  const fakeClient = {
    searchText: async (_request: unknown, options: { otherArgs: { headers: { "X-Goog-FieldMask": string } } }) => {
      mask = options.otherArgs.headers["X-Goog-FieldMask"];
      return [{ places: [] }];
    },
  } as unknown as PlacesClient;
  const service = new NewPlacesService("test-key", fakeClient);

  await service.searchText({ textQuery: "coffee" });

  assert.match(mask, /^places\./);
  assert.doesNotMatch(mask, /reviews|rating|OpeningHours|price|Phone|website|photos/i);
});

test("route detail masks only add steps or geometry when requested", () => {
  const summary = buildRoutesFieldMask("summary");
  const steps = buildRoutesFieldMask("steps");
  const geometry = buildRoutesFieldMask("geometry");
  assert.doesNotMatch(summary, /steps|polyline/);
  assert.match(steps, /steps\.transitDetails/);
  assert.doesNotMatch(steps, /polyline/);
  assert.match(geometry, /polyline/);
  assert.doesNotMatch(geometry, /steps/);
  assert.match(buildRoutesFieldMask("summary", true), /optimizedIntermediateWaypointIndex/);
});

test("basic driving omits traffic and waypoint optimization", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  try {
    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ routes: [{ distanceMeters: 100, duration: "60s", description: "test" }] }), {
        status: 200,
      });
    };
    await new RoutesService("test-key").computeRoutes({
      origin: "1,2",
      destination: "3,4",
      mode: "driving",
      intermediates: ["5,6"],
      optimizeWaypointOrder: false,
    });
    assert.equal(requestBody?.routingPreference, undefined);
    assert.equal(requestBody?.optimizeWaypointOrder, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Routes serializes raw and resource Place IDs as placeId waypoints", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, any> | undefined;
  const leaveyLibrary = "ChIJh3cCFYbHwoARzm861lI1Wro";
  const fishbowlChapel = "ChIJL9589eTHwoARermdS3ItWvE";
  try {
    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, any>;
      return new Response(JSON.stringify({ routes: [{ distanceMeters: 100, duration: "60s", description: "test" }] }), {
        status: 200,
      });
    };
    await new RoutesService("test-key").computeRoutes({
      origin: leaveyLibrary,
      destination: `places/${fishbowlChapel}`,
      mode: "walking",
      intermediates: [
        `place_id:places/${leaveyLibrary}`,
        "Leavey Library",
        "1,2",
        "GhIJtest",
        "Eictest",
        "Ihotest",
        "EpItest",
        "NotARecognizedPlaceIdToken",
      ],
    });

    assert.deepEqual(requestBody?.origin, { placeId: leaveyLibrary });
    assert.deepEqual(requestBody?.destination, { placeId: fishbowlChapel });
    assert.deepEqual(requestBody?.intermediates, [
      { placeId: leaveyLibrary },
      { address: "Leavey Library" },
      { location: { latLng: { latitude: 1, longitude: 2 } } },
      { placeId: "GhIJtest" },
      { placeId: "Eictest" },
      { placeId: "Ihotest" },
      { placeId: "EpItest" },
      { address: "NotARecognizedPlaceIdToken" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Route matrices serialize raw, resource, and prefixed Place IDs as placeId waypoints", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, any> | undefined;
  const leaveyLibrary = "ChIJh3cCFYbHwoARzm861lI1Wro";
  const fishbowlChapel = "ChIJL9589eTHwoARermdS3ItWvE";
  try {
    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, any>;
      return new Response("[]", { status: 200 });
    };
    await new RoutesService("test-key").computeRouteMatrix({
      origins: [leaveyLibrary, `places/${fishbowlChapel}`, "Leavey Library", "1,2"],
      destinations: [`place_id:places/${leaveyLibrary}`, "GhIJtest", "3,4"],
      mode: "walking",
    });

    assert.deepEqual(requestBody?.origins, [
      { waypoint: { placeId: leaveyLibrary } },
      { waypoint: { placeId: fishbowlChapel } },
      { waypoint: { address: "Leavey Library" } },
      { waypoint: { location: { latLng: { latitude: 1, longitude: 2 } } } },
    ]);
    assert.deepEqual(requestBody?.destinations, [
      { waypoint: { placeId: leaveyLibrary } },
      { waypoint: { placeId: "GhIJtest" } },
      { waypoint: { location: { latLng: { latitude: 3, longitude: 4 } } } },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("multi-stop planning serializes Place ID stops through Routes", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, any> | undefined;
  const leaveyLibrary = "ChIJh3cCFYbHwoARzm861lI1Wro";
  const fishbowlChapel = "ChIJL9589eTHwoARermdS3ItWvE";
  try {
    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, any>;
      return new Response(
        JSON.stringify({
          routes: [
            {
              legs: [
                { distanceMeters: 100, duration: "60s" },
                { distanceMeters: 200, duration: "120s" },
              ],
            },
          ],
        }),
        { status: 200 }
      );
    };
    await new PlacesSearcher("test-key").planRoute({
      stops: [leaveyLibrary, `places/${fishbowlChapel}`, "1,2"],
      mode: "walking",
    });

    assert.deepEqual(requestBody?.origin, { placeId: leaveyLibrary });
    assert.deepEqual(requestBody?.destination, { location: { latLng: { latitude: 1, longitude: 2 } } });
    assert.deepEqual(requestBody?.intermediates, [{ placeId: fishbowlChapel }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("waypoint optimization is opt-in and accounted as Routes Pro", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  let requestBody: Record<string, unknown> | undefined;
  const logs: string[] = [];
  try {
    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          routes: [
            {
              distanceMeters: 100,
              duration: "60s",
              description: "test",
              optimizedIntermediateWaypointIndex: [0],
            },
          ],
        }),
        { status: 200 }
      );
    };
    console.error = (...args: unknown[]) => logs.push(args.join(" "));
    await new RoutesService("test-key").computeRoutes({
      origin: "A",
      destination: "B",
      mode: "driving",
      intermediates: ["C"],
      optimizeWaypointOrder: true,
    });
    assert.equal(requestBody?.optimizeWaypointOrder, true);
    assert.match(logs.join("\n"), /"tier":"T2"/);
    assert.match(logs.join("\n"), /Routes: Compute Routes Pro/);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test("more than 10 intermediate waypoints are accounted as Routes Pro", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const logs: string[] = [];
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ routes: [{ distanceMeters: 100, duration: "60s", description: "test" }] }), {
        status: 200,
      });
    console.error = (...args: unknown[]) => logs.push(args.join(" "));
    await new RoutesService("test-key").computeRoutes({
      origin: "A",
      destination: "B",
      mode: "driving",
      intermediates: Array.from({ length: 10 }, (_, index) => `I${index}`),
    });
    await new RoutesService("test-key").computeRoutes({
      origin: "A",
      destination: "B",
      mode: "driving",
      intermediates: Array.from({ length: 11 }, (_, index) => `I${index}`),
    });
    const entries = logs
      .filter((entry) => entry.startsWith("[COST] "))
      .map((entry) => JSON.parse(entry.slice("[COST] ".length)));
    assert.deepEqual(
      entries.map((entry) => entry.tier),
      ["T1", "T2"]
    );
    assert.equal(entries[1].sku, "Routes: Compute Routes Pro");
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test("direct matrices stop at the local 100-element guard", async () => {
  let outboundCalls = 0;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      outboundCalls++;
      return new Response("[]", { status: 200 });
    };
    await assert.rejects(
      () =>
        new RoutesService("test-key").computeRouteMatrix({
          origins: ["A", "B"],
          destinations: Array.from({ length: 51 }, (_, index) => `D${index}`),
          mode: "driving",
        }),
      /102 elements.*100/
    );
    assert.equal(outboundCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("multi-stop planning passes addresses directly and preserves order by default", async () => {
  const searcher = new PlacesSearcher("test-key") as any;
  searcher.routesService = {
    computeRoutes: async (params: Record<string, unknown>) => {
      assert.equal(params.optimizeWaypointOrder, false);
      return {
        routes: [
          {
            legs: [
              { distanceMeters: 100, duration: "60s" },
              { distanceMeters: 200, duration: "120s" },
            ],
          },
        ],
      };
    },
  };
  searcher.geocode = async () => {
    throw new Error("maps_plan_route must not geocode stops");
  };
  const result = await searcher.planRoute({ stops: ["A", "B", "C"] });
  assert.deepEqual(result.data.stops, ["A (A)", "B (B)", "C (C)"]);
});

test("transit intermediates are rejected before an outbound request", async () => {
  await assert.rejects(
    () =>
      new RoutesService("test-key").computeRoutes({
        origin: "A",
        destination: "B",
        mode: "transit",
        intermediates: ["C"],
      }),
    /do not support intermediate waypoints/
  );
});

test("batched Elevation accounting records one request unit", async () => {
  const originalError = console.error;
  const logs: string[] = [];
  const tools = new GoogleMapsTools("test-key") as unknown as {
    client: { elevation: () => Promise<{ data: { status: string; results: Array<{ elevation: number }> } }> };
    getElevation: (locations: Array<{ latitude: number; longitude: number }>) => Promise<unknown>;
  };
  tools.client = {
    elevation: async () => ({
      data: {
        status: "OK",
        results: [{ elevation: 10 }, { elevation: 20 }],
      },
    }),
  };
  try {
    console.error = (...args: unknown[]) => logs.push(args.join(" "));
    await tools.getElevation([
      { latitude: 1, longitude: 2 },
      { latitude: 3, longitude: 4 },
    ]);
    const entry = JSON.parse(logs.find((log) => log.startsWith("[COST] "))!.slice("[COST] ".length));
    assert.equal(entry.units, 1);
    assert.equal(entry.projectedUnits, 1);
  } finally {
    console.error = originalError;
  }
});
