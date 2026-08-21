import assert from "node:assert/strict";
import test from "node:test";
import { RoutesService } from "../src/services/RoutesService.js";
import {
  computeBoundedTransitMatrix,
  computeTargetedTransitMatrix,
  inferredTransitPreference,
  TransitItineraryService,
} from "../src/services/TransitItineraryService.js";
import { plannerLimits } from "../src/services/costPolicy.js";
import { TransitDiscoveryService } from "../src/services/TransitDiscoveryService.js";

test("ordered transit legs propagate arrival plus dwell into the next departure", async () => {
  const initial = new Date("2030-01-01T10:00:00.000Z");
  const departures: Date[] = [];
  const detailLevels: string[] = [];
  const fakeRoutes = {
    computeRoutes: async (params: { departureTime?: Date; detailLevel?: string }) => {
      const departure = params.departureTime || initial;
      departures.push(departure);
      detailLevels.push(params.detailLevel || "");
      const arrival = new Date(departure.getTime() + 10 * 60 * 1000).toISOString();
      return {
        routes: [
          {
            legs: [
              {
                steps: [
                  {
                    travelMode: "TRANSIT",
                    staticDuration: "600s",
                    transitDetails: {
                      stopDetails: { departureTime: departure.toISOString(), arrivalTime: arrival },
                      transitLine: { shortName: "M1" },
                    },
                  },
                ],
              },
            ],
          },
        ],
        total_duration: { value: 600, text: "10 mins" },
      };
    },
  } as unknown as RoutesService;

  const itinerary = await new TransitItineraryService(fakeRoutes).routeFixedPath({
    locations: ["A", "B", "C"],
    departureTime: initial,
    dwellMinutes: [5],
    detailLevel: "summary",
  });

  assert.equal(departures.length, 2);
  assert.equal(departures[0].toISOString(), initial.toISOString());
  assert.equal(departures[1].toISOString(), "2030-01-01T10:15:00.000Z");
  assert.equal(itinerary.totalElapsedSeconds, 1500);
  assert.equal(itinerary.detailLevel, "summary");
  assert.deepEqual(detailLevels, ["summary", "summary"]);
  assert.equal(itinerary.legs.length, 2);
  assert.equal(itinerary.legs[0].lines[0], "M1");
  assert.match(itinerary.legs[0].googleMapsNavigationUrl, /api=1/);
});

test("fixed-stop optimization carries dwell with reordered stops", async () => {
  const initial = new Date("2030-01-01T10:00:00.000Z");
  const routeCalls: Array<{ origin: string; destination: string; departureTime?: Date }> = [];
  const fakeRoutes = {
    computeRouteMatrix: async (params: { origins: string[]; destinations: string[] }) => ({
      distances: params.origins.map(() => params.destinations.map(() => ({ value: 100, text: "100 m" }))),
      durations: params.origins.map(() => params.destinations.map(() => ({ value: 600, text: "10 mins" }))),
      origin_addresses: params.origins,
      destination_addresses: params.destinations,
    }),
    computeRoutes: async (params: { origin: string; destination: string; departureTime?: Date }) => {
      routeCalls.push(params);
      return {
        routes: [{ legs: [] }],
        total_duration: { value: 600, text: "10 mins" },
      };
    },
  } as unknown as RoutesService;

  await new TransitItineraryService(fakeRoutes).optimizeFixedStops({
    origin: "Home",
    stops: ["A", "B"],
    departureTime: initial,
    dwellMinutes: [60, 10],
    plannerMode: "conservative",
  });

  const bToA = routeCalls.find((call) => call.origin === "B" && call.destination === "A");
  const aToB = routeCalls.find((call) => call.origin === "A" && call.destination === "B");
  assert.equal(bToA?.departureTime?.toISOString(), "2030-01-01T10:20:00.000Z");
  assert.equal(aToB?.departureTime?.toISOString(), "2030-01-01T11:10:00.000Z");
});

