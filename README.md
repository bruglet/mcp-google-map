# bruglet/mcp-google-map

[![CI](https://github.com/bruglet/mcp-google-map/actions/workflows/ci.yml/badge.svg)](https://github.com/bruglet/mcp-google-map/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

A cost-conscious, self-hosted Google Maps MCP fork based on [CabLate’s upstream repository](https://github.com/cablate/mcp-google-map). The fork retains the upstream MIT license and attribution while adding server-side credential handling, policy-driven Places/Routes requests, Grounding Lite adapters, local Maps URLs, and time-aware transit planners.

This repository publishes OCI images only:

```text
ghcr.io/bruglet/mcp-google-map:main
ghcr.io/bruglet/mcp-google-map:sha-<commit>
```

It does not publish `@cablate/mcp-google-map`, an npm package, or an MCP Registry entry. The public fork keeps `upstream` as CabLate’s source and `origin` as `bruglet/mcp-google-map`; see [UPSTREAM_DEVIATIONS.md](./UPSTREAM_DEVIATIONS.md) before bringing in upstream changes.

## Capabilities

The active MCP profile includes geocoding, reverse geocoding, elevation, minimal Places search/details, Routes directions and matrices, search-along-route, local URL construction, Grounding Lite place search/resolution, ordered transit itineraries, fixed-stop transit optimization, transit-accessible discovery, and errand branch/order optimization.

The following inherited tools are intentionally not registered: weather, air quality, static maps, timezone, and local rank tracking. Current weather and disruption questions should be handed to a native web or agency source. Google API calls are made only with `GOOGLE_MAPS_API_KEY` (or the optional server-side Grounding key); MCP request headers are never treated as Google credentials.

## Run locally

Install and build with Node.js 24 LTS:

```bash
npm ci
npm run build
GOOGLE_MAPS_API_KEY=... MCP_SERVER_PORT=3020 MCP_SERVER_HOST=127.0.0.1 \
  MCP_AUTH_MODE=loopback node dist/cli.js
```

For stdio clients, set `GOOGLE_MAPS_API_KEY` in the process environment and run `node dist/cli.js --stdio`. The loopback auth mode is for local development only. HTTP production deployments use Cloudflare Access validation and the rootless Quadlet described in [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).

## Server configuration

Required for Google-backed tools:

```dotenv
GOOGLE_MAPS_API_KEY=replace-me
MCP_SERVER_HOST=0.0.0.0
MCP_SERVER_PORT=3020
MCP_AUTH_MODE=cloudflare
CLOUDFLARE_ACCESS_TEAM_DOMAIN=https://example.cloudflareaccess.com
CLOUDFLARE_ACCESS_AUD=replace-me
```

Optional Grounding Lite use also requires `GOOGLE_MAPS_GROUNDING_TERMS_ACK=true` after confirming that the connected LLM satisfies Google’s data-use terms. `GOOGLE_MAPS_GROUNDING_API_KEY` may be used as a separate server-side key and otherwise falls back to the main Maps key.

`GOOGLE_MAPS_ENABLED_TOOLS` accepts a comma-separated allowlist. Unknown or empty profiles fail closed. The process does not accept `X-Google-Maps-API-Key`, a bearer token, cookies, or other client-supplied Google credentials.

## Cost controls

Places defaults to identity/location fields and makes one combined Places New request for details. Contact, hours, ratings, price, reviews, accessibility, amenities, parking, and AI-summary groups are opt-in semantic groups; raw field masks are not accepted. Routes defaults to summary detail, no traffic awareness, no alternatives, and no waypoint ordering. Route matrices are guarded and accounted for as `origins × destinations`, including unavailable elements.

Composite planners expose only `planner_mode=conservative|thorough`. Multi-stop route planning passes known locations directly and leaves waypoint ordering off unless explicitly requested. The mounted ledger stores UTC monthly counters and warning thresholds, never Maps response content. Full field/SKU notes and official links are in [docs/COST_POLICY.md](./docs/COST_POLICY.md).

## Rootless production deployment

The supported deployment is a rootless Podman Quadlet in the `host` user’s systemd instance. The container runs as UID/GID `10001`, with a read-only root filesystem, dropped capabilities, no-new-privileges, bounded memory/process counts, and only the usage ledger mounted writable. The MCP binds to the host loopback only; the existing host-networked cloudflared container should use `http://localhost:3020` as its origin.

```bash
mkdir -p ~/.config/mcp-google-map
cp deploy/mcp-google-map.env.example ~/.config/mcp-google-map/env
chmod 600 ~/.config/mcp-google-map/env
./deploy/install-rootless-quadlet.sh
```

The Quadlet follows the public mutable `:main` tag with `AutoUpdate=registry`. Every passing `main` build also publishes a full-commit SHA tag for audit and rollback. See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) for lingering, health, cloudflared, network-boundary, auto-update, and rollback checks.

## Grounding Lite boundary

The adapter lazily connects to `https://mapstools.googleapis.com/mcp` and exposes only place search, name resolution, and Maps URL resolution. It preserves structured output, attribution, input correspondence, and mixed failures; it does not proxy Grounding weather or routing. The experimental resolvers are isolated behind the adapter and return `GROUNDING_UNAVAILABLE` when disabled or unavailable.

## Development and tests

```bash
npm ci
npm run test:unit       # mocked and deterministic tests; no Google quota
npm run build
npm run lint
npm run format:check
```

Live Google tests are deliberately excluded from ordinary CI. Run the manually dispatched `Live Google Maps tests` workflow with a repository secret and `GOOGLE_MAPS_LIVE_TESTS=1`.

## Attribution

This is a fork of [cablate/mcp-google-map](https://github.com/cablate/mcp-google-map), originally authored and maintained by CabLate and contributors. Their MIT license, notices, and upstream history are preserved. New fork-specific work is maintained by `bruglet` and documented in [UPSTREAM_DEVIATIONS.md](./UPSTREAM_DEVIATIONS.md).
