export type CostTier = "T0" | "T1" | "T2" | "T3" | "T4";
export type FanoutClass = "S" | "M" | "L";

export type PlaceFieldGroup =
  | "identity"
  | "location"
  | "contact"
  | "hours"
  | "ratings"
  | "price"
  | "reviews"
  | "accessibility"
  | "amenities"
  | "parking"
  | "ai_summaries";

const PLACE_GROUP_FIELDS: Record<PlaceFieldGroup, string[]> = {
  identity: ["displayName", "name", "id", "primaryType", "types"],
  location: ["formattedAddress", "location"],
  contact: ["nationalPhoneNumber", "websiteUri"],
  hours: [
    "utcOffsetMinutes",
    "regularOpeningHours.periods",
    "regularOpeningHours.weekdayDescriptions",
    "currentOpeningHours.openNow",
  ],
  ratings: ["rating", "userRatingCount"],
  price: ["priceLevel"],
  reviews: [
    "reviews.rating",
    "reviews.text",
    "reviews.publishTime",
    "reviews.authorAttribution.displayName",
    "reviewSummary",
  ],
  accessibility: ["accessibilityOptions"],
  amenities: [
    "servesVegetarianFood",
    "servesBeer",
    "servesWine",
    "servesCocktails",
    "servesBreakfast",
    "servesLunch",
    "servesDinner",
    "servesBrunch",
    "servesCoffee",
    "servesDessert",
    "dineIn",
    "delivery",
    "takeout",
    "curbsidePickup",
    "reservable",
    "goodForGroups",
    "goodForChildren",
    "goodForWatchingSports",
    "liveMusic",
    "outdoorSeating",
    "allowsDogs",
    "menuForChildren",
    "restroom",
    "paymentOptions",
  ],
  parking: ["parkingOptions"],
  ai_summaries: ["editorialSummary", "generativeSummary"],
};

const FIELD_TIER: Record<string, CostTier> = {
  // Google’s current Places field table treats displayName and primaryType as
  // Pro fields; IDs, types, address, and coordinates are Essentials.
  displayName: "T2",
  name: "T1",
  id: "T1",
  primaryType: "T2",
  types: "T1",
  formattedAddress: "T1",
  location: "T1",
  accessibilityOptions: "T2",
  utcOffsetMinutes: "T3",
  regularOpeningHours: "T3",
  currentOpeningHours: "T3",
  nationalPhoneNumber: "T3",
  websiteUri: "T3",
  priceLevel: "T3",
  rating: "T3",
  userRatingCount: "T3",
  reviews: "T4",
  reviewSummary: "T4",
  parkingOptions: "T4",
  editorialSummary: "T4",
  generativeSummary: "T4",
  servesVegetarianFood: "T4",
  servesBeer: "T4",
  servesWine: "T4",
  servesCocktails: "T4",
  servesBreakfast: "T4",
  servesLunch: "T4",
  servesDinner: "T4",
  servesBrunch: "T4",
  servesCoffee: "T4",
  servesDessert: "T4",
  dineIn: "T4",
  delivery: "T4",
  takeout: "T4",
  curbsidePickup: "T4",
  reservable: "T4",
  goodForGroups: "T4",
  goodForChildren: "T4",
  goodForWatchingSports: "T4",
  liveMusic: "T4",
  outdoorSeating: "T4",
  allowsDogs: "T4",
  menuForChildren: "T4",
  restroom: "T4",
  paymentOptions: "T4",
};

const TIER_ORDER: CostTier[] = ["T0", "T1", "T2", "T3", "T4"];

