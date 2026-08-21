import { z } from "zod";
import { PlacesSearcher } from "../../services/PlacesSearcher.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";

const NAME = "maps_plan_route";
const DESCRIPTION =
  "Plan a bounded non-transit route through multiple supplied locations and return compact leg directions, preserving input order unless optimization is requested. Use for requests such as 'drive through A, B, and C'; use maps_directions for one A-to-B route and maps_transit_itinerary or maps_plan_transit for transit. Waypoint optimization and routes with 11 or more intermediate stops are higher-tier; traffic is never enabled implicitly. Cost: T1-T2 | Fan-out: S.";

const SCHEMA = {
  stops: z
    .array(z.string())
    .min(2)
    .max(18)
    .describe(
      "Ordered addresses, Place IDs, or coordinate strings to visit, including origin and final destination; minimum 2 and planner-capped."
    ),
  mode: z
    .enum(["driving", "walking", "bicycling", "transit"])
    .optional()
    .describe("Travel mode; defaults to driving. For transit, use maps_transit_itinerary instead."),
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
  planner_mode: z
    .enum(["conservative", "thorough"])
    .default("conservative")
    .describe(
      "Use conservative for up to 8 intermediate stops; choose thorough only when the request requires up to 16."
    ),
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
