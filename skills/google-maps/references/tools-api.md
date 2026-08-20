# Current tool reference

This is the active tool contract for `bruglet/mcp-google-map`. It supersedes
the inherited upstream reference. The server publishes container images only;
the Google Maps key is always server-side.

## Shared location input

Planner and URL tools accept one of:

```json
{ "kind": "query", "value": "Union Square, San Francisco" }
{ "kind": "place_id", "value": "ChIJ...", "label": "Union Square" }
{ "kind": "coordinates", "latitude": 37.7879, "longitude": -122.4075, "label": "Union Square" }
{ "kind": "maps_url", "value": "https://maps.google.com/?cid=..." }
```

Maps URLs are resolved through the explicit Grounding Lite resolver when a
structured Place ID is required. The server never scrapes or persists URL
content. Existing atomic tools retain their address/coordinate string inputs.

## Places and location

### `maps_search_nearby`

Find minimal candidate places near `{center: {value, isCoordinates}, keyword?,
radius?, openNow?, minRating?}`. The response contains Place ID, name,
address, coordinates, primary type, types, and a local Maps URL. Ratings,
hours, price, contact, reviews, photos, parking, and atmosphere are not
requested as generic enrichment.

### `maps_search_places`

Search `{query, locationBias?, openNow?, minRating?, includedType?}`. Results
use the same minimal identity/location response as nearby search.

### `maps_place_details`

Fetch one known `placeId`. The optional `include` array accepts only semantic
groups: `contact`, `hours`, `ratings`, `price`, `reviews`, `accessibility`,
`amenities`, `parking`, and `ai_summaries`. The server expands and validates
these groups into one Places New field mask and records the highest expected
billing tier. There is no `maxPhotos` parameter and no hidden Legacy review
request.

### `maps_geocode`, `maps_reverse_geocode`, `maps_batch_geocode`

Use `maps_geocode` with `{address}`; `maps_reverse_geocode` with
`{latitude, longitude}`; and `maps_batch_geocode` with a bounded `addresses`
array. Coordinates and Place IDs should be reused when already known.

### `maps_elevation`

Explicitly request elevation for `{locations: [{latitude, longitude}]}`. This
is not fetched by place or transit tools.

## Routes

### `maps_directions`

Route `{origin, destination, mode?, departure_time?, arrival_time?,
alternatives?, detail_level?, traffic?, transit_modes?,
transit_preference?, avoid_tolls?, avoid_highways?, intermediates?}`.

`mode` is `driving`, `walking`, `bicycling`, or `transit`. `detail_level` is
`summary` (default), `steps`, `geometry`, or `full`. Traffic is driving-only
and defaults to `none`; waypoint ordering is opt-in; alternatives default to
false. Departure and arrival times are mutually exclusive. Transit does not
accept intermediate waypoints.

### `maps_distance_matrix`

Compute `{origins, destinations, mode?, departure_time?, traffic?,
transit_modes?, transit_preference?, avoid_tolls?, avoid_highways?}`. Route
Matrix usage is counted as `origins × destinations`, including unavailable
elements, and is checked before fan-out.

### `maps_search_along_route`

Search `{textQuery, origin, destination, mode?, maxResults?}`. The route
geometry is requested internally, while the Places response remains minimal.

### `maps_explore_area`, `maps_plan_route`, `maps_compare_places`

These existing composites retain their upstream purpose but use the same
minimal Places defaults, local Maps URLs, and explicit route options. They do
not hardcode driving for comparisons. Enrichment must be requested through
semantic groups where supported.

## Grounding Lite and local Maps URLs

### `maps_grounded_search`

Run a bounded semantic place search with `{text_query}` through the lazy
Grounding Lite MCP adapter. Weather and routing are intentionally not
proxied. Structured output, Google attribution, and mixed failures are
preserved.

### `maps_resolve_names`

Resolve 1–20 specific `{queries: [{text}], region_code?}` entries to canonical
place identities. This is an experimental Grounding Lite resolver.

### `maps_resolve_maps_urls`

Resolve 1–20 `{urls}` entries. Input-index correspondence is preserved even
when individual entries fail. The adapter returns `GROUNDING_UNAVAILABLE`
instead of scraping when structured resolution is unavailable.

### `maps_create_url`

Create a local place, directions, or navigation URL from structured locations:
`{action: "place"|"directions"|"navigate", destination, origin?, mode?}`.
URLs always use `api=1`, prefer Place IDs, support transit navigation, and are
limited to 2,048 characters. This tool performs zero Google API requests.

## Transit planning

### `maps_transit_itinerary`

Route an ordered `locations` array one leg at a time. Optional parameters are
`departure_time`, `dwell_minutes`, `detail_level`, `transit_modes`, and
`transit_preference`. Actual arrival plus dwell is propagated into the next
leg. The default detail level is `steps` so lines, stops, transfers, and
walking/transit/waiting metrics can be returned. One local Maps URL is
returned per leg.

### `maps_plan_transit`

Reorder fixed `stops` between an `origin` and optional `final_destination`,
or return to origin. It accepts `departure_time`, `dwell_minutes`,
`detail_level`, `objective`, `planner_mode`, and transit preferences. Small
inputs use a Held–Karp-style dynamic program; larger inputs use bounded beam
search and 2-opt. Only finalists are chronologically rerouted in detail.

### `maps_find_places_by_transit`

Use `{origin, query, departure_time?, max_minutes?, objective?, planner_mode?}`
to discover bounded semantic candidates, remove only obvious geographic
outliers, compute a guarded transit matrix, reroute finalists, and optionally
enrich only finalists.

### `maps_optimize_transit_errands`

Use `{origin, errands, final_destination?, return_to_origin?, departure_time?,
objective?, planner_mode?}`. Each errand may contain a fixed `location` or a
search `query` plus `dwell_minutes`. Candidate branches and errand order are
searched locally; targeted matrix edges are projected and guarded before
execution; detailed routes are limited to finalists.

All transit objectives are deterministic: `fastest`, `fewest_transfers`,
`least_walking`, and `balanced`. Unknown secondary metrics are not treated as
zero. `planner_mode` is the only caller-controlled breadth setting;
operator-side environment overrides are documented in
`docs/COST_POLICY.md`.

## Disabled upstream tools

Weather, air quality, timezone, static maps, and local-rank tracking remain in
the source tree only to reduce future upstream merge conflicts. They are not
registered with MCP, not available through the CLI execution table, and are
not copied into the runtime image. Current weather and disruption questions
belong to a native web or agency source.