test("transit objectives infer provider preferences without overriding explicit choices", async () => {
  assert.equal(inferredTransitPreference("least_walking"), "LESS_WALKING");
  assert.equal(inferredTransitPreference("fewest_transfers"), "FEWER_TRANSFERS");
  assert.equal(inferredTransitPreference("fastest"), undefined);
  assert.equal(inferredTransitPreference("balanced"), undefined);
  assert.equal(inferredTransitPreference("least_walking", "fewer_transfers"), "fewer_transfers");

  const matrixPreferences: unknown[] = [];
  const routePreferences: unknown[] = [];
  const fakeRoutes = {
    computeRouteMatrix: async (params: { origins: string[]; destinations: string[]; transitPreference?: unknown }) => {
      matrixPreferences.push(params.transitPreference);
      return {
        distances: params.origins.map(() => params.destinations.map(() => ({ value: 100, text: "100 m" }))),
        durations: params.origins.map(() => params.destinations.map(() => ({ value: 600, text: "10 mins" }))),
        origin_addresses: params.origins,
        destination_addresses: params.destinations,
      };
    },
    computeRoutes: async (params: { transitPreference?: unknown }) => {
      routePreferences.push(params.transitPreference);
      return { routes: [{ legs: [] }], total_duration: { value: 600, text: "10 mins" } };
    },
  } as unknown as RoutesService;

  await new TransitItineraryService(fakeRoutes).optimizeFixedStops({
    origin: "Home",
    stops: ["A", "B"],
    objective: "least_walking",
    plannerMode: "conservative",
  });
  assert.ok(matrixPreferences.length > 0);
  assert.ok(routePreferences.length > 0);
  assert.ok(matrixPreferences.every((preference) => preference === "LESS_WALKING"));
  assert.ok(routePreferences.every((preference) => preference === "LESS_WALKING"));

  matrixPreferences.length = 0;
  routePreferences.length = 0;
  await new TransitItineraryService(fakeRoutes).optimizeFixedStops({
    origin: "Home",
    stops: ["A", "B"],
    objective: "least_walking",
    transitPreference: "fewer_transfers",
    plannerMode: "conservative",
  });
  assert.ok(matrixPreferences.every((preference) => preference === "fewer_transfers"));
  assert.ok(routePreferences.every((preference) => preference === "fewer_transfers"));

  assert.equal(plannerLimits("conservative").exactRoutes, 3);
  assert.equal(plannerLimits("thorough").exactRoutes, 10);
});

test("errand planning trims query candidates before matrix fan-out", async () => {
  const matrixCalls: Array<{ origins: string[]; destinations: string[] }> = [];
  const originalMatrix = RoutesService.prototype.computeRouteMatrix;
  const originalRoutes = RoutesService.prototype.computeRoutes;
  const service = new TransitDiscoveryService("test-key");
  (service as unknown as { discover: (query: string) => Promise<Array<{ name: string; address: string }>> }).discover =
    async (query: string) =>
      Array.from({ length: 4 }, (_, index) => ({ name: `${query}-${index}`, address: `${query}-${index}` }));
  RoutesService.prototype.computeRouteMatrix = async function (
    params: Parameters<RoutesService["computeRouteMatrix"]>[0]
  ) {
    matrixCalls.push(params);
    return {
      distances: params.origins.map(() => params.destinations.map(() => ({ value: 100, text: "100 m" }))),
      durations: params.origins.map(() => params.destinations.map(() => ({ value: 600, text: "10 mins" }))),
      origin_addresses: params.origins,
      destination_addresses: params.destinations,
    };
  };
  RoutesService.prototype.computeRoutes = async function (_params: Parameters<RoutesService["computeRoutes"]>[0]) {
    return { routes: [{ legs: [] }], total_duration: { value: 600, text: "10 mins" } };
  };
  try {
    const result = await service.optimizeErrands({
      origin: "Home",
      errands: [{ query: "IKEA" }, { query: "Walmart" }, { query: "Target" }],
      plannerMode: "conservative",
    });
    assert.deepEqual(result.guardReductions.initialCandidateCounts, [4, 4, 4]);
    assert.deepEqual(result.guardReductions.finalCandidateCounts, [3, 4, 4]);
    assert.deepEqual(result.guardReductions.removedCandidateCounts, [1, 0, 0]);
    assert.equal(result.guardReductions.initialMatrixElements, 108);
    assert.equal(result.guardReductions.finalMatrixElements, 91);
    assert.equal(result.matrixElements, 91);
    assert.equal(
      matrixCalls.reduce((sum, call) => sum + call.origins.length * call.destinations.length, 0),
      result.matrixElements
    );
  } finally {
    RoutesService.prototype.computeRouteMatrix = originalMatrix;
    RoutesService.prototype.computeRoutes = originalRoutes;
  }
});

