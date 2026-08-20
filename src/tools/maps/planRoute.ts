import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";

const NAME = "maps_plan_route";
const DESCRIPTION =
  "Plan a bounded multi-stop route in one call using the caller's addresses, coordinates, or Place IDs directly. Waypoint reordering is opt-in because it promotes the Routes request; the default preserves the supplied order and returns compact leg directions. planner_mode=conservative allows up to 8 intermediate stops and thorough up to 16. Use when the user says 'visit these 5 places efficiently', 'plan a route through A, B, C', or needs a multi-stop itinerary. Departure time provides schedule context; traffic-aware routing is not enabled implicitly. Transit uses the time-propagating itinerary planner.";

const SCHEMA = {
  stops: z
    .array(z.string())
    .min(2)
    .max(18)
    .describe("List of addresses or landmarks to visit (minimum 2; planner-capped)"),
  mode: z.enum(["driving", "walking", "bicycling", "transit"]).optional().describe("Travel mode (default: driving)"),
  optimize: z
    .boolean()
    .default(false)
    .describe(
      "Auto-optimize visit order via Routes API waypoint optimization. This is a higher-tier option; default false keeps the supplied order. Not available for transit mode."
    ),
  departure_time: z
    .string()
    .optional()
    .describe(
      "Departure time in ISO 8601 format (e.g. 2026-03-21T09:00:00Z). Does not implicitly enable live traffic."
    ),
  avoid_tolls: z
    .boolean()
    .optional()
    .describe('Avoid toll roads where reasonable. Only supported with mode "driving".'),
  avoid_highways: z
    .boolean()
    .optional()
    .describe('Avoid highways where reasonable. Only supported with mode "driving".'),
  planner_mode: z.enum(["conservative", "thorough"]).default("conservative"),
};

export type PlanRouteParams = z.infer<z.ZodObject<typeof SCHEMA>>;

async function ACTION(params: any): Promise<{ content: any[]; isError?: boolean }> {
  try {
    const apiKey = getCurrentApiKey();
    const searcher = new PlacesSearcher(apiKey);
    const result = await searcher.planRoute(params);

    return {
      content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }],
      isError: false,
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error planning route: ${error.message}` }],
    };
  }
}

export const PlanRoute = { NAME, DESCRIPTION, SCHEMA, ACTION };
