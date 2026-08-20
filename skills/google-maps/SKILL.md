---
name: google-maps
description: Use the self-hosted bruglet Google Maps MCP for place identity, minimal Places search, routes, Maps URLs, and bounded transit planning.
---

# bruglet Google Maps MCP

Use this server for Google-specific geospatial operations. It is a fork of CabLate’s MIT-licensed `cablate/mcp-google-map`; current weather and live transit disruption questions belong to a native web or agency source.

## Cost-aware defaults

- Prefer `maps_create_url` when the user only needs a handoff link. It is local and makes zero Google requests.
- Prefer `maps_resolve_names` for a small batch of specific names and `maps_resolve_maps_urls` for sharing links. Both are bounded at 20 and experimental; preserve their attribution and mixed-failure correspondence.
- Search and Place Details return identity/location by default. Ask for semantic enrichment groups only when the user requests hours, ratings, contact, price, reviews, accessibility, amenities, parking, or summaries.
- `maps_directions` defaults to summary, no traffic awareness, no alternatives, and no geometry. Request `detail_level=steps` for transit lines/transfers or turn-by-turn instructions; request geometry only for a polyline use case.
- Matrix requests are charged per origin×destination element. Keep candidates bounded and use `planner_mode=conservative` unless the user explicitly needs a broader search.

## Tool routing

| Need                                | Tool                                                |
| ----------------------------------- | --------------------------------------------------- |
| Search nearby or by text            | `maps_search_nearby`, `maps_search_places`          |
| Get known Place ID details          | `maps_place_details` with explicit `include` groups |
| Address/coordinate conversion       | `maps_geocode`, `maps_reverse_geocode`              |
| One route or matrix                 | `maps_directions`, `maps_distance_matrix`           |
| Local handoff link                  | `maps_create_url`                                   |
| Ordered transit path                | `maps_transit_itinerary`                            |
| Reorder known transit stops         | `maps_plan_transit`                                 |
| Find a business by transit          | `maps_find_places_by_transit`                       |
| Choose errand branches and order    | `maps_optimize_transit_errands`                     |
| Search places along a driving route | `maps_search_along_route`                           |

## Transit rules

Transit does not accept intermediate waypoints. For an ordered path, call `maps_transit_itinerary`; it routes each leg separately, propagates actual arrival plus dwell, and returns one Maps URL per leg. For fixed-stop optimization, use `maps_plan_transit`; it uses a bounded matrix, local search, and exact chronological reranking.

## Credential and privacy boundary

The deployed HTTP origin validates Cloudflare Access JWTs. Never send a Google key in an MCP request header, bearer token, URL, prompt, result, or tool argument. The server reads `GOOGLE_MAPS_API_KEY` only from its protected environment. Do not ask the origin to implement user login or ChatGPT-facing OAuth.