test("errand planning fails before matrix calls when fixed locations cannot fit", async () => {
  const matrixCalls: unknown[] = [];
  const originalMatrix = RoutesService.prototype.computeRouteMatrix;
  RoutesService.prototype.computeRouteMatrix = async function (
    params: Parameters<RoutesService["computeRouteMatrix"]>[0]
  ) {
    matrixCalls.push(params);
    throw new Error("matrix should not be called");
  };
  try {
    const service = new TransitDiscoveryService("test-key");
    await assert.rejects(
      () =>
        service.optimizeErrands({
          origin: "Home",
          errands: Array.from({ length: 11 }, (_, index) => ({ location: `Fixed-${index}` })),
          plannerMode: "conservative",
        }),
      /projects 121 matrix elements/
    );
    assert.equal(matrixCalls.length, 0);
  } finally {
    RoutesService.prototype.computeRouteMatrix = originalMatrix;
  }
});

test("transit planner matrices split into valid requests while preserving element accounting", async () => {
  const calls: Array<{ origins: string[]; destinations: string[] }> = [];
  const fakeRoutes = {
    computeRouteMatrix: async (params: { origins: string[]; destinations: string[] }) => {
      calls.push(params);
      return {
        distances: params.origins.map(() => params.destinations.map(() => ({ value: 100, text: "100 m" }))),
        durations: params.origins.map(() => params.destinations.map(() => ({ value: 60, text: "1 min" }))),
        origin_addresses: params.origins,
        destination_addresses: params.destinations,
      };
    },
  } as unknown as RoutesService;

  const origins = ["A", "B", "C"];
  const destinations = Array.from({ length: 40 }, (_, index) => `D${index}`);
  const matrix = await computeBoundedTransitMatrix(fakeRoutes, { origins, destinations }, 300);

  assert.deepEqual(
    calls.map((call) => call.origins.length),
    [2, 1]
  );
  assert.equal(
    calls.reduce((sum, call) => sum + call.origins.length * call.destinations.length, 0),
    120
  );
  assert.equal(matrix.durations.length, origins.length);
  assert.equal(matrix.durations[2][39].value, 60);
});

test("thorough transit matrices split destination batches at the provider limit", async () => {
  const calls: Array<{ origins: string[]; destinations: string[] }> = [];
  const fakeRoutes = {
    computeRouteMatrix: async (params: { origins: string[]; destinations: string[] }) => {
      calls.push(params);
      return {
        distances: params.origins.map(() => params.destinations.map(() => ({ value: 100, text: "100 m" }))),
        durations: params.origins.map(() => params.destinations.map(() => ({ value: 60, text: "1 min" }))),
        origin_addresses: params.origins,
        destination_addresses: params.destinations,
      };
    },
  } as unknown as RoutesService;

  const destinations = Array.from({ length: 120 }, (_, index) => `D${index}`);
  const matrix = await computeBoundedTransitMatrix(fakeRoutes, { origins: ["A"], destinations }, 300);

  assert.deepEqual(
    calls.map((call) => call.destinations.length),
    [100, 20]
  );
  assert.equal(matrix.durations[0][119].value, 60);
});

test("fixed-stop matrix requests include only edges that can occur in an order", async () => {
  const calls: Array<{ origins: string[]; destinations: string[] }> = [];
  const fakeRoutes = {
    computeRouteMatrix: async (params: { origins: string[]; destinations: string[] }) => {
      calls.push(params);
      return {
        distances: params.origins.map(() => params.destinations.map(() => ({ value: 100, text: "100 m" }))),
        durations: params.origins.map(() => params.destinations.map(() => ({ value: 60, text: "1 min" }))),
        origin_addresses: params.origins,
        destination_addresses: params.destinations,
      };
    },
  } as unknown as RoutesService;

  const durations = await computeTargetedTransitMatrix(
    fakeRoutes,
    [
      { origin: "Home", destination: "A" },
      { origin: "Home", destination: "B" },
      { origin: "A", destination: "B" },
      { origin: "B", destination: "A" },
      { origin: "A", destination: "Home" },
      { origin: "B", destination: "Home" },
    ],
    { parentTool: "maps_plan_transit" },
    100
  );

  assert.equal(
    calls.reduce((sum, call) => sum + call.origins.length * call.destinations.length, 0),
    6
  );
  assert.equal(durations.get("Home\u0000A")?.value, 60);
});
