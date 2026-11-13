import assert from "node:assert/strict";
import test from "node:test";
import { PlacesSearcher } from "../src/services/PlacesSearcher.js";

const FIXTURES: Record<
  string,
  {
    geocode?: { location: { lat: number; lng: number }; formatted_address: string; place_id: string };
    places?: { location: { lat: number; lng: number }; address: string; place_id: string; name: string };
  }
> = {
  "Tokyo Tower": {
    geocode: {
      location: { lat: 35.6585805, lng: 139.7454329 },
      formatted_address: "Tokyo Tower, Tokyo, Japan",
      place_id: "place-tokyo-tower",
    },
  },
  河口湖駅: {
    geocode: {
      location: { lat: 35.4985, lng: 138.769 },
      formatted_address: "Kawaguchiko Station, Yamanashi, Japan",
      place_id: "place-kawaguchiko",
    },
  },
  "35.6585805,139.7454329": {
    geocode: {
      location: { lat: 35.6586, lng: 139.7455 },
      formatted_address: "4-chome-2-8 Shibakoen, Minato City, Tokyo",
      place_id: "place-nearest-street-address",
    },
  },
  "Place Without Id": {
    places: {
      location: { lat: 1.23, lng: 4.56 },
      address: "Somewhere with no place ID",
      place_id: "",
      name: "Somewhere with no place ID",
    },
  },
  "精進湖 他根浜": {
    places: {
      location: { lat: 35.4906841, lng: 138.6046066 },
      address: "Tatego-Hama Beach, Fujikawaguchiko",
      place_id: "ChIJ13ziPsznG2ARIqd4uJcjN0s",
      name: "Tatego-Hama Beach",
    },
  },
};

function createSearcher(captured: { textQueries: string[]; routeParams: any; nearbyCenters: string[] }) {
  const searcher = new PlacesSearcher("test-api-key");

  searcher.geocode = async (address: string) => {
    const fixture = FIXTURES[address];
    if (fixture?.geocode) {
      return { success: true, data: fixture.geocode };
    }
    return { success: false, error: `No location found for: ${address}` };
  };

  searcher.searchText = async (params: { query: string }) => {
    captured.textQueries.push(params.query);
    const fixture = FIXTURES[params.query];
    if (fixture?.places) {
      return { success: true, data: [fixture.places] };
    }
    return { success: true, data: [] };
  };

  (searcher as unknown as { routesService: any }).routesService = {
    computeRoutes: async (params: any) => {
      captured.routeParams = params;
      return {
        routes: [
          {
            description: "Mock Route",
            distanceMeters: 1000,
            duration: "600s",
            legs: [
              { distanceMeters: 500, duration: "300s" },
              { distanceMeters: 500, duration: "300s" },
            ],
          },
        ],
      };
    },
  };

  searcher.searchNearby = async (params: any) => {
    if (params.center?.value) {
      captured.nearbyCenters.push(params.center.value);
    }
    return { success: true, data: [] };
  };

  return searcher;
}

test("planRoute passes caller stops directly without geocoding or text-search fan-out", async () => {
  const captured = { textQueries: [], routeParams: null as any, nearbyCenters: [] };
  const searcher = createSearcher(captured);
  searcher.geocode = async () => {
    throw new Error("unexpected geocode");
  };
  const stops = ["Tokyo Tower", "精進湖 他根浜", "35.6585805,139.7454329", "河口湖駅"];
  const result = await searcher.planRoute({ stops });
  assert.equal(captured.routeParams.origin, stops[0]);
  assert.equal(captured.routeParams.destination, stops[3]);
  assert.deepEqual(captured.routeParams.intermediates, stops.slice(1, -1));
  assert.equal(captured.routeParams.optimizeWaypointOrder, false);
  assert.deepEqual(captured.textQueries, []);
  assert.deepEqual(
    result.data.stops,
    stops.map((stop) => `${stop} (${stop})`)
  );
});

test("exploreArea falls back to Places Text Search when geocoding finds nothing", async () => {
  const captured = { textQueries: [], routeParams: null as any, nearbyCenters: [] };
  const searcher = createSearcher(captured);
  const result = await searcher.exploreArea({ location: "精進湖 他根浜" });
  assert.deepEqual(captured.textQueries, ["精進湖 他根浜"]);
  assert.equal(result.data.location.address, "Tatego-Hama Beach, Fujikawaguchiko");
  assert.equal(result.data.location.lat, 35.4906841);
});

test("exploreArea rejects unusable coordinates before any API call", async () => {
  const captured = { textQueries: [], routeParams: null as any, nearbyCenters: [] };
  const searcher = createSearcher(captured);
  searcher.geocode = async () => {
    throw new Error("unexpected geocode");
  };
  await assert.rejects(searcher.exploreArea({ location: "99.9,99.9" }), /not a valid/);
  assert.deepEqual(captured.textQueries, []);
});
