# Architecture

```text
Cloudflare Access
        |
        | Cf-Access-Jwt-Assertion
        v
existing host-networked cloudflared
        |
        | http://localhost:3020
        v
127.0.0.1:3020 -> rootless Quadlet -> mcp-google-map:3020
                                      |
                                      +--> Google Places / Routes APIs
                                      +--> Maps Grounding Lite (lazy)
                                      +--> XDG usage ledger only
```

The origin validates the Access JWT’s RS256 signature through Cloudflare’s remote JWKS and checks issuer, audience, and expiry. `/healthz` is intentionally unauthenticated for local systemd/container readiness and never calls Google. `/mcp` POST, GET, and DELETE all pass through the origin authentication middleware.

Google credentials are process environment only. The MCP request context may carry the server key for compatibility with the existing service adapters, but no request header is interpreted as a key and no key is included in logs, responses, URLs, image layers, health output, or ledger state.

The runtime image contains compiled output and production dependencies only. The process is UID/GID 10001, the root filesystem is read-only, all capabilities are dropped, and the only persistent mount is the counter-only ledger. Grounding content is forwarded for the current request with attribution; it is not persisted.

## Upstream boundary

`config.ts` is the registration boundary. Disabled upstream tools remain in source only where deleting them would increase merge conflict surface; they are not reachable through MCP registration or the CLI allowlist. Policy, URL, accounting, authentication, location, Grounding, and planner behavior lives in additive modules. Narrow upstream edits and their regression coverage are tracked in [UPSTREAM_DEVIATIONS.md](../UPSTREAM_DEVIATIONS.md).
