import { PlacesClient } from "@googlemaps/places";
import { Logger } from "../index.js";
import { buildPlaceFieldMask, DEFAULT_PLACE_GROUPS, PlaceFieldGroup } from "./costPolicy.js";
import { withAccounting } from "./requestAccounting.js";

export interface PlaceSearchOptions {
  location: { lat: number; lng: number };
  keyword?: string;
  radius?: number;
  maxResultCount?: number;
  openNow?: boolean;
  minRating?: number;
  parentTool?: string;
}

export class NewPlacesService {
  private readonly client: PlacesClient;
  private readonly apiKey: string;
  private readonly defaultLanguage = "en";

  constructor(apiKey?: string, client?: PlacesClient) {
    this.apiKey = apiKey || process.env.GOOGLE_MAPS_API_KEY || "";
    if (!this.apiKey) throw new Error("Google Maps API Key is required");
    this.client = client || new PlacesClient({ apiKey: this.apiKey });
  }

  async searchNearby(params: PlaceSearchOptions): Promise<any[]> {
    try {
      const request: any = {
        locationRestriction: {
          circle: {
            center: { latitude: params.location.lat, longitude: params.location.lng },
            radius: params.radius || 1000,
          },
        },
        maxResultCount: Math.min(params.maxResultCount || 20, 20),
        languageCode: this.defaultLanguage,
      };
      if (params.keyword) request.includedTypes = [params.keyword];
      if (params.openNow) request.openNow = true;
      if (params.minRating !== undefined) request.minRating = params.minRating;

      const fieldMask = buildPlaceFieldMask(DEFAULT_PLACE_GROUPS, "places.");
      const [response] = await withAccounting(
        {
          api: "places",
          operation: "searchNearby",
          tier: "T2",
          units: 1,
          parentTool: params.parentTool || "maps_search_nearby",
          reason: "minimal candidate discovery",
          fanout: "S",
        },
        () =>
          this.client.searchNearby(request, {
            otherArgs: { headers: { "X-Goog-FieldMask": fieldMask.mask } },
          })
      );
      return (response.places || []).map((place: any) => this.transformSearchResult(place));
    } catch (error: any) {
      Logger.error("Error in searchNearby (New API):", error);
      throw new Error(`Failed to search nearby places: ${this.extractErrorMessage(error)}`);
    }
  }

  async searchText(params: {
    textQuery: string;
    locationBias?: { lat: number; lng: number; radius?: number };
    openNow?: boolean;
    minRating?: number;
    includedType?: string;
    maxResultCount?: number;
    parentTool?: string;
  }): Promise<any[]> {
    try {
      const request: any = {
        textQuery: params.textQuery,
        languageCode: this.defaultLanguage,
        maxResultCount: Math.min(params.maxResultCount || 10, 20),
      };
      if (params.locationBias) {
        request.locationBias = {
          circle: {
            center: { latitude: params.locationBias.lat, longitude: params.locationBias.lng },
            radius: params.locationBias.radius || 5000,
          },
        };
      }
      if (params.openNow) request.openNow = true;
      if (params.minRating !== undefined) request.minRating = params.minRating;
      if (params.includedType) request.includedType = params.includedType;

      const fieldMask = buildPlaceFieldMask(DEFAULT_PLACE_GROUPS, "places.");
      const [response] = await withAccounting(
        {
          api: "places",
          operation: "searchText",
          tier: "T2",
          units: 1,
          parentTool: params.parentTool || "maps_search_places",
          reason: "minimal candidate discovery",
          fanout: "S",
        },
        () =>
          this.client.searchText(request, {
            otherArgs: { headers: { "X-Goog-FieldMask": fieldMask.mask } },
          })
      );
      return (response.places || []).map((place: any) => this.transformSearchResult(place));
    } catch (error: any) {
      Logger.error("Error in searchText (New API):", error);
      throw new Error(`Failed to search places: ${this.extractErrorMessage(error)}`);
    }
  }

  async getPlaceDetails(placeId: string, groups: PlaceFieldGroup[] = [], parentTool?: string): Promise<any> {
    try {
      const requestedGroups = [...new Set([...DEFAULT_PLACE_GROUPS, ...groups])];
      const fieldMask = buildPlaceFieldMask(requestedGroups);
      const [place] = await withAccounting(
        {
          api: "places",
          operation: "getPlaceDetails",
          tier: fieldMask.tier,
          units: 1,
          parentTool: parentTool || "maps_place_details",
          reason: requestedGroups.length > 2 ? "explicit enrichment" : "basic place identity",
          fanout: "S",
        },
        () =>
          this.client.getPlace(
            { name: `places/${placeId}`, languageCode: this.defaultLanguage },
            { otherArgs: { headers: { "X-Goog-FieldMask": fieldMask.mask } } }
          )
      );
      return this.transformPlaceResponse(place);
    } catch (error: any) {
      Logger.error("Error in getPlaceDetails (New API):", error);
      throw new Error(`Failed to get place details for ${placeId}: ${this.extractErrorMessage(error)}`);
    }
  }

