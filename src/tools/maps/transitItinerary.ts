import { z } from "zod";
import { TransitItineraryService } from "../../services/TransitItineraryService.js";
import { RoutesService } from "../../services/RoutesService.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
import { locationInputSchema, locationInputsToStrings } from "../../services/location.js";
import { GroundingLiteService } from "../../services/GroundingLiteService.js";

const NAME = "maps_transit_itinerary";
const DESCRIPTION =
  "Return a chronological transit itinerary for locations that must be visited in the supplied order, including per-leg timing, lines, stops, transfers, metrics, and a Maps URL for each leg. Use for an ordered A-to-B-to-C trip; use maps_plan_transit when stop order may change or maps_directions for one transit leg. Each leg departs after the prior arrival plus dwell time because Google transit does not support intermediate waypoints. Cost: T1 | Fan-out: M.";
const SCHEMA = {
  locations: z
    .array(locationInputSchema)
    .min(2)
    .max(18)
    .describe("Locations in required visit order, each as a query, Place ID, coordinates, or Maps URL; minimum 2."),
  departure_time: z.string().optional().describe("ISO 8601 departure time for the first leg; defaults to now."),
  dwell_minutes: z
    .array(z.number().int().min(0))
    .optional()
    .describe(
      "Minutes spent after each non-final location, aligned with locations except the final destination; omitted entries are zero."
    ),
  detail_level: z
    .enum(["summary", "steps", "geometry", "full"])
    .default("steps")
    .describe(
      "Use summary for timing only, steps for lines and transfers, geometry for polylines, or full when both are needed; defaults to steps."
    ),
  transit_modes: z
    .array(z.enum(["bus", "subway", "train", "light_rail", "rail"]))
    .optional()
    .describe("Transit modes to prefer; omit to allow all supported modes."),
  transit_preference: z
    .enum(["less_walking", "fewer_transfers"])
    .optional()
    .describe("Optional trip-wide preference; omit when fastest overall travel is more important."),
  planner_mode: z
    .enum(["conservative", "thorough"])
    .default("conservative")
    .describe(
      "Use conservative for up to 8 intermediate stops; choose thorough only when the request requires up to 16."
    ),
};
export type TransitItineraryParams = z.infer<z.ZodObject<typeof SCHEMA>>;

async function ACTION(params: TransitItineraryParams): Promise<{ content: any[]; isError?: boolean }> {
  try {
    const locations = await locationInputsToStrings(
      params.locations,
      params.locations.some((location) => location.kind === "maps_url")
        ? (urls) =>
            new GroundingLiteService(getCurrentApiKey()).resolveMapsUrlsToPlaceIds(urls, "maps_transit_itinerary")
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
      plannerMode: params.planner_mode,
      parentTool: "maps_transit_itinerary",
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error: any) {
    return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
  }
}

export const TransitItineraryTool = { NAME, DESCRIPTION, SCHEMA, ACTION };
