# Production deployment

The production target is the `host` user on Mercury, using rootless Podman Quadlets.

The expected service files are:

```text
~/.config/containers/systemd/mcp-google-map.container
~/.config/mcp-google-map/mcp-google-map.env
~/.local/state/mcp-google-map/
```

The image is published as:

```text
ghcr.io/bruglet/mcp-google-map:main
```

The Quadlet publishes the container’s port 3020 only on host loopback:

```text
127.0.0.1:3020 -> container:3020
```

The existing host-networked `cloudflared` container should use `http://localhost:3020` as its tunnel origin. Do not add a second cloudflared service or expose this MCP on `0.0.0.0`.

## Install

Copy `deploy/mcp-google-map.env.example` to the host environment-file path, replace all values, and set mode 600. Then run `deploy/install-rootless-quadlet.sh` as the `host` user.

The installer refuses placeholder values, installs the Quadlet under the user systemd instance, and uses `podman unshare chown` only on `~/.local/state/mcp-google-map` so the image UID 10001 can write its counter file. It does not create a root-owned service, modify unrelated ownership, create a Podman network, or install cloudflared.

The host already uses user lingering and the distribution `podman-auto-update.timer`. The Quadlet’s `AutoUpdate=registry` setting tracks the public `:main` tag. GitHub Actions advances that tag only after CI and the container smoke test pass.

## Verify

```bash
systemctl --user status mcp-google-map.service
podman ps --filter name=mcp-google-map
curl --fail http://127.0.0.1:3020/healthz
podman healthcheck run mcp-google-map
systemctl --user is-enabled podman-auto-update.timer
systemctl --user is-active podman-auto-update.timer
podman auto-update --dry-run
```

The public MCP endpoint remains protected by Cloudflare Access. The origin validates `Cf-Access-Jwt-Assertion`; it does not implement login or accept Google API keys from clients.

From the host-networked cloudflared container, verify the same origin path:

```bash
podman exec <existing-cloudflared-container> curl --fail http://localhost:3020/healthz
```

From a different LAN host, a connection to port 3020 must fail. The public hostname must reject a request without a valid Cloudflare Access token and allow a request with a valid token. `/healthz` is local readiness only and is not a substitute for the protected `/mcp` path.

## Rollback

Replace the image in the active Quadlet with the previous immutable SHA tag, reload the user systemd manager, and restart:

```bash
sed -i 's#^Image=.*#Image=ghcr.io/bruglet/mcp-google-map:sha-<previous-commit>#' ~/.config/containers/systemd/mcp-google-map.container
podman pull ghcr.io/bruglet/mcp-google-map:sha-<previous-commit>
systemctl --user daemon-reload
systemctl --user restart mcp-google-map.service
systemctl --user status mcp-google-map.service
```

The existing auto-update service prunes unused images, so rollback may need to pull the previous SHA tag from GHCR first.
