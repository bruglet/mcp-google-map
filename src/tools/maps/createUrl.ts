import { z } from "zod";
import { createDirectionsUrl, createNavigationUrl, createPlaceUrl } from "../../services/mapsUrlService.js";
import { LocationInput, locationInputSchema } from "../../services/location.js";

const NAME = "maps_create_url";
const DESCRIPTION =
  "Create a Google Maps place, directions, or immediate-navigation URL without calling a Google API. Use when the user wants a shareable or handoff link; use routing tools first when route duration, steps, optimization, or transit planning is needed. Prefer a known Place ID, omit origin to use the device's current location, and create one URL per transit leg. Cost: T0 | Fan-out: S.";

const SCHEMA = {
  action: z
    .enum(["place", "directions", "navigate"])
    .describe(
      "Use place for a location link, directions for a route preview, or navigate to request immediate navigation."
    ),
  destination: locationInputSchema.describe(
    "Destination as a query, Place ID, coordinates, or Maps URL; prefer a Place ID returned by another tool."
  ),
  origin: locationInputSchema
    .optional()
    .describe("Known route origin; omit for current-device navigation or a place-only link."),
  mode: z
    .enum(["driving", "walking", "bicycling", "transit"])
    .default("driving")
    .describe("Travel mode for directions or navigation URLs; defaults to driving and is ignored for place links."),
};

export type CreateUrlParams = z.infer<z.ZodObject<typeof SCHEMA>>;

function convert(input: LocationInput) {
  if (input.kind === "query") return { label: input.value, address: input.value };
  if (input.kind === "place_id") return { label: input.label || input.value, placeId: input.value };
  if (input.kind === "coordinates")
    return { label: input.label, coordinates: { latitude: input.latitude, longitude: input.longitude } };
  return { label: input.value, address: input.value };
}

async function ACTION(params: CreateUrlParams): Promise<{ content: any[]; isError?: boolean }> {
  try {
    const destination = convert(params.destination);
    const origin = params.origin ? convert(params.origin) : undefined;
    const url =
      params.action === "place"
        ? createPlaceUrl(destination)
        : params.action === "navigate"
          ? createNavigationUrl(destination, params.mode)
          : createDirectionsUrl({ origin, destination, mode: params.mode });
    return { content: [{ type: "text", text: JSON.stringify({ url, cost: "T0", google_api_requests: 0 }) }] };
  } catch (error: any) {
    return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
  }
}

export const CreateUrl = { NAME, DESCRIPTION, SCHEMA, ACTION };