const REQUEST_SKUS: Record<string, string> = {
  "places:searchNearby:T2": "Places API Nearby Search Pro",
  "places:searchText:T2": "Places API Text Search Pro",
  "places:searchAlongRoute:T2": "Places API Text Search Pro",
  "places:getPlaceDetails:T2": "Places API Place Details Pro",
  "places:getPlaceDetails:T3": "Places API Place Details Enterprise",
  "places:getPlaceDetails:T4": "Places API Place Details Enterprise + Atmosphere",
  "routes:computeRoutes:T1": "Routes: Compute Routes Essentials",
  "routes:computeRoutes:T2": "Routes: Compute Routes Pro",
  "routes:computeRouteMatrix:T1": "Routes: Compute Route Matrix Essentials",
  "routes:computeRouteMatrix:T2": "Routes: Compute Route Matrix Pro",
  "grounding-lite:search_places:T1": "Maps Grounding Lite",
  "grounding-lite:resolve_names:T1": "Maps Grounding Lite",
  "grounding-lite:resolve_maps_urls:T1": "Maps Grounding Lite",
  "geocoding:geocode:T1": "Geocoding",
  "geocoding:reverseGeocode:T1": "Geocoding",
  "elevation:elevation:T2": "Elevation",
};

export interface FieldMaskResult {
  fields: string[];
  mask: string;
  tier: CostTier;
}

export function tierAtLeast(left: CostTier, right: CostTier): boolean {
  return TIER_ORDER.indexOf(left) >= TIER_ORDER.indexOf(right);
}

export function maxTier(...tiers: CostTier[]): CostTier {
  return tiers.reduce<CostTier>((current, tier) => (tierAtLeast(tier, current) ? tier : current), "T0");
}

export function expectedSku(api: string, operation: string, tier: CostTier): string {
  return REQUEST_SKUS[`${api}:${operation}:${tier}`] || `${api}:${operation}`;
}

function fieldTier(field: string): CostTier {
  const root = field.split(".")[0];
  return FIELD_TIER[field] || FIELD_TIER[root] || "T4";
}

export function fieldsForGroups(groups: PlaceFieldGroup[]): string[] {
  for (const group of groups) {
    if (!(group in PLACE_GROUP_FIELDS)) throw new Error(`Unknown Places field group: ${String(group)}`);
  }
  return [...new Set(groups.flatMap((group) => PLACE_GROUP_FIELDS[group]))];
}

export function buildPlaceFieldMask(groups: PlaceFieldGroup[], prefix = ""): FieldMaskResult {
  const fields = fieldsForGroups(groups);
  const tier = maxTier(...fields.map(fieldTier));
  return {
    fields,
    mask: fields.map((field) => `${prefix}${field}`).join(","),
    tier,
  };
}

export function describeCost(tier: CostTier, fanout: FanoutClass, note?: string): string {
  return `Cost: ${tier} | Fan-out: ${fanout}${note ? ` | ${note}` : ""}`;
}

export const DEFAULT_PLACE_GROUPS: PlaceFieldGroup[] = ["identity", "location"];

export const PLANNER_LIMITS = {
  conservative: {
    candidatesPerGroup: 5,
    groundingSearches: 4,
    matrixElements: 100,
    exactRoutes: 3,
    highTierEnrichments: 3,
    fixedStops: 8,
  },
  thorough: {
    candidatesPerGroup: 10,
    groundingSearches: 10,
    matrixElements: 300,
    exactRoutes: 8,
    highTierEnrichments: 10,
    fixedStops: 16,
  },
} as const;

export type PlannerMode = keyof typeof PLANNER_LIMITS;

const PLANNER_ENV_KEYS: Record<keyof typeof PLANNER_LIMITS.conservative, string> = {
  candidatesPerGroup: "CANDIDATES_PER_GROUP",
  groundingSearches: "GROUNDING_SEARCHES",
  matrixElements: "MATRIX_ELEMENTS",
  exactRoutes: "EXACT_ROUTES",
  highTierEnrichments: "HIGH_TIER_ENRICHMENTS",
  fixedStops: "FIXED_STOPS",
};

export function plannerLimits(mode: PlannerMode = "conservative") {
  const base = PLANNER_LIMITS[mode];
  return Object.fromEntries(
    Object.entries(base).map(([key, fallback]) => {
      const envName = `MCP_PLANNER_${mode.toUpperCase()}_${PLANNER_ENV_KEYS[key as keyof typeof PLANNER_ENV_KEYS]}`;
      const configured = Number.parseInt(process.env[envName] || "", 10);
      return [key, Number.isInteger(configured) && configured > 0 ? configured : fallback];
    })
  ) as { [K in keyof typeof base]: number };
}
