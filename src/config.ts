import { Logger } from "./index.js";
import { ToolConfig } from "./core/BaseMcpServer.js";

// Import tool definitions
import { SearchNearby, SearchNearbyParams } from "./tools/maps/searchNearby.js";
import { PlaceDetails, PlaceDetailsParams } from "./tools/maps/placeDetails.js";
import { Geocode, GeocodeParams } from "./tools/maps/geocode.js";
import { ReverseGeocode, ReverseGeocodeParams } from "./tools/maps/reverseGeocode.js";
import { DistanceMatrix, DistanceMatrixParams } from "./tools/maps/distanceMatrix.js";
import { Directions, DirectionsParams } from "./tools/maps/directions.js";
import { Elevation, ElevationParams } from "./tools/maps/elevation.js";
import { SearchPlaces, SearchPlacesParams } from "./tools/maps/searchPlaces.js";
import { ExploreArea, ExploreAreaParams } from "./tools/maps/exploreArea.js";
import { PlanRoute, PlanRouteParams } from "./tools/maps/planRoute.js";
import { ComparePlaces, ComparePlacesParams } from "./tools/maps/comparePlaces.js";
import { BatchGeocode, BatchGeocodeParams } from "./tools/maps/batchGeocode.js";
import { SearchAlongRoute, SearchAlongRouteParams } from "./tools/maps/searchAlongRoute.js";
import { CreateUrl, CreateUrlParams } from "./tools/maps/createUrl.js";
import { GroundedSearch, GroundedSearchParams } from "./tools/maps/groundedSearch.js";
import { ResolveNames, ResolveNamesParams } from "./tools/maps/resolveNames.js";
import { ResolveMapsUrls, ResolveMapsUrlsParams } from "./tools/maps/resolveMapsUrls.js";
import { TransitItineraryTool, TransitItineraryParams } from "./tools/maps/transitItinerary.js";
import { PlanTransit, PlanTransitParams } from "./tools/maps/planTransit.js";
import { FindPlacesByTransit, FindPlacesByTransitParams } from "./tools/maps/findPlacesByTransit.js";
import { OptimizeTransitErrands, OptimizeTransitErrandsParams } from "./tools/maps/optimizeTransitErrands.js";

// All Google Maps tools are read-only API queries
const MAPS_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

interface ServerInstanceConfig {
  name: string;
  portEnvVar: string;
  tools: ToolConfig[];
}

