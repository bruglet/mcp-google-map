import assert from "node:assert/strict";
import test from "node:test";
import { buildPlaceFieldMask, DEFAULT_PLACE_GROUPS, expectedSku } from "../src/services/costPolicy.js";

test("default Places mask is identity/location only", () => {
  const result = buildPlaceFieldMask(DEFAULT_PLACE_GROUPS, "places.");
  assert.equal(result.tier, "T2");
  assert.match(result.mask, /places\.displayName/);
  assert.match(result.mask, /places\.location/);
  assert.doesNotMatch(result.mask, /reviews|photos|rating|OpeningHours|price|phone|website/i);
});

test("semantic Places groups deduplicate fields and report the highest tier", () => {
  const result = buildPlaceFieldMask(["identity", "location", "ratings", "ratings"]);
  assert.equal(result.tier, "T3");
  assert.equal(result.fields.filter((field) => field === "rating").length, 1);
});

test("raw or unknown field masks fail closed", () => {
  assert.throws(() => buildPlaceFieldMask(["rating"] as never), /Unknown Places field group/);
});

test("known request accounting uses provider SKU names", () => {
  assert.equal(expectedSku("routes", "computeRoutes", "T1"), "Routes: Compute Routes Essentials");
  assert.equal(expectedSku("places", "getPlaceDetails", "T4"), "Places API Place Details Enterprise + Atmosphere");
});
