import { z } from "zod";
import { TransitDiscoveryService } from "../../services/TransitDiscoveryService.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
import { locationInputSchema, locationInputsToStrings } from "../../services/location.js";
import { GroundingLiteService } from "../../services/GroundingLiteService.js";

const NAME = "maps_optimize_transit_errands";
const DESCRIPTION =
  "Choose both the branch and visit order for several transit errands, then return the best chronological itinerary and alternatives. Use when errands may be queries such as 'an IKEA' or fixed locations; use maps_plan_transit when every stop is already known and only order may change. Candidate discovery combines bounded semantic and literal search, and exact rankings use complete arrival times including dwell; non-time objectives still use a duration-based shortlist, so they are heuristics rather than guaranteed global optima. Cost: T1 | Fan-out: L.";
const SCHEMA = {
  origin: locationInputSchema.describe("Trip starting point as a query, Place ID, coordinates, or Maps URL."),
  errands: z
    .array(
      z.object({
        query: z
          .string()
          .optional()
          .describe(
            "Semantic branch-discovery request, such as 'an IKEA'; provide either query or location for each errand."
          ),
        location: locationInputSchema
          .optional()
          .describe(
            "Caller-supplied fixed place for this errand; provide instead of query when the branch is already known."
          ),
        dwell_minutes: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Minutes expected at this errand, carried with it when errands are reordered; defaults to 0."),
      })
    )
    .min(1)
    .describe("Errands to complete; each must specify exactly one discovery query or fixed location."),
  final_destination: locationInputSchema
    .optional()
    .describe("Optional fixed endpoint after all errands; omit for an open-ended trip."),
  return_to_origin: z
    .boolean()
    .default(false)
    .describe("Set true to return to origin after all errands; do not combine with a different final_destination."),
  departure_time: z
    .string()
    .optional()
    .describe(
      "ISO 8601 timestamp for the requested start of the first leg; defaults to now. Later legs use complete arrival plus each errand's dwell."
    ),
  objective: z
    .enum(["fastest", "fewest_transfers", "least_walking", "balanced"])
    .default("fastest")
    .describe("Ranking goal; least_walking and fewest_transfers also guide Google transit requests."),
  planner_mode: z
    .enum(["conservative", "thorough"])
    .default("conservative")
    .describe(
      "Use conservative by default; choose thorough only when broader branch discovery is clearly warranted. Thorough can exact-route up to 10 finalists instead of 3."
    ),
};
export type OptimizeTransitErrandsParams = z.infer<z.ZodObject<typeof SCHEMA>>;

async function ACTION(params: OptimizeTransitErrandsParams): Promise<{ content: any[]; isError?: boolean }> {
  try {
    const locationInputs = [
      params.origin,
      ...params.errands.flatMap((errand) => (errand.location ? [errand.location] : [])),
      ...(params.final_destination ? [params.final_destination] : []),
    ];
    const resolvedLocations = await locationInputsToStrings(
      locationInputs,
      locationInputs.some((location) => location.kind === "maps_url")
        ? (urls) =>
            new GroundingLiteService(getCurrentApiKey()).resolveMapsUrlsToPlaceIds(
              urls,
              "maps_optimize_transit_errands"
            )
        : undefined
    );
    let resolvedIndex = 0;
    const origin = resolvedLocations[resolvedIndex++];
    const errands = params.errands.map((errand) => ({
      ...errand,
      location: errand.location ? resolvedLocations[resolvedIndex++] : undefined,
    }));
    const finalDestination = params.final_destination ? resolvedLocations[resolvedIndex] : undefined;
    const result = await new TransitDiscoveryService(getCurrentApiKey()).optimizeErrands({
      ...params,
      origin,
      errands,
      departureTime: params.departure_time ? new Date(params.departure_time) : undefined,
      finalDestination,
      returnToOrigin: params.return_to_origin,
      plannerMode: params.planner_mode,
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error: any) {
    return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
  }
}

export const OptimizeTransitErrands = { NAME, DESCRIPTION, SCHEMA, ACTION };
