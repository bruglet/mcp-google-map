import { GoogleMapsTools } from "./toolclass.js";
import { NewPlacesService } from "./NewPlacesService.js";
import { RoutesService, parseDuration, formatDistance, formatDuration } from "./RoutesService.js";
import { createPlaceUrl, createDirectionsUrl } from "./mapsUrlService.js";
import {
  buildPlaceFieldMask,
  DEFAULT_PLACE_GROUPS,
  PlaceFieldGroup,
  plannerLimits,
  tierAtLeast,
} from "./costPolicy.js";
import { TransitItineraryService } from "./TransitItineraryService.js";

interface SearchResponse {
  success: boolean;
  error?: string;
  data?: any[];
  location?: any;
}

interface PlaceDetailsResponse {
  success: boolean;
  error?: string;
  data?: any;
}

interface GeocodeResponse {
  success: boolean;
  error?: string;
  data?: {
    location: { lat: number; lng: number };
    formatted_address: string;
    place_id: string;
  };
}

interface ReverseGeocodeResponse {
  success: boolean;
  error?: string;
  data?: {
    formatted_address: string;
    place_id: string;
    address_components: any[];
  };
}

interface DistanceMatrixResponse {
  success: boolean;
  error?: string;
  data?: {
    distances: any[][];
    durations: any[][];
    origin_addresses: string[];
    destination_addresses: string[];
  };
}

interface DirectionsResponse {
  success: boolean;
  error?: string;
  data?: {
    routes: any[];
    summary: string;
    total_distance: { value: number; text: string };
    total_duration: { value: number; text: string };
    google_maps_navigation_url?: string;
  };
}

interface TimezoneResponse {
  success: boolean;
  error?: string;
  data?: {
    timeZoneId: string;
    timeZoneName: string;
    utcOffset: number;
    dstOffset: number;
    localTime: string;
  };
}

interface WeatherResponse {
  success: boolean;
  error?: string;
  data?: any;
}

interface StaticMapResponse {
  success: boolean;
  error?: string;
  data?: {
    base64: string;
    size: number;
    dimensions: string;
  };
}

interface AirQualityResponse {
  success: boolean;
  error?: string;
  data?: any;
}

interface ElevationResponse {
  success: boolean;
  error?: string;
  data?: Array<{
    elevation: number;
    location: { lat: number; lng: number };
  }>;
}

export class PlacesSearcher {
  private mapsTools: GoogleMapsTools;
  private newPlacesService: NewPlacesService;
  private routesService: RoutesService;
  private readonly placeDetailsCache = new Map<string, Promise<PlaceDetailsResponse>>();

  constructor(apiKey?: string) {
    this.mapsTools = new GoogleMapsTools(apiKey);
    this.newPlacesService = new NewPlacesService(apiKey);
    this.routesService = new RoutesService(apiKey);
  }