const serverConfigs: ServerInstanceConfig[] = [
  {
    name: "MCP-Server",
    portEnvVar: "MCP_SERVER_PORT",
    tools: [
      {
        name: SearchNearby.NAME,
        description: SearchNearby.DESCRIPTION,
        schema: SearchNearby.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: SearchNearbyParams) => SearchNearby.ACTION(params),
      },
      {
        name: PlaceDetails.NAME,
        description: PlaceDetails.DESCRIPTION,
        schema: PlaceDetails.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: PlaceDetailsParams) => PlaceDetails.ACTION(params),
      },
      {
        name: Geocode.NAME,
        description: Geocode.DESCRIPTION,
        schema: Geocode.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: GeocodeParams) => Geocode.ACTION(params),
      },
      {
        name: ReverseGeocode.NAME,
        description: ReverseGeocode.DESCRIPTION,
        schema: ReverseGeocode.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: ReverseGeocodeParams) => ReverseGeocode.ACTION(params),
      },
      {
        name: DistanceMatrix.NAME,
        description: DistanceMatrix.DESCRIPTION,
        schema: DistanceMatrix.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: DistanceMatrixParams) => DistanceMatrix.ACTION(params),
      },
      {
        name: Directions.NAME,
        description: Directions.DESCRIPTION,
        schema: Directions.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: DirectionsParams) => Directions.ACTION(params),
      },
      {
        name: Elevation.NAME,
        description: Elevation.DESCRIPTION,
        schema: Elevation.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: ElevationParams) => Elevation.ACTION(params),
      },
      {
        name: SearchPlaces.NAME,
        description: SearchPlaces.DESCRIPTION,
        schema: SearchPlaces.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: SearchPlacesParams) => SearchPlaces.ACTION(params),
      },
      {
        name: ExploreArea.NAME,
        description: ExploreArea.DESCRIPTION,
        schema: ExploreArea.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: ExploreAreaParams) => ExploreArea.ACTION(params),
      },
      {
        name: PlanRoute.NAME,
        description: PlanRoute.DESCRIPTION,
        schema: PlanRoute.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: PlanRouteParams) => PlanRoute.ACTION(params),
      },
      {
        name: ComparePlaces.NAME,
        description: ComparePlaces.DESCRIPTION,
        schema: ComparePlaces.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: ComparePlacesParams) => ComparePlaces.ACTION(params),
      },
      {
        name: CreateUrl.NAME,
        description: CreateUrl.DESCRIPTION,
        schema: CreateUrl.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: CreateUrlParams) => CreateUrl.ACTION(params),
      },
      {
        name: GroundedSearch.NAME,
        description: GroundedSearch.DESCRIPTION,
        schema: GroundedSearch.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: GroundedSearchParams) => GroundedSearch.ACTION(params),
      },
      {
        name: ResolveNames.NAME,
        description: ResolveNames.DESCRIPTION,
        schema: ResolveNames.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: ResolveNamesParams) => ResolveNames.ACTION(params),
      },
      {
        name: ResolveMapsUrls.NAME,
        description: ResolveMapsUrls.DESCRIPTION,
        schema: ResolveMapsUrls.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: ResolveMapsUrlsParams) => ResolveMapsUrls.ACTION(params),
      },
      {
        name: TransitItineraryTool.NAME,
        description: TransitItineraryTool.DESCRIPTION,
        schema: TransitItineraryTool.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: TransitItineraryParams) => TransitItineraryTool.ACTION(params),
      },
      {
        name: PlanTransit.NAME,
        description: PlanTransit.DESCRIPTION,
        schema: PlanTransit.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: PlanTransitParams) => PlanTransit.ACTION(params),
      },
      {
        name: FindPlacesByTransit.NAME,
        description: FindPlacesByTransit.DESCRIPTION,
        schema: FindPlacesByTransit.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: FindPlacesByTransitParams) => FindPlacesByTransit.ACTION(params),
      },
      {
        name: OptimizeTransitErrands.NAME,
        description: OptimizeTransitErrands.DESCRIPTION,
        schema: OptimizeTransitErrands.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: OptimizeTransitErrandsParams) => OptimizeTransitErrands.ACTION(params),
      },
      {
        name: SearchAlongRoute.NAME,
        description: SearchAlongRoute.DESCRIPTION,
        schema: SearchAlongRoute.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: SearchAlongRouteParams) => SearchAlongRoute.ACTION(params),
      },
      {
        name: BatchGeocode.NAME,
        description: BatchGeocode.DESCRIPTION,
        schema: BatchGeocode.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params: BatchGeocodeParams) => BatchGeocode.ACTION(params),
      },
    ],
  },
];

export function filterTools(tools: ToolConfig[]): ToolConfig[] {
  const raw = process.env.GOOGLE_MAPS_ENABLED_TOOLS?.trim();
  if (raw === undefined || raw === "*") return tools;
  if (!raw) throw new Error("GOOGLE_MAPS_ENABLED_TOOLS cannot be empty.");

  const enabled = new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const unknown = [...enabled].filter((name) => !tools.some((tool) => tool.name === name));
  if (unknown.length) throw new Error(`Unknown tools in GOOGLE_MAPS_ENABLED_TOOLS: ${unknown.join(", ")}`);

  const filtered = tools.filter((t) => enabled.has(t.name));
  if (filtered.length === 0) {
    throw new Error(`GOOGLE_MAPS_ENABLED_TOOLS matched 0 tools. Available: ${tools.map((t) => t.name).join(", ")}`);
  }

  Logger.log(`GOOGLE_MAPS_ENABLED_TOOLS: ${filtered.length}/${tools.length} tools active`);
  return filtered;
}

export default serverConfigs;
