import { z } from "zod";
import { createDirectionsUrl, createNavigationUrl, createPlaceUrl } from "../../services/mapsUrlService.js";
import { LocationInput, locationInputSchema } from "../../services/location.js";

const NAME = "maps_create_url";
const DESCRIPTION =
  "Create a Google Maps place, directions, or navigation URL locally. This is T0 and makes no Google API request. Use Place IDs when available; transit itineraries should return one link per leg.";

const SCHEMA = {
  action: z.enum(["place", "directions", "navigate"]).describe("URL operation"),
  destination: locationInputSchema.describe("Destination query, Place ID, coordinates, or Maps URL"),
  origin: locationInputSchema.optional().describe("Optional known origin; omit to use the device location"),
  mode: z.enum(["driving", "walking", "bicycling", "transit"]).default("driving").describe("Google Maps travel mode"),
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