  async searchNearby(params: {
    center: { value: string; isCoordinates: boolean };
    keyword?: string;
    radius?: number;
    openNow?: boolean;
    minRating?: number;
    parentTool?: string;
  }): Promise<SearchResponse> {
    try {
      const location = await this.mapsTools.getLocation(params.center, params.parentTool);
      const places = await this.newPlacesService.searchNearby({
        location,
        keyword: params.keyword,
        radius: params.radius,
        openNow: params.openNow,
        minRating: params.minRating,
        parentTool: params.parentTool,
      });

      return {
        location: location,
        success: true,
        data: places.map((place: any) => ({
          name: place.name,
          place_id: place.place_id,
          address: place.formatted_address,
          location: place.geometry.location,
          primary_type: place.primary_type || null,
          google_maps_url: createPlaceUrl({
            label: place.name,
            address: place.formatted_address,
            placeId: place.place_id,
            coordinates: { latitude: place.geometry.location.lat, longitude: place.geometry.location.lng },
          }),
          ...(place.price_level !== undefined ? { price_level: place.price_level } : {}),
          ...(place.rating !== undefined ? { rating: place.rating } : {}),
          ...(place.user_ratings_total !== undefined ? { total_ratings: place.user_ratings_total } : {}),
          ...(place.open_now !== undefined ? { open_now: place.open_now } : {}),
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred during search",
      };
    }
  }

  async searchText(params: {
    query: string;
    locationBias?: { latitude: number; longitude: number; radius?: number };
    openNow?: boolean;
    minRating?: number;
    includedType?: string;
    parentTool?: string;
  }): Promise<SearchResponse> {
    try {
      const places = await this.newPlacesService.searchText({
        textQuery: params.query,
        locationBias: params.locationBias
          ? {
              lat: params.locationBias.latitude,
              lng: params.locationBias.longitude,
              radius: params.locationBias.radius,
            }
          : undefined,
        openNow: params.openNow,
        minRating: params.minRating,
        includedType: params.includedType,
        parentTool: params.parentTool,
      });

      return {
        success: true,
        data: places.map((place: any) => ({
          name: place.name,
          place_id: place.place_id,
          address: place.formatted_address,
          location: place.geometry.location,
          primary_type: place.primary_type || null,
          google_maps_url: createPlaceUrl({
            label: place.name,
            address: place.formatted_address,
            placeId: place.place_id,
            coordinates: { latitude: place.geometry.location.lat, longitude: place.geometry.location.lng },
          }),
          ...(place.price_level !== undefined ? { price_level: place.price_level } : {}),
          ...(place.rating !== undefined ? { rating: place.rating } : {}),
          ...(place.user_ratings_total !== undefined ? { total_ratings: place.user_ratings_total } : {}),
          ...(place.open_now !== undefined ? { open_now: place.open_now } : {}),
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred during text search",
      };
    }
  }

  async getPlaceDetails(
    placeId: string,
    include: PlaceFieldGroup[] = [],
    parentTool?: string
  ): Promise<PlaceDetailsResponse> {
    const cacheKey = `${placeId}\u0000${[...new Set(include)].sort().join(",")}`;
    const cached = this.placeDetailsCache.get(cacheKey);
    if (cached) return cached;

    const request = (async () => {
      try {
        const details = await this.newPlacesService.getPlaceDetails(placeId, include, parentTool);

        return {
          success: true,
          data: {
            name: details.name,
            address: details.formatted_address,
            location: details.geometry?.location,
            primary_type: details.primary_type || null,
            types: details.types || [],
            ...(details.rating !== undefined ? { rating: details.rating } : {}),
            ...(details.user_ratings_total !== undefined ? { total_ratings: details.user_ratings_total } : {}),
            ...(details.opening_hours ? { opening_hours: details.opening_hours } : {}),
            ...(details.formatted_phone_number ? { phone: details.formatted_phone_number } : {}),
            ...(details.website ? { website: details.website } : {}),
            ...(details.price_level !== undefined ? { price_level: details.price_level } : {}),
            ...(details.editorial_summary ? { editorial_summary: details.editorial_summary } : {}),
            ...(details.parking ? { parking: details.parking } : {}),
            ...(details.accessibility ? { accessibility: details.accessibility } : {}),
            ...(details.dining_options ? { dining_options: details.dining_options } : {}),
            ...(details.serves ? { serves: details.serves } : {}),
            ...(details.atmosphere ? { atmosphere: details.atmosphere } : {}),
            ...(details.payment_options ? { payment_options: details.payment_options } : {}),
            ...(details.review_summary ? { review_summary: details.review_summary } : {}),
            ...(details.generative_summary ? { generative_summary: details.generative_summary } : {}),
            ...(details.reviews
              ? {
                  reviews: details.reviews.map((review: any) => ({
                    rating: review.rating,
                    text: review.text,
                    language: review.language || null,
                    time: review.time,
                    author_name: review.author_name,
                  })),
                }
              : {}),
            google_maps_url: createPlaceUrl({
              label: details.name,
              address: details.formatted_address,
              placeId: details.place_id,
              coordinates: details.geometry?.location
                ? { latitude: details.geometry.location.lat, longitude: details.geometry.location.lng }
                : undefined,
            }),
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "An error occurred while getting place details",
        };
      }
    })();
    this.placeDetailsCache.set(cacheKey, request);
    return request;
  }

  async geocode(address: string, parentTool?: string): Promise<GeocodeResponse> {
    try {
      const result = await this.mapsTools.geocode(address, parentTool);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred while geocoding address",
      };
    }
  }

  async reverseGeocode(latitude: number, longitude: number): Promise<ReverseGeocodeResponse> {
    try {
      const result = await this.mapsTools.reverseGeocode(latitude, longitude);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred during reverse geocoding",
      };
    }
  }

  async calculateDistanceMatrix(
    origins: string[],
    destinations: string[],
    mode: "driving" | "walking" | "bicycling" | "transit" = "driving",
    departure_time?: string,
    avoid_tolls?: boolean,
    avoid_highways?: boolean,
    traffic: "none" | "aware" | "optimal" = "none",
    transit_modes?: Array<"BUS" | "SUBWAY" | "TRAIN" | "LIGHT_RAIL" | "RAIL">,
    transit_preference?: "LESS_WALKING" | "FEWER_TRANSFERS",
    parentTool?: string
  ): Promise<DistanceMatrixResponse> {
    try {
      const result = await this.routesService.computeRouteMatrix({
        origins,
        destinations,
        mode,
        ...(departure_time ? { departureTime: new Date(departure_time) } : {}),
        ...(avoid_tolls !== undefined ? { avoidTolls: avoid_tolls } : {}),
        ...(avoid_highways !== undefined ? { avoidHighways: avoid_highways } : {}),
        traffic,
        transitModes: transit_modes,
        transitPreference: transit_preference,
        parentTool,
      });

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred while calculating distance matrix",
      };
    }
  }

  async getDirections(
    origin: string,
    destination: string,
    mode: "driving" | "walking" | "bicycling" | "transit" = "driving",
    departure_time?: string,
    arrival_time?: string,
    avoid_tolls?: boolean,
    avoid_highways?: boolean,
    traffic: "none" | "aware" | "optimal" = "none",
    alternatives = false,
    detail_level: "summary" | "steps" | "geometry" | "full" = "summary",
    transit_modes?: Array<"BUS" | "SUBWAY" | "TRAIN" | "LIGHT_RAIL" | "RAIL">,
    transit_preference?: "LESS_WALKING" | "FEWER_TRANSFERS",
    parentTool?: string
  ): Promise<DirectionsResponse> {
    try {
      const departureTime = departure_time ? new Date(departure_time) : undefined;
      const arrivalTime = arrival_time ? new Date(arrival_time) : undefined;
      const result = await this.routesService.computeRoutes({
        origin,
        destination,
        mode,
        ...(departureTime ? { departureTime } : {}),
        ...(arrivalTime ? { arrivalTime } : {}),
        ...(avoid_tolls !== undefined ? { avoidTolls: avoid_tolls } : {}),
        ...(avoid_highways !== undefined ? { avoidHighways: avoid_highways } : {}),
        traffic,
        alternatives,
        detailLevel: detail_level,
        transitModes: transit_modes,
        transitPreference: transit_preference,
        parentTool,
      });

      const destinationUrl = createDirectionsUrl({
        origin: { address: origin },
        destination: { address: destination },
        mode,
        navigate: true,
      });

      return {
        success: true,
        data: { ...result, google_maps_navigation_url: destinationUrl },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred while getting directions",
      };
    }
  }

  async getTimezone(latitude: number, longitude: number, timestamp?: number): Promise<TimezoneResponse> {
    try {
      const result = await this.mapsTools.getTimezone(latitude, longitude, timestamp);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred while getting timezone",
      };
    }
  }

  async getWeather(
    latitude: number,
    longitude: number,
    type: "current" | "forecast_daily" | "forecast_hourly" = "current",
    forecastDays?: number,
    forecastHours?: number
  ): Promise<WeatherResponse> {
    try {
      const result = await this.mapsTools.getWeather(latitude, longitude, type, forecastDays, forecastHours);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred while getting weather",
      };
    }
  }

  async getAirQuality(
    latitude: number,
    longitude: number,
    includeHealthRecommendations?: boolean,
    includePollutants?: boolean
  ): Promise<AirQualityResponse> {
    try {
      const result = await this.mapsTools.getAirQuality(
        latitude,
        longitude,
        includeHealthRecommendations,
        includePollutants
      );
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred while getting air quality",
      };
    }
  }

  async getStaticMap(params: {
    center?: string;
    zoom?: number;
    size?: string;
    maptype?: string;
    markers?: string[];
    path?: string[];
  }): Promise<StaticMapResponse> {
    try {
      const result = await this.mapsTools.getStaticMap(params);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred while generating static map",
      };
    }
  }

