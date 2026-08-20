export type UrlLocation = {
  label?: string;
  placeId?: string;
  address?: string;
  coordinates?: { latitude: number; longitude: number };
};

export type MapsTravelMode = "driving" | "walking" | "bicycling" | "transit";

function locationValue(location: UrlLocation, field: "origin" | "destination" | "query"): string {
  const value =
    location.address ||
    location.label ||
    location.placeId ||
    (location.coordinates ? `${location.coordinates.latitude},${location.coordinates.longitude}` : "");
  if (!value) {
    throw new Error(`A ${field} label, address, or coordinates value is required to build a Google Maps URL.`);
  }
  return value;
}

function assertLength(url: URL): string {
  const value = url.toString();
  if (value.length > 2048) {
    throw new Error("The generated Google Maps URL exceeds Google's 2,048-character limit.");
  }
  return value;
}

export function createPlaceUrl(location: UrlLocation): string {
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", locationValue(location, "query"));
  if (location.placeId) url.searchParams.set("query_place_id", location.placeId);
  return assertLength(url);
}

export function createDirectionsUrl(params: {
  origin?: UrlLocation;
  destination: UrlLocation;
  mode?: MapsTravelMode;
  navigate?: boolean;
}): string {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  if (params.origin) {
    url.searchParams.set("origin", locationValue(params.origin, "origin"));
    if (params.origin.placeId) url.searchParams.set("origin_place_id", params.origin.placeId);
  }
  url.searchParams.set("destination", locationValue(params.destination, "destination"));
  if (params.destination.placeId) url.searchParams.set("destination_place_id", params.destination.placeId);
  if (params.mode) url.searchParams.set("travelmode", params.mode);
  if (params.navigate) url.searchParams.set("dir_action", "navigate");
  return assertLength(url);
}

export function createNavigationUrl(destination: UrlLocation, mode: MapsTravelMode = "driving"): string {
  return createDirectionsUrl({ destination, mode, navigate: true });
}
