# Cost policy and provider snapshot

This document records the policy used by the fork. It is a control plane for request construction, not a promise that Google pricing or product limits will remain unchanged. Recheck the linked official pages before changing a tier or deploying a new planner.

Snapshot date: 2026-08-19.

## Tiers

| Tier | Policy meaning                                      | Examples in this fork                                                                                      |
| ---- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| T0   | Local and non-billable                              | URL construction, Haversine/local scoring, planner search                                                  |
| T1   | Essentials or currently free experimental operation | Geocoding, basic Routes/Matrix, Grounding resolution                                                       |
| T2   | Pro                                                 | Places candidate discovery (display name/primary type), traffic-aware driving, geometry, waypoint ordering |
| T3   | Enterprise                                          | Hours, ratings, rating count, price, phone, website                                                        |
| T4   | Enterprise + Atmosphere                             | Reviews, summaries, parking, payment, dining and amenity attributes                                        |

The runtime does not contain dollar prices. The policy registry records the expected tier and units; `UsageLedger` records counters and emits warnings at 80% and 95% of the documented allowance without imposing a monthly block.

## Places field groups

Callers select semantic groups, never provider field-mask strings:

`identity`, `location`, `contact`, `hours`, `ratings`, `price`, `reviews`, `accessibility`, `amenities`, `parking`, and `ai_summaries`.

Identity and location are always present. The builder deduplicates fields, expands the group, computes the highest tier, and rejects unknown groups. Search results use the same minimal identity/location mask; details use one combined Places New request.

## Route and matrix controls

Summary is the default route detail. Steps, geometry, and full masks are additive. Traffic is `none` unless explicitly selected and is driving-only. Alternatives and waypoint ordering are opt-in. Transit intermediate waypoints are rejected because transit routing does not support them.

Matrix accounting is `origins × destinations`, including elements that return no route. The provider limit used by the guard is 100 elements for transit and traffic-aware-optimal matrices and 625 otherwise; planner modes impose lower local limits and split work before fan-out.

## Warning ledger and operator guard overrides

The counter-only ledger uses documented warning baselines of T1 `10,000`, T2 `5,000`, T3 `1,000`, and T4 `1,000` units. It warns at 80% and 95% and never blocks a request. Operators may tune these warning baselines with `MCP_USAGE_WARNING_CAP_T1` through `MCP_USAGE_WARNING_CAP_T4`.

Planner limits are caller-visible only as `planner_mode=conservative|thorough`. Operators may tune a mode with environment variables such as `MCP_PLANNER_CONSERVATIVE_MATRIX_ELEMENTS` or `MCP_PLANNER_THOROUGH_EXACT_ROUTES`; callers cannot provide arbitrary bypass values. Accounting logs endpoint/SKU, parent tool, tier, projected units, result state, fan-out, and optional timing/retry metadata without persisting Maps content.

## Official references

- [Places field selection](https://developers.google.com/maps/documentation/places/web-service/choose-fields)
- [Place Details (New), field/SKU details](https://developers.google.com/maps/documentation/places/web-service/place-details)
- [Places usage and billing](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)
- [Routes usage, billing, and matrix limits](https://developers.google.com/maps/documentation/routes/usage-and-billing)
- [Transit routes](https://developers.google.com/maps/documentation/routes/transit-route)
- [Maps Grounding Lite](https://developers.google.com/maps/ai/grounding-lite)
- [Grounding Lite MCP reference](https://developers.google.com/maps/ai/grounding-lite/reference/mcp)
- [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started)
