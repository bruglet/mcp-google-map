import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Request, Response, NextFunction } from "express";

const jwksByTeamDomain = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function configured(): boolean {
  return Boolean(process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN && process.env.CLOUDFLARE_ACCESS_AUD);
}

function loopbackRequest(req: Request): boolean {
  const address = req.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function cloudflareAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const mode = process.env.MCP_AUTH_MODE || "cloudflare";
  if (mode === "loopback") {
    if (loopbackRequest(req)) next();
    else res.status(403).send("Loopback-only development mode");
    return;
  }

  if (mode !== "cloudflare" || !configured()) {
    res.status(503).send("Cloudflare Access authentication is not configured");
    return;
  }

  const token = req.header("Cf-Access-Jwt-Assertion");
  if (!token) {
    res.status(401).send("Missing Cloudflare Access token");
    return;
  }

  const teamDomain = process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN!.replace(/\/$/, "");
  let jwks = jwksByTeamDomain.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksByTeamDomain.set(teamDomain, jwks);
  }
  jwtVerify(token, jwks, {
    issuer: teamDomain,
    audience: process.env.CLOUDFLARE_ACCESS_AUD,
    algorithms: ["RS256"],
    requiredClaims: ["iss", "aud", "exp"],
  })
    .then(() => next())
    .catch(() => res.status(403).send("Invalid Cloudflare Access token"));
}
