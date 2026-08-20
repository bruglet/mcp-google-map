import assert from "node:assert/strict";
import test from "node:test";
import type { PlacesClient } from "@googlemaps/places";
import { NewPlacesService } from "../src/services/NewPlacesService.js";
import { PlacesSearcher } from "../src/services/PlacesSearcher.js";
import { RoutesService, buildRoutesFieldMask } from "../src/services/RoutesService.js";

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
