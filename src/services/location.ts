import { createPlaceUrl, UrlLocation } from "./mapsUrlService.js";
import { z } from "zod";

export const locationInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("query"), value: z.string().min(1) }),
  z.object({ kind: z.literal("place_id"), value: z.string().min(1), label: z.string().optional() }),
  z.object({
    kind: z.literal("coordinates"),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    label: z.string().optional(),
  }),
  z.object({ kind: z.literal("maps_url"), value: z.string().url() }),
]);

export type LocationInput = z.infer<typeof locationInputSchema>;

export interface NormalizedLocation {
  input: LocationInput;
  label: string;
  placeId?: string;
  coordinates?: { latitude: number; longitude: number };
  formattedAddress?: string;
  googleMapsUrl?: string;
  resolutionSource: "input";
}

/** Convert a structured location to the string accepted by Google route APIs. */
export function locationInputToString(input: LocationInput): string {
  switch (input.kind) {
    case "query":
      return input.value;
    case "place_id":
      return `place_id:${input.value}`;
    case "coordinates":
      return `${input.latitude},${input.longitude}`;
    case "maps_url":
      // Grounding URL resolution is deliberately a separate opt-in operation.
      // Keeping the URL intact lets callers choose that resolver when a
      // structured Place ID is required, without scraping or persisting it.
      return input.value;
  }
}

export async function locationInputsToStrings(
  inputs: LocationInput[],
  resolveMapsUrls?: (urls: string[]) => Promise<string[]>
): Promise<string[]> {
  const mapsUrls = inputs.filter(
    (input): input is Extract<LocationInput, { kind: "maps_url" }> => input.kind === "maps_url"
  );
  const uniqueMapsUrls = [...new Set(mapsUrls.map((input) => input.value))];
  const resolved = mapsUrls.length
    ? await (resolveMapsUrls
        ? resolveMapsUrls(uniqueMapsUrls)
        : Promise.reject(new Error("Maps URL inputs require Grounding Lite resolution for route planning.")))
    : [];
  const resolvedByUrl = new Map(uniqueMapsUrls.map((url, index) => [url, resolved[index]]));
  return inputs.map((input) => {
    if (input.kind !== "maps_url") return locationInputToString(input);
    const placeId = resolvedByUrl.get(input.value);
    if (!placeId) throw new Error("GROUNDING_UNAVAILABLE: Maps URL did not resolve to a Place ID");
    return `place_id:${placeId}`;
  });
}

export function parseLocationInput(input: string | LocationInput): LocationInput {
  if (typeof input !== "string") return input;
  const coordinateMatch = input.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (coordinateMatch) {
    return { kind: "coordinates", latitude: Number(coordinateMatch[1]), longitude: Number(coordinateMatch[2]) };
  }
  if (/^https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl|www\.google\.com\/maps)/i.test(input)) {
    return { kind: "maps_url", value: input };
  }
  if (/^places\/[A-Za-z0-9_-]+$/.test(input)) {
    return { kind: "place_id", value: input.slice("places/".length) };
  }
  return { kind: "query", value: input };
}

export function normalizeLocation(input: string | LocationInput): NormalizedLocation {
  const parsed = parseLocationInput(input);
  if (parsed.kind === "coordinates") {
    const label = parsed.label || `${parsed.latitude},${parsed.longitude}`;
    const urlLocation: UrlLocation = {
      label,
      coordinates: { latitude: parsed.latitude, longitude: parsed.longitude },
    };
    return {
      input: parsed,
      label,
      coordinates: urlLocation.coordinates,
      googleMapsUrl: createPlaceUrl(urlLocation),
      resolutionSource: "input",
    };
  }
  if (parsed.kind === "place_id") {
    const label = parsed.label || parsed.value;
    const urlLocation: UrlLocation = { label, placeId: parsed.value };
    return {
      input: parsed,
      label,
      placeId: parsed.value,
      googleMapsUrl: createPlaceUrl(urlLocation),
      resolutionSource: "input",
    };
  }
  const label = parsed.value;
  const urlLocation: UrlLocation = { label };
  return { input: parsed, label, googleMapsUrl: createPlaceUrl(urlLocation), resolutionSource: "input" };
}
