# Canonical feature acceptance

| Use case                             | Primary path                                | Expected cost behavior                                           |
| ------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------- |
| Resolve a named location             | `maps_resolve_names` or `maps_geocode`      | Grounding resolution is bounded; raw geocoding remains available |
| Resolve a Maps sharing URL           | `maps_resolve_maps_urls`                    | No scraping; experimental adapter can fail closed                |
| Generate navigation                  | `maps_create_url`                           | T0; no Google request                                            |
| Simple transit duration              | `maps_directions` with `mode=transit`       | Summary mask, one route request                                  |
| Detailed transit lines/transfers     | `maps_directions` with `detail_level=steps` | Steps/transit details requested explicitly                       |
| Ordered fixed-path transit           | `maps_transit_itinerary`                    | Separate legs; arrival plus dwell propagates                     |
| Semantic transit-accessible business | `maps_find_places_by_transit`               | Bounded discovery, matrix, finalist reranking                    |
| Fixed-stop reordering                | `maps_plan_transit`                         | Coarse matrix, local search, exact finalist reranking            |
| Branch and order optimization        | `maps_optimize_transit_errands`             | Candidate branches and orders are bounded                        |
| Minimal driving search-along-route   | `maps_search_along_route`                   | Geometry is internal; Places fields stay minimal                 |
| Current disruption lookup            | Native web/agency source                    | Not claimed as a guaranteed Google Maps capability               |

Planner outputs include guard reductions, selected branches/orders where applicable, exact route metrics, and a handoff URL per leg. Unknown secondary metrics are not treated as zero.
