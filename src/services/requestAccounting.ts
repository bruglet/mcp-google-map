import { CostTier, expectedSku } from "./costPolicy.js";
import { usageLedger, UsageEvent } from "./usageLedger.js";

export interface RequestMetadata extends UsageEvent {
  fanout?: "S" | "M" | "L";
  endpoint?: string;
  sku?: string;
  projectedUnits?: number;
  actualResult?: "started" | "success" | "unavailable" | "error";
  durationMs?: number;
  retries?: number;
}

export async function recordRequest(metadata: RequestMetadata): Promise<void> {
  const event = {
    ...metadata,
    endpoint: metadata.endpoint ?? defaultEndpoint(metadata.api, metadata.operation),
    projectedUnits: metadata.projectedUnits ?? metadata.units,
    sku: metadata.sku ?? expectedSku(metadata.api, metadata.operation, metadata.tier),
    actualResult: metadata.actualResult ?? "started",
  };
  console.error(`[COST] ${JSON.stringify(event)}`);
  try {
    const warnings = await usageLedger.record(event);
    for (const warning of warnings) console.error("[COST WARNING]", warning);
  } catch (error) {
    console.error(
      "[COST WARNING] Unable to update usage ledger:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Record the completed outcome of one outbound operation without ever
 * persisting response content or credentials. The caller performs any
 * preflight guard before entering this wrapper.
 */
export async function withAccounting<T>(
  metadata: RequestMetadata,
  operation: () => Promise<T>,
  options: { retries?: number; unavailableOnError?: boolean } = {}
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await operation();
    await recordRequest({
      ...metadata,
      actualResult: "success",
      durationMs: Date.now() - startedAt,
      retries: options.retries || 0,
    });
    return result;
  } catch (error) {
    await recordRequest({
      ...metadata,
      actualResult: options.unavailableOnError ? "unavailable" : "error",
      durationMs: Date.now() - startedAt,
      retries: options.retries || 0,
    });
    throw error;
  }
}

function defaultEndpoint(api: string, operation: string): string {
  if (api === "places") return `https://places.googleapis.com/v1/places:${operation}`;
  if (api === "routes")
    return operation === "computeRouteMatrix"
      ? "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"
      : "https://routes.googleapis.com/directions/v2:computeRoutes";
  if (api === "grounding-lite") return "https://mapstools.googleapis.com/mcp";
  if (api === "geocoding") return "https://maps.googleapis.com/maps/api/geocode/json";
  if (api === "elevation") return "https://maps.googleapis.com/maps/api/elevation/json";
  return "local";
}

export function estimateMatrixUnits(origins: number, destinations: number): number {
  return origins * destinations;
}

export function assertMatrixLimit(origins: number, destinations: number, limit = 100): void {
  const units = estimateMatrixUnits(origins, destinations);
  if (units > limit)
    throw new Error(`Route Matrix request would use ${units} elements, exceeding the configured limit of ${limit}.`);
}

export type { CostTier };
