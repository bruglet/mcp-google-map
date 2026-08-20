import assert from "node:assert/strict";
import test from "node:test";
import { RoutesService } from "../src/services/RoutesService.js";
import { computeBoundedTransitMatrix, TransitItineraryService } from "../src/services/TransitItineraryService.js";

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
