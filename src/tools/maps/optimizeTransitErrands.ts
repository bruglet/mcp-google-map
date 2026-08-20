import { z } from "zod";
import { TransitDiscoveryService } from "../../services/TransitDiscoveryService.js";
import { getCurrentApiKey } from "../../utils/requestContext.js";
import { locationInputSchema, locationInputsToStrings } from "../../services/location.js";
import { GroundingLiteService } from "../../services/GroundingLiteService.js";

const NAME = "maps_optimize_transit_errands";
const DESCRIPTION =
  "Choose branches and order for several transit errands. Uses bounded candidate discovery, targeted matrix approximation, local branch/order search, and chronological exact reranking. Cost: T1 | Fan-out: L.";
const SCHEMA = {
  origin: locationInputSchema,
  errands: z
    .array(
      z.object({
        query: z.string().optional(),
        location: locationInputSchema.optional(),
        dwell_minutes: z.number().int().min(0).default(0),
      })
    )
    .min(1),
  final_destination: locationInputSchema.optional(),
  return_to_origin: z.boolean().default(false),
  departure_time: z.string().optional(),
  objective: z.enum(["fastest", "fewest_transfers", "least_walking", "balanced"]).default("fastest"),
  planner_mode: z.enum(["conservative", "thorough"]).default("conservative"),
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
        ? (urls) => new GroundingLiteService(getCurrentApiKey()).resolveMapsUrlsToPlaceIds(urls)
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