  async searchAlongRoute(params: {
    textQuery: string;
    origin: string;
    destination: string;
    mode?: string;
    maxResults?: number;
    parentTool?: string;
  }): Promise<{ success: boolean; error?: string; data?: any }> {
    try {
      const result = await this.mapsTools.searchAlongRoute(params);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred while searching along route",
      };
    }
  }

  // --------------- Composite Tools ---------------

  async exploreArea(params: {
    location: string;
    types?: string[];
    radius?: number;
    topN?: number;
    enrich_top_n?: number;
    include?: PlaceFieldGroup[];
    planner_mode?: "conservative" | "thorough";
  }): Promise<any> {
    // "tourist_attraction" is the Places API (New) type name; a bare
    // "attraction" is rejected with INVALID_ARGUMENT: Unsupported types.
    const types = [...new Set(params.types || ["restaurant", "cafe", "tourist_attraction"])];
    const radius = params.radius || 1000;
    const mode = params.planner_mode || "conservative";
    const limits = plannerLimits(mode);
    const include = params.include || [];
    const enrichmentTier = buildPlaceFieldMask([...DEFAULT_PLACE_GROUPS, ...include]).tier;
    const requestedTopN = params.enrich_top_n ?? params.topN ?? 0;
    const topN = include.length ? Math.min(requestedTopN, limits.candidatesPerGroup) : 0;
    if (tierAtLeast(enrichmentTier, "T3") && topN * types.length > limits.highTierEnrichments)
      throw new Error(
        `Area exploration projects ${topN * types.length} high-tier Place enrichments; the ${mode} planner limit is ${limits.highTierEnrichments}.`
      );

    // 1. Geocode
    const geo = await this.geocode(params.location, "maps_explore_area");
    if (!geo.success || !geo.data) throw new Error(geo.error || "Geocode failed");
    const { lat, lng } = geo.data.location;

    // 2. Search each type
    const categories: any[] = [];
    for (const type of types) {
      const search = await this.searchNearby({
        center: { value: `${lat},${lng}`, isCoordinates: true },
        keyword: type,
        radius,
        parentTool: "maps_explore_area",
      });
      if (!search.success || !search.data) continue;

      // 3. Get details for top N
      const candidates = search.data.slice(0, limits.candidatesPerGroup);
      const topPlaces = candidates.slice(0, topN);
      const detailed = [];
      for (const place of topPlaces) {
        if (!place.place_id) continue;
        const details = await this.getPlaceDetails(place.place_id, include, "maps_explore_area");
        detailed.push({
          name: place.name,
          address: place.address,
          rating: place.rating,
          total_ratings: place.total_ratings,
          open_now: place.open_now,
          phone: details.data?.phone,
          website: details.data?.website,
        });
      }
      categories.push({ type, count: candidates.length, top: detailed });
    }

    return {
      success: true,
      data: {
        location: { address: geo.data.formatted_address, lat, lng },
        radius,
        categories,
      },
    };
  }

  async planRoute(params: {
    stops: string[];
    mode?: "driving" | "walking" | "bicycling" | "transit";
    optimize?: boolean;
    departure_time?: string;
    avoid_tolls?: boolean;
    avoid_highways?: boolean;
    planner_mode?: "conservative" | "thorough";
  }): Promise<any> {
    const mode = params.mode || "driving";
    const stops = params.stops;
    if (stops.length < 2) throw new Error("Need at least 2 stops");
    const plannerMode = params.planner_mode || "conservative";
    const limits = plannerLimits(plannerMode);
    if (stops.length - 2 > limits.fixedStops)
      throw new Error(
        `This route has ${stops.length - 2} intermediate stops; the ${plannerMode} planner limit is ${limits.fixedStops}.`
      );

    if (mode === "transit") {
      const itinerary = await new TransitItineraryService(this.routesService).routeFixedPath({
        locations: stops,
        departureTime: params.departure_time ? new Date(params.departure_time) : undefined,
        plannerMode,
        parentTool: "maps_plan_route",
      });
      return { success: true, data: itinerary };
    }

    // Routes accepts addresses, coordinates, and Place IDs directly. Keep the
    // caller's values so planning does not spend a geocoding request only to
    // display a second spelling of the same stop.
    const stopsForOutput = stops.map((stop) => ({ originalName: stop, address: stop }));

    // Single Routes API call handles optional optimization + all leg directions
    const origin = stops[0];
    const destination = stops[stops.length - 1];
    const intermediates = stops.length > 2 ? stops.slice(1, -1) : undefined;
    // Waypoint ordering is a higher-tier Routes option and is opt-in.
    const shouldOptimize = params.optimize === true && stops.length > 2;

    const routeResult = await this.routesService.computeRoutes({
      origin,
      destination,
      mode,
      intermediates,
      optimizeWaypointOrder: shouldOptimize,
      parentTool: "maps_plan_route",
      ...(params.departure_time ? { departureTime: new Date(params.departure_time) } : {}),
      ...(params.avoid_tolls !== undefined ? { avoidTolls: params.avoid_tolls } : {}),
      ...(params.avoid_highways !== undefined ? { avoidHighways: params.avoid_highways } : {}),
    });

    const route = routeResult.routes[0];
    const routeLegs = route?.legs || [];

    // 3. Determine ordered stops based on optimization result
    let orderedStops: typeof stopsForOutput;
    if (shouldOptimize && routeResult.optimizedIntermediateWaypointIndex) {
      const optimizedOrder = routeResult.optimizedIntermediateWaypointIndex;
      const intermediateStops = stopsForOutput.slice(1, -1);
      orderedStops = [
        stopsForOutput[0],
        ...optimizedOrder.map((i: number) => intermediateStops[i]),
        stopsForOutput[stopsForOutput.length - 1],
      ];
    } else {
      orderedStops = stopsForOutput;
    }

    // 4. Build legs from Routes API response
    const legs: any[] = [];
    let totalDistance = 0;
    let totalDuration = 0;

    for (let i = 0; i < orderedStops.length - 1; i++) {
      const leg = routeLegs[i];
      if (leg) {
        const distMeters = leg.distanceMeters || 0;
        const durSeconds = parseDuration(leg.duration);
        totalDistance += distMeters;
        totalDuration += durSeconds;
        legs.push({
          from: orderedStops[i].originalName,
          to: orderedStops[i + 1].originalName,
          distance: formatDistance(distMeters),
          duration: formatDuration(durSeconds),
        });
      } else {
        legs.push({
          from: orderedStops[i].originalName,
          to: orderedStops[i + 1].originalName,
          distance: "unknown",
          duration: "unknown",
          note: "Directions unavailable for this segment",
        });
      }
    }

    return {
      success: true,
      data: {
        mode,
        optimized: shouldOptimize,
        stops: orderedStops.map((s) => `${s.originalName} (${s.address})`),
        legs,
        total_distance: `${(totalDistance / 1000).toFixed(1)} km`,
        total_duration: `${Math.round(totalDuration / 60)} min`,
      },
    };
  }

  async comparePlaces(params: {
    query: string;
    userLocation?: { latitude: number; longitude: number };
    limit?: number;
    mode?: "driving" | "walking" | "bicycling" | "transit";
    include?: PlaceFieldGroup[];
    planner_mode?: "conservative" | "thorough";
  }): Promise<any> {
    const mode = params.planner_mode || "conservative";
    const limits = plannerLimits(mode);
    const limit = Math.min(params.limit || 5, limits.candidatesPerGroup);
    const include = params.include || [];
    const enrichmentTier = buildPlaceFieldMask([...DEFAULT_PLACE_GROUPS, ...include]).tier;
    if (tierAtLeast(enrichmentTier, "T3") && limit > limits.highTierEnrichments)
      throw new Error(
        `Place comparison projects ${limit} high-tier enrichments; the ${mode} planner limit is ${limits.highTierEnrichments}.`
      );

    // 1. Search
    const search = await this.searchText({ query: params.query, parentTool: "maps_compare_places" });
    if (!search.success || !search.data) throw new Error(search.error || "Search failed");

    const places = deduplicatePlaces(search.data).slice(0, limit);

    // 2. Get details for each
    const compared: any[] = [];
    for (const place of places) {
      const details = include.length
        ? await this.getPlaceDetails(place.place_id, include, "maps_compare_places")
        : { data: undefined };
      compared.push({
        name: place.name,
        address: place.address,
        primary_type: details.data?.primary_type || place.primary_type || null,
        rating: place.rating,
        total_ratings: place.total_ratings,
        opening_hours: details.data?.opening_hours,
        phone: details.data?.phone,
        website: details.data?.website,
        price_level: details.data?.price_level,
        ...(details.data?.parking ? { parking: details.data.parking } : {}),
        ...(details.data?.serves ? { serves: details.data.serves } : {}),
        ...(details.data?.atmosphere ? { atmosphere: details.data.atmosphere } : {}),
        ...(details.data?.dining_options ? { dining_options: details.data.dining_options } : {}),
      });
    }

    // 3. Distance from user location (if provided)
    if (params.userLocation && compared.length > 0) {
      const origin = `${params.userLocation.latitude},${params.userLocation.longitude}`;
      const destinations = places.map((p: any) => `${p.location.lat},${p.location.lng}`);
      const matrix = await this.calculateDistanceMatrix(
        [origin],
        destinations,
        params.mode || "transit",
        undefined,
        undefined,
        undefined,
        "none",
        undefined,
        undefined,
        "maps_compare_places"
      );
      if (matrix.success && matrix.data) {
        for (let i = 0; i < compared.length; i++) {
          compared[i].distance = matrix.data.distances[0]?.[i]?.text;
          compared[i].travel_time = matrix.data.durations[0]?.[i]?.text;
        }
      }
    }

    return { success: true, data: compared };
  }

  async getElevation(locations: Array<{ latitude: number; longitude: number }>): Promise<ElevationResponse> {
    try {
      const result = await this.mapsTools.getElevation(locations);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred while getting elevation data",
      };
    }
  }

  async localRankTracker(params: {
    keywords: string[];
    placeId: string;
    center: { latitude: number; longitude: number };
    gridSize?: number;
    gridSpacing?: number;
  }): Promise<any> {
    try {
      const gridSize = params.gridSize || 3;
      const spacingMeters = params.gridSpacing || 1000;
      const { latitude: centerLat, longitude: centerLng } = params.center;

      // Generate grid coordinates
      const half = Math.floor(gridSize / 2);
      const metersPerDegreeLat = 111320;
      const metersPerDegreeLng = 111320 * Math.cos((centerLat * Math.PI) / 180);

      const gridPoints: Array<{ row: number; col: number; lat: number; lng: number }> = [];
      for (let row = 0; row < gridSize; row++) {
        for (let col = 0; col < gridSize; col++) {
          const rowOffset = (row - half) * spacingMeters;
          const colOffset = (col - half) * spacingMeters;
          gridPoints.push({
            row,
            col,
            lat: centerLat + rowOffset / metersPerDegreeLat,
            lng: centerLng + colOffset / metersPerDegreeLng,
          });
        }
      }

      // Get target business name
      let targetName = "";
      try {
        const details = await this.getPlaceDetails(params.placeId);
        if (details.success && details.data) {
          targetName = details.data.name;
        }
      } catch {
        // ignore
      }

      // Scan each keyword across the grid
      const keywordResults = [];
      for (const keyword of params.keywords) {
        const gridResults = await this.scanKeywordGrid(keyword, params.placeId, gridPoints, spacingMeters);
        keywordResults.push({ keyword, ...gridResults });
      }

      // Single keyword: flat response (backward compatible)
      if (keywordResults.length === 1) {
        const kr = keywordResults[0];
        return {
          success: true,
          data: {
            target: { name: targetName, place_id: params.placeId },
            grid_size: `${gridSize}x${gridSize}`,
            grid_spacing_m: spacingMeters,
            keyword: kr.keyword,
            metrics: kr.metrics,
            grid: kr.grid,
          },
        };
      }

      // Multi-keyword: array of results
      return {
        success: true,
        data: {
          target: { name: targetName, place_id: params.placeId },
          grid_size: `${gridSize}x${gridSize}`,
          grid_spacing_m: spacingMeters,
          keywords: keywordResults.map((kr) => ({
            keyword: kr.keyword,
            metrics: kr.metrics,
            grid: kr.grid,
          })),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred during local rank tracking",
      };
    }
  }

  private async scanKeywordGrid(
    keyword: string,
    placeId: string,
    gridPoints: Array<{ row: number; col: number; lat: number; lng: number }>,
    spacingMeters: number
  ) {
    const concurrency = 5;
    const gridResults: Array<{
      row: number;
      col: number;
      lat: number;
      lng: number;
      rank: number | null;
      top3: string[];
    }> = [];

    const searchOne = async (point: (typeof gridPoints)[0]) => {
      try {
        const places = await this.newPlacesService.searchText({
          textQuery: keyword,
          locationBias: { lat: point.lat, lng: point.lng, radius: spacingMeters / 2 },
          maxResultCount: 20,
        });

        const rank = places.findIndex((p: any) => p.place_id === placeId);
        const top3 = places.slice(0, 3).map((p: any) => p.name || "");

        return {
          row: point.row,
          col: point.col,
          lat: Math.round(point.lat * 1e6) / 1e6,
          lng: Math.round(point.lng * 1e6) / 1e6,
          rank: rank >= 0 ? rank + 1 : null,
          top3,
        };
      } catch {
        return {
          row: point.row,
          col: point.col,
          lat: Math.round(point.lat * 1e6) / 1e6,
          lng: Math.round(point.lng * 1e6) / 1e6,
          rank: null,
          top3: [] as string[],
        };
      }
    };

    for (let i = 0; i < gridPoints.length; i += concurrency) {
      const batch = gridPoints.slice(i, i + concurrency);
      const results = await Promise.all(batch.map(searchOne));
      gridResults.push(...results);
    }

    const rankedPoints = gridResults.filter((r) => r.rank !== null);
    const totalPoints = gridResults.length;
    const inTop3 = rankedPoints.filter((r) => r.rank! <= 3).length;

    const arp =
      rankedPoints.length > 0
        ? Math.round((rankedPoints.reduce((sum, r) => sum + r.rank!, 0) / rankedPoints.length) * 10) / 10
        : null;

    const atrp = Math.round((gridResults.reduce((sum, r) => sum + (r.rank ?? 21), 0) / totalPoints) * 10) / 10;

    const solv = Math.round((inTop3 / totalPoints) * 1000) / 10;

    return {
      metrics: {
        arp,
        atrp,
        solv,
        found_in: `${rankedPoints.length}/${totalPoints}`,
      },
      grid: gridResults,
    };
  }
}

function deduplicatePlaces(places: any[]): any[] {
  const seen = new Set<string>();
  return places.filter((place) => {
    const key = place.place_id || `${place.name}\u0000${place.address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
