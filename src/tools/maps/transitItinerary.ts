import { z } from "zod";
import { TransitItineraryService } from "../../services/TransitItineraryService.js";
import { RoutesService } from "../../services/RoutesService.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
import { locationInputSchema, locationInputsToStrings } from "../../services/location.js";
import { GroundingLiteService } from "../../services/GroundingLiteService.js";

const NAME = "maps_transit_itinerary";
const DESCRIPTION =
  "Route an explicitly ordered transit path such as A → station B → destination C. Google transit does not support intermediate waypoints, so this chains time-aware legs and propagates each arrival time. Cost: T1 | Fan-out: M.";
const SCHEMA = {
  locations: z
    .array(locationInputSchema)
    .min(2)
    .describe("Ordered query, Place ID, coordinates, or Maps URL locations"),
  departure_time: z.string().optional().describe("ISO departure time; defaults to now"),
  dwell_minutes: z.array(z.number().int().min(0)).optional().describe("Dwell after each non-final location"),
  detail_level: z.enum(["summary", "steps", "geometry", "full"]).default("steps"),
  transit_modes: z.array(z.enum(["bus", "subway", "train", "light_rail", "rail"])).optional(),
  transit_preference: z.enum(["less_walking", "fewer_transfers"]).optional(),
};
export type TransitItineraryParams = z.infer<z.ZodObject<typeof SCHEMA>>;

async function ACTION(params: TransitItineraryParams): Promise<{ content: any[]; isError?: boolean }> {
  try {
    const locations = await locationInputsToStrings(
      params.locations,
      params.locations.some((location) => location.kind === "maps_url")
        ? (urls) => new GroundingLiteService(getCurrentApiKey()).resolveMapsUrlsToPlaceIds(urls)
        : undefined
    );
    const service = new TransitItineraryService(new RoutesService(getCurrentApiKey()));
    const result = await service.routeFixedPath({
      locations,
      departureTime: params.departure_time ? new Date(params.departure_time) : undefined,
      dwellMinutes: params.dwell_minutes,
      detailLevel: params.detail_level,
      transitModes: params.transit_modes,
      transitPreference: params.transit_preference,
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error: any) {
    return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
  }
}

export const TransitItineraryTool = { NAME, DESCRIPTION, SCHEMA, ACTION };
