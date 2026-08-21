import assert from "node:assert/strict";
import test from "node:test";
import { RoutesService } from "../src/services/RoutesService.js";
import { GroundingLiteService } from "../src/services/GroundingLiteService.js";
import { GoogleMapsTools } from "../src/services/toolclass.js";
import { NewPlacesService } from "../src/services/NewPlacesService.js";
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
      const transitArrival = new Date(departure.getTime() + 8 * 60 * 1000).toISOString();
      return {
        routes: [
          {
            duration: "600s",
            legs: [
              {
                duration: "600s",
                steps: [
                  {
                    travelMode: "TRANSIT",
                    staticDuration: "600s",
                    transitDetails: {
                      stopDetails: { departureTime: departure.toISOString(), arrivalTime: transitArrival },
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
    detailLevel: "steps",
  });

  assert.equal(departures.length, 2);
  assert.equal(departures[0].toISOString(), initial.toISOString());
  assert.equal(departures[1].toISOString(), "2030-01-01T10:15:00.000Z");
  assert.equal(itinerary.totalElapsedSeconds, 1500);
  assert.equal(itinerary.travelSeconds, 1200);
  assert.equal(itinerary.dwellSeconds, 300);
  assert.equal(itinerary.totalElapsedSeconds, itinerary.travelSeconds + itinerary.dwellSeconds);
  assert.equal(itinerary.legs[0].departureTime, "2030-01-01T10:00:00.000Z");
  assert.equal(itinerary.legs[0].arrivalTime, "2030-01-01T10:10:00.000Z");
  assert.equal(itinerary.legs[0].lastTransitArrivalTime, "2030-01-01T10:08:00.000Z");
  assert.equal(itinerary.detailLevel, "steps");
  assert.deepEqual(detailLevels, ["steps", "steps"]);
  assert.equal(itinerary.legs.length, 2);
  assert.equal(itinerary.legs[0].lines[0], "M1");
  assert.match(itinerary.legs[0].googleMapsNavigationUrl, /api=1/);
});

test("fixed-stop optimization carries dwell with reordered stops", async () => {
  const initial = new Date("2030-01-01T10:00:00.000Z");
  const routeCalls: Array<{ origin: string; destination: string; departureTime?: Date }> = [];
  const fakeRoutes = {
    computeRouteMatrix: async (params: { origins: string[]; destinations: string[] }) => {
      const duration = (origin: string, destination: string) =>
        (origin === "Home" && destination === "B") ||
        (origin === "B" && destination === "A") ||
        (origin === "A" && destination === "End")
          ? 100
          : 500;
      return {
        distances: params.origins.map(() => params.destinations.map(() => ({ value: 100, text: "100 m" }))),
        durations: params.origins.map((origin) =>
          params.destinations.map((destination) => ({ value: duration(origin, destination), text: "10 mins" }))
        ),
        origin_addresses: params.origins,
        destination_addresses: params.destinations,
      };
    },
    computeRoutes: async (params: { origin: string; destination: string; departureTime?: Date }) => {
      routeCalls.push(params);
      return {
        routes: [{ duration: "600s", legs: [{ duration: "600s", steps: [] }] }],
        total_duration: { value: 600, text: "10 mins" },
      };
    },
  } as unknown as RoutesService;

  await new TransitItineraryService(fakeRoutes).optimizeFixedStops({
    origin: "Home",
    stops: ["A", "B"],
    finalDestination: "End",
    departureTime: initial,
    dwellMinutes: [60, 10],
    plannerMode: "conservative",
  });

  const bToA = routeCalls.find((call) => call.origin === "B" && call.destination === "A");
  const aToB = routeCalls.find((call) => call.origin === "A" && call.destination === "B");
  const aToEnd = routeCalls.find((call) => call.origin === "A" && call.destination === "End");
  assert.equal(bToA?.departureTime?.toISOString(), "2030-01-01T10:20:00.000Z");
  assert.equal(aToB?.departureTime?.toISOString(), "2030-01-01T11:10:00.000Z");
  assert.equal(aToEnd?.departureTime?.toISOString(), "2030-01-01T11:30:00.000Z");
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
      return {
        routes: [{ duration: "600s", legs: [{ duration: "600s", steps: [] }] }],
        total_duration: { value: 600, text: "10 mins" },
      };
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
    return {
      routes: [{ duration: "600s", legs: [{ duration: "600s", steps: [] }] }],
      total_duration: { value: 600, text: "10 mins" },
    };
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

test("transit place discovery combines origin-biased sources for the USC Village Walmart case", async () => {
  const originalAck = process.env.GOOGLE_MAPS_GROUNDING_TERMS_ACK;
  const originalGeocode = GoogleMapsTools.prototype.geocode;
  const originalGroundingSearch = GroundingLiteService.prototype.searchPlaces;
  const originalPlacesSearch = NewPlacesService.prototype.searchText;
  const originalMatrix = RoutesService.prototype.computeRouteMatrix;
  const originalRoutes = RoutesService.prototype.computeRoutes;
  const groundingBiases: unknown[] = [];
  const placesBiases: unknown[] = [];
  const matrixCalls: Array<{ origins: string[]; destinations: string[] }> = [];
  const exactCalls: Array<{ destination: string }> = [];
  process.env.GOOGLE_MAPS_GROUNDING_TERMS_ACK = "true";
  GoogleMapsTools.prototype.geocode = async function () {
    return { location: { lat: 34.023, lng: -118.286 }, formatted_address: "USC Village", place_id: "origin" };
  };
  GroundingLiteService.prototype.searchPlaces = async function (_query, _parentTool, locationBias) {
    groundingBiases.push(locationBias);
    return {
      structuredContent: {
        places: [
          {
            place: "places/far-san-gabriel",
            location: { latitude: 34.13, longitude: -117.92 },
            googleMapsLinks: { placeUri: "https://maps.google.com/?cid=far" },
          },
        ],
      },
    };
  };
  NewPlacesService.prototype.searchText = async function (params) {
    placesBiases.push(params.locationBias);
    return [
      {
        name: "Walmart Supercenter",
        place_id: "south-gate",
        formatted_address: "4651 Firestone Blvd, South Gate, CA 90280",
        geometry: { location: { lat: 33.96, lng: -118.15 } },
      },
      {
        name: "Walmart Supercenter",
        place_id: "compton",
        formatted_address: "2100 N Long Beach Blvd, Compton, CA 90221",
        geometry: { location: { lat: 33.89, lng: -118.22 } },
      },
      {
        name: "Walmart",
        place_id: "torrance",
        formatted_address: "19503 Normandie Ave, Torrance, CA 90501",
        geometry: { location: { lat: 33.83, lng: -118.29 } },
      },
    ];
  };
  RoutesService.prototype.computeRouteMatrix = async function (params) {
    matrixCalls.push(params);
    return {
      distances: params.origins.map(() => params.destinations.map(() => ({ value: 1, text: "1 m" }))),
      durations: params.origins.map(() =>
        params.destinations.map((destination) => ({
          value: destination.includes("south-gate")
            ? 3180
            : destination.includes("compton")
              ? 3400
              : destination.includes("torrance")
                ? 3500
                : 6000,
          text: "",
        }))
      ),
      origin_addresses: params.origins,
      destination_addresses: params.destinations,
    };
  };
  RoutesService.prototype.computeRoutes = async function (params) {
    exactCalls.push({ destination: params.destination });
    const seconds = params.destination.includes("south-gate")
      ? 3000
      : params.destination.includes("compton")
        ? 3300
        : 3901;
    return {
      routes: [{ duration: `${seconds}s`, legs: [{ duration: `${seconds}s`, steps: [] }] }],
      total_duration: { value: seconds, text: "" },
    };
  };
  try {
    const result = await new TransitDiscoveryService("test-key").findPlacesByTransit({
      origin: "USC Village, Los Angeles, CA",
      query: "Walmart stores near Los Angeles",
      departureTime: new Date("2026-08-21T03:30:00.000Z"),
      maxMinutes: 60,
      objective: "fastest",
      plannerMode: "thorough",
    });

    assert.deepEqual(placesBiases[0], { lat: 34.023, lng: -118.286, radius: 25_000 });
    assert.deepEqual(groundingBiases[0], {
      circle: { center: { latitude: 34.023, longitude: -118.286 }, radius: 25_000 },
    });
    assert.equal(matrixCalls.length, 1);
    assert.equal(matrixCalls[0].destinations.length, 4);
    assert.deepEqual(
      result.candidates.map((candidate: any) => candidate.placeId),
      ["south-gate", "compton"]
    );
    assert.ok(result.candidates.every((candidate: any) => candidate.name && candidate.name !== candidate.placeId));
    assert.ok(result.candidates.every((candidate: any) => candidate.googleMapsUrl.includes("api=1")));
    assert.equal(exactCalls.length, 3);
    assert.match(result.warnings.join(" "), /exact transit time exceeded 60 minutes/);
  } finally {
    if (originalAck === undefined) delete process.env.GOOGLE_MAPS_GROUNDING_TERMS_ACK;
    else process.env.GOOGLE_MAPS_GROUNDING_TERMS_ACK = originalAck;
    GoogleMapsTools.prototype.geocode = originalGeocode;
    GroundingLiteService.prototype.searchPlaces = originalGroundingSearch;
    NewPlacesService.prototype.searchText = originalPlacesSearch;
    RoutesService.prototype.computeRouteMatrix = originalMatrix;
    RoutesService.prototype.computeRoutes = originalRoutes;
  }
});

test("Grounding-only transit finalists are hydrated without enriching rejected candidates", async () => {
  const originalAck = process.env.GOOGLE_MAPS_GROUNDING_TERMS_ACK;
  const originalGeocode = GoogleMapsTools.prototype.geocode;
  const originalGroundingSearch = GroundingLiteService.prototype.searchPlaces;
  const originalPlacesSearch = NewPlacesService.prototype.searchText;
  const originalPlaceDetails = NewPlacesService.prototype.getPlaceDetails;
  const originalMatrix = RoutesService.prototype.computeRouteMatrix;
  const originalRoutes = RoutesService.prototype.computeRoutes;
  const detailCalls: string[] = [];
  process.env.GOOGLE_MAPS_GROUNDING_TERMS_ACK = "true";
  GoogleMapsTools.prototype.geocode = async function () {
    return { location: { lat: 34.023, lng: -118.286 }, formatted_address: "USC Village", place_id: "origin" };
  };
  GroundingLiteService.prototype.searchPlaces = async function () {
    return {
      structuredContent: {
        places: [
          { place: "places/near", location: { latitude: 34.0, longitude: -118.2 } },
          { place: "places/far", location: { latitude: 35.0, longitude: -117.0 } },
        ],
      },
    };
  };
  NewPlacesService.prototype.searchText = async function () {
    return [];
  };
  NewPlacesService.prototype.getPlaceDetails = async function (placeId) {
    detailCalls.push(placeId);
    return {
      name: "Near Place",
      place_id: "near",
      formatted_address: "Near Place, Los Angeles, CA",
      geometry: { location: { lat: 34.0, lng: -118.2 } },
    };
  };
  RoutesService.prototype.computeRouteMatrix = async function (params) {
    return {
      distances: params.origins.map(() => params.destinations.map(() => ({ value: 1, text: "1 m" }))),
      durations: params.origins.map(() =>
        params.destinations.map((destination) => ({
          value: destination.includes("far") ? 7000 : 1800,
          text: "30 mins",
        }))
      ),
      origin_addresses: params.origins,
      destination_addresses: params.destinations,
    };
  };
  RoutesService.prototype.computeRoutes = async function () {
    return {
      routes: [{ duration: "1800s", legs: [{ duration: "1800s", steps: [] }] }],
      total_duration: { value: 1800, text: "30 mins" },
    };
  };
  try {
    const result = await new TransitDiscoveryService("test-key").findPlacesByTransit({
      origin: "USC Village, Los Angeles, CA",
      query: "a nearby place",
      maxMinutes: 60,
      plannerMode: "conservative",
    });
    assert.deepEqual(detailCalls, ["near"]);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].name, "Near Place");
    assert.equal(result.candidates[0].placeId, "near");
  } finally {
    if (originalAck === undefined) delete process.env.GOOGLE_MAPS_GROUNDING_TERMS_ACK;
    else process.env.GOOGLE_MAPS_GROUNDING_TERMS_ACK = originalAck;
    GoogleMapsTools.prototype.geocode = originalGeocode;
    GroundingLiteService.prototype.searchPlaces = originalGroundingSearch;
    NewPlacesService.prototype.searchText = originalPlacesSearch;
    NewPlacesService.prototype.getPlaceDetails = originalPlaceDetails;
    RoutesService.prototype.computeRouteMatrix = originalMatrix;
    RoutesService.prototype.computeRoutes = originalRoutes;
  }
});

test("place discovery reports invalid exact finalists without ranking them", async () => {
  const originalGeocode = GoogleMapsTools.prototype.geocode;
  const originalGroundingSearch = GroundingLiteService.prototype.searchPlaces;
  const originalPlacesSearch = NewPlacesService.prototype.searchText;
  const originalMatrix = RoutesService.prototype.computeRouteMatrix;
  const originalRoutes = RoutesService.prototype.computeRoutes;
  GoogleMapsTools.prototype.geocode = async function () {
    return { location: { lat: 34.023, lng: -118.286 }, formatted_address: "USC Village", place_id: "origin" };
  };
  GroundingLiteService.prototype.searchPlaces = async function () {
    return {};
  };
  NewPlacesService.prototype.searchText = async function () {
    return [
      {
        name: "Walmart Supercenter",
        place_id: "walmart-torrance",
        formatted_address: "19503 Normandie Ave, Torrance, CA 90501",
        geometry: { location: { lat: 33.83, lng: -118.29 } },
      },
    ];
  };
  RoutesService.prototype.computeRouteMatrix = async function (params) {
    return {
      distances: params.origins.map(() => params.destinations.map(() => ({ value: 1, text: "1 m" }))),
      durations: params.origins.map(() => params.destinations.map(() => ({ value: 3000, text: "50 mins" }))),
      origin_addresses: params.origins,
      destination_addresses: params.destinations,
    };
  };
  RoutesService.prototype.computeRoutes = async function () {
    return {
      routes: [
        {
          duration: "600s",
          legs: [
            {
              duration: "600s",
              steps: [
                {
                  travelMode: "TRANSIT",
                  transitDetails: {
                    stopDetails: {
                      departureTime: "2030-01-01T10:05:00.000Z",
                      arrivalTime: "2030-01-01T10:11:00.000Z",
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
      total_duration: { value: 600, text: "10 mins" },
    };
  };
  try {
    const result = await new TransitDiscoveryService("test-key").findPlacesByTransit({
      origin: "USC Village, Los Angeles, CA",
      query: "Walmart stores near Los Angeles",
      departureTime: new Date("2030-01-01T10:00:00.000Z"),
      maxMinutes: 60,
      plannerMode: "conservative",
    });
    assert.deepEqual(result.candidates, []);
    assert.equal(result.invalidFinalists.length, 1);
    assert.equal(result.invalidFinalists[0].name, "Walmart Supercenter");
    assert.equal(result.invalidFinalists[0].placeId, "walmart-torrance");
    assert.equal(result.invalidFinalists[0].coarseDurationSeconds, 3000);
    assert.equal(result.invalidFinalists[0].timingError.code, "TRANSIT_CHRONOLOGY_INVALID");
    assert.match(result.warnings.join(" "), /not verified against max_minutes/);
  } finally {
    GoogleMapsTools.prototype.geocode = originalGeocode;
    GroundingLiteService.prototype.searchPlaces = originalGroundingSearch;
    NewPlacesService.prototype.searchText = originalPlacesSearch;
    RoutesService.prototype.computeRouteMatrix = originalMatrix;
    RoutesService.prototype.computeRoutes = originalRoutes;
  }
});

test("fixed-stop and errand optimizers exclude invalid exact finalists", async () => {
  const initial = new Date("2030-01-01T10:00:00.000Z");
  const invalidRoute = {
    routes: [
      {
        duration: "600s",
        legs: [
          {
            duration: "600s",
            steps: [
              {
                travelMode: "TRANSIT",
                transitDetails: {
                  stopDetails: {
                    departureTime: "2030-01-01T10:05:00.000Z",
                    arrivalTime: "2030-01-01T10:11:00.000Z",
                  },
                },
              },
            ],
          },
        ],
      },
    ],
    total_duration: { value: 600, text: "10 mins" },
  };
  const fakeRoutes = {
    computeRouteMatrix: async (params: { origins: string[]; destinations: string[] }) => ({
      distances: params.origins.map(() => params.destinations.map(() => ({ value: 1, text: "1 m" }))),
      durations: params.origins.map(() => params.destinations.map(() => ({ value: 600, text: "10 mins" }))),
      origin_addresses: params.origins,
      destination_addresses: params.destinations,
    }),
    computeRoutes: async () => invalidRoute,
  } as unknown as RoutesService;

  const fixedStopResult = await new TransitItineraryService(fakeRoutes).optimizeFixedStops({
    origin: "Home",
    stops: ["A"],
    departureTime: initial,
    plannerMode: "conservative",
  });
  assert.equal(fixedStopResult.best, null);
  assert.equal(fixedStopResult.alternatives.length, 0);
  assert.equal(fixedStopResult.invalidFinalists.length, 1);
  assert.match(fixedStopResult.warnings.join(" "), /ranked safely/);

  const originalMatrix = RoutesService.prototype.computeRouteMatrix;
  const originalRoutes = RoutesService.prototype.computeRoutes;
  RoutesService.prototype.computeRouteMatrix = async function (params) {
    return {
      distances: params.origins.map(() => params.destinations.map(() => ({ value: 1, text: "1 m" }))),
      durations: params.origins.map(() => params.destinations.map(() => ({ value: 600, text: "10 mins" }))),
      origin_addresses: params.origins,
      destination_addresses: params.destinations,
    };
  };
  RoutesService.prototype.computeRoutes = async function () {
    return invalidRoute;
  };
  try {
    const service = new TransitDiscoveryService("test-key");
    (service as unknown as { discover: () => Promise<Array<{ name: string; address: string }>> }).discover =
      async () => [{ name: "IKEA Burbank", address: "IKEA Burbank" }];
    const errandResult = await service.optimizeErrands({
      origin: "Home",
      errands: [{ query: "IKEA" }],
      departureTime: initial,
      plannerMode: "conservative",
    });
    assert.equal(errandResult.selected, null);
    assert.equal(errandResult.alternatives.length, 0);
    assert.equal(errandResult.invalidFinalists.length, 1);
    assert.equal(errandResult.invalidFinalists[0].timingError.code, "TRANSIT_CHRONOLOGY_INVALID");
    assert.match(errandResult.warnings.join(" "), /ranked safely/);
  } finally {
    RoutesService.prototype.computeRouteMatrix = originalMatrix;
    RoutesService.prototype.computeRoutes = originalRoutes;
  }
});

test("raw route chronology includes initial waiting and final walking", async () => {
  const initial = new Date("2030-01-01T10:00:00.000Z");
  const fakeRoutes = {
    computeRoutes: async () => ({
      routes: [
        {
          duration: "3846s",
          legs: [
            {
              duration: "3846s",
              steps: [
                { travelMode: "WALK", staticDuration: "600s" },
                {
                  travelMode: "TRANSIT",
                  staticDuration: "1200s",
                  transitDetails: {
                    stopDetails: {
                      departureTime: "2030-01-01T10:20:00.000Z",
                      arrivalTime: "2030-01-01T10:40:00.000Z",
                    },
                    transitLine: { shortName: "M1" },
                  },
                },
                { travelMode: "WALK", staticDuration: "300s" },
                {
                  travelMode: "TRANSIT",
                  staticDuration: "600s",
                  transitDetails: {
                    stopDetails: {
                      departureTime: "2030-01-01T10:50:00.000Z",
                      arrivalTime: "2030-01-01T11:00:00.000Z",
                    },
                    transitLine: { shortName: "M2" },
                  },
                },
                { travelMode: "WALK", staticDuration: "100s" },
              ],
            },
          ],
        },
      ],
      total_duration: { value: 2973, text: "49 mins" },
    }),
  } as unknown as RoutesService;

  const itinerary = await new TransitItineraryService(fakeRoutes).routeFixedPath({
    locations: ["USC Village, Los Angeles, CA", "19503 Normandie Ave, Torrance, CA 90501"],
    departureTime: initial,
  });
  const leg = itinerary.legs[0];
  assert.equal(leg.departureTime, "2030-01-01T10:00:00.000Z");
  assert.equal(leg.arrivalTime, "2030-01-01T11:04:06.000Z");
  assert.equal(leg.firstTransitDepartureTime, "2030-01-01T10:20:00.000Z");
  assert.equal(leg.lastTransitArrivalTime, "2030-01-01T11:00:00.000Z");
  assert.equal(leg.walkingSeconds, 1000);
  assert.equal(leg.transitSeconds, 1800);
  assert.equal(leg.waitingSeconds, 1046);
  assert.equal(itinerary.totalElapsedSeconds, 3846);
  assert.equal(itinerary.travelSeconds, 3846);
  assert.equal(itinerary.travelSeconds, itinerary.totalElapsedSeconds);
  assert.equal(itinerary.dwellSeconds, 0);
  assert.equal(leg.durationSeconds, (Date.parse(leg.arrivalTime) - Date.parse(leg.departureTime)) / 1000);
  assert.ok(Date.parse(leg.departureTime) <= Date.parse(leg.firstTransitDepartureTime!));
  assert.ok(Date.parse(leg.firstTransitDepartureTime!) <= Date.parse(leg.lastTransitArrivalTime!));
  assert.ok(Date.parse(leg.lastTransitArrivalTime!) < Date.parse(leg.arrivalTime));
  assert.equal(leg.walkingSeconds! + leg.transitSeconds! + leg.waitingSeconds!, leg.durationSeconds);
  assert.match(itinerary.warnings.join(" "), /validated raw duration was used/);
});

test("invalid transit chronology never produces an itinerary", async () => {
  const initial = new Date("2030-01-01T10:00:00.000Z");
  const transitStep = (departureTime: string, arrivalTime: string) => ({
    travelMode: "TRANSIT",
    transitDetails: { stopDetails: { departureTime, arrivalTime } },
  });
  const cases = [
    {
      name: "route ends before a transit event",
      route: {
        duration: "600s",
        legs: [
          {
            duration: "600s",
            steps: [transitStep("2030-01-01T10:05:00.000Z", "2030-01-01T10:11:00.000Z")],
          },
        ],
      },
    },
    {
      name: "transit timestamps are reversed",
      route: {
        duration: "600s",
        legs: [
          {
            duration: "600s",
            steps: [transitStep("2030-01-01T10:05:00.000Z", "2030-01-01T10:04:00.000Z")],
          },
        ],
      },
    },
    {
      name: "route and leg durations disagree",
      route: { duration: "600s", legs: [{ duration: "602s", steps: [] }] },
    },
    {
      name: "transit timestamps are missing",
      route: { duration: "600s", legs: [{ duration: "600s", steps: [{ travelMode: "TRANSIT" }] }] },
    },
    {
      name: "walking steps overrun the route",
      route: {
        duration: "600s",
        legs: [{ duration: "600s", steps: [{ travelMode: "WALK", staticDuration: "601s" }] }],
      },
    },
  ];

  for (const testCase of cases) {
    const fakeRoutes = {
      computeRoutes: async () => ({ routes: [testCase.route], total_duration: { value: 600, text: "10 mins" } }),
    } as unknown as RoutesService;
    await assert.rejects(
      () =>
        new TransitItineraryService(fakeRoutes).routeFixedPath({
          locations: ["A", "B"],
          departureTime: initial,
          detailLevel: "steps",
        }),
      (error: unknown) => error instanceof Error && error.message.startsWith("TRANSIT_CHRONOLOGY_INVALID:"),
      testCase.name
    );
  }
});

test("summary transit detail preserves complete timing without unvalidated categories", async () => {
  const initial = new Date("2030-01-01T10:00:00.000Z");
  const fakeRoutes = {
    computeRoutes: async () => ({
      routes: [{ duration: "600s", legs: [{ duration: "600s" }] }],
      total_duration: { value: 600, text: "10 mins" },
    }),
  } as unknown as RoutesService;

  const itinerary = await new TransitItineraryService(fakeRoutes).routeFixedPath({
    locations: ["A", "B"],
    departureTime: initial,
    detailLevel: "summary",
  });
  const leg = itinerary.legs[0];
  assert.equal(leg.durationSeconds, 600);
  assert.equal(leg.arrivalTime, "2030-01-01T10:10:00.000Z");
  assert.equal(leg.walkingSeconds, undefined);
  assert.equal(leg.transitSeconds, undefined);
  assert.equal(leg.waitingSeconds, undefined);
  assert.equal(leg.firstTransitDepartureTime, undefined);
  assert.equal(leg.lastTransitArrivalTime, undefined);
  assert.equal(itinerary.totalElapsedSeconds, 600);
  assert.equal(itinerary.dwellSeconds, 0);
});