  private transformSearchResult(place: any): any {
    const result: any = {
      name: place.displayName?.text || place.name || "",
      place_id: this.extractLegacyPlaceId(place),
      formatted_address: place.formattedAddress || "",
      geometry: { location: { lat: place.location?.latitude || 0, lng: place.location?.longitude || 0 } },
      primary_type: place.primaryType || null,
      types: place.types || [],
    };
    if (place.rating !== undefined) result.rating = place.rating;
    if (place.userRatingCount !== undefined) result.user_ratings_total = place.userRatingCount;
    if (place.priceLevel !== undefined) result.price_level = place.priceLevel;
    if (place.currentOpeningHours?.openNow !== undefined) result.open_now = place.currentOpeningHours.openNow;
    return result;
  }

  private transformPlaceResponse(place: any): any {
    const result: any = {
      name: place.displayName?.text || place.name || "",
      place_id: this.extractLegacyPlaceId(place),
      formatted_address: place.formattedAddress || "",
      geometry: { location: { lat: place.location?.latitude || 0, lng: place.location?.longitude || 0 } },
      primary_type: place.primaryType || null,
      types: place.types || [],
    };
    if (place.rating !== undefined) result.rating = place.rating;
    if (place.userRatingCount !== undefined) result.user_ratings_total = place.userRatingCount;
    if (place.priceLevel !== undefined) result.price_level = place.priceLevel;
    if (place.nationalPhoneNumber !== undefined) result.formatted_phone_number = place.nationalPhoneNumber;
    if (place.websiteUri !== undefined) result.website = place.websiteUri;
    if (place.editorialSummary?.text !== undefined) result.editorial_summary = place.editorialSummary.text;
    if (place.regularOpeningHours) {
      result.opening_hours = {
        open_now: place.currentOpeningHours?.openNow ?? place.regularOpeningHours.openNow ?? null,
        weekday_text: place.regularOpeningHours.weekdayDescriptions || [],
      };
    }
    if (place.accessibilityOptions) result.accessibility = truthyObject(place.accessibilityOptions);
    if (place.parkingOptions) result.parking = truthyObject(place.parkingOptions);

    const diningOptions: Record<string, boolean> = {};
    for (const [source, target] of [
      ["dineIn", "dine_in"],
      ["delivery", "delivery"],
      ["takeout", "takeout"],
      ["curbsidePickup", "curbside_pickup"],
      ["reservable", "reservable"],
    ]) {
      if (place[source]) diningOptions[target] = true;
    }
    if (Object.keys(diningOptions).length) result.dining_options = diningOptions;

    const serves: Record<string, boolean> = {};
    for (const field of [
      "VegetarianFood",
      "Beer",
      "Wine",
      "Cocktails",
      "Breakfast",
      "Lunch",
      "Dinner",
      "Brunch",
      "Coffee",
      "Dessert",
    ]) {
      const key = `serves${field}`;
      if (place[key])
        serves[field.replace(/[A-Z]/g, (match: string) => `_${match.toLowerCase()}`).replace(/^_/, "")] = true;
    }
    if (Object.keys(serves).length) result.serves = serves;

    const atmosphere: Record<string, boolean> = {};
    for (const [source, target] of [
      ["goodForGroups", "good_for_groups"],
      ["goodForChildren", "good_for_children"],
      ["goodForWatchingSports", "good_for_watching_sports"],
      ["liveMusic", "live_music"],
      ["outdoorSeating", "outdoor_seating"],
      ["allowsDogs", "allows_dogs"],
      ["menuForChildren", "menu_for_children"],
      ["restroom", "restroom"],
    ]) {
      if (place[source]) atmosphere[target] = true;
    }
    if (Object.keys(atmosphere).length) result.atmosphere = atmosphere;
    if (place.paymentOptions) result.payment_options = truthyObject(place.paymentOptions);
    if (place.reviewSummary?.text?.text) result.review_summary = place.reviewSummary.text.text;
    if (place.generativeSummary?.overview?.text) result.generative_summary = place.generativeSummary.overview.text;
    if (Array.isArray(place.reviews)) {
      result.reviews = place.reviews.map((review: any) => ({
        rating: review.rating || 0,
        text: review.text?.text || "",
        language: review.text?.languageCode || null,
        time: review.publishTime?.seconds || 0,
        author_name: review.authorAttribution?.displayName || "",
      }));
    }
    return result;
  }

  private extractLegacyPlaceId(place: any): string {
    const resourceName = place?.name;
    if (typeof resourceName === "string" && resourceName.startsWith("places/"))
      return resourceName.slice("places/".length);
    return place?.id || "";
  }

  private extractErrorMessage(error: any): string {
    const statusCode = error?.code;
    const message = error?.message || error?.details;
    if (statusCode === 7 || statusCode === 403) return "API key invalid or Places API (New) not enabled.";
    if (statusCode === 8 || statusCode === 429) return "API quota exceeded. Check Google Cloud quotas.";
    return message || (error instanceof Error ? error.message : String(error));
  }
}

function truthyObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item === true));
}
