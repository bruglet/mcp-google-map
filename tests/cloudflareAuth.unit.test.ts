import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { cloudflareAuthMiddleware } from "../src/utils/cloudflareAuth.js";

function request(remoteAddress: string, token?: string): any {
  return {
    socket: { remoteAddress },
    header: (name: string) => (name.toLowerCase() === "cf-access-jwt-assertion" ? token : undefined),
  };
}

function response(): { statusCode: number; body: string; status: (code: number) => any; send: (value: string) => any } {
  const value = { statusCode: 200, body: "" };
  return {
    get statusCode() {
      return value.statusCode;
    },
    get body() {
      return value.body;
    },
    status(code: number) {
      value.statusCode = code;
      return this;
    },
    send(body: string) {
      value.body = body;
      return this;
    },
  };
}

test("loopback auth permits local requests and rejects non-loopback requests", () => {
  const previous = process.env.MCP_AUTH_MODE;
  process.env.MCP_AUTH_MODE = "loopback";
  try {
    let called = false;
    cloudflareAuthMiddleware(request("127.0.0.1"), response() as any, () => {
      called = true;
    });
    assert.equal(called, true);

    const denied = response();
    cloudflareAuthMiddleware(request("192.168.1.5"), denied as any, () => undefined);
    assert.equal(denied.statusCode, 403);
  } finally {
    if (previous === undefined) delete process.env.MCP_AUTH_MODE;
    else process.env.MCP_AUTH_MODE = previous;
  }
});

test("cloudflare mode fails closed and distinguishes missing tokens", () => {
  const previousMode = process.env.MCP_AUTH_MODE;
  const previousTeam = process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN;
  const previousAud = process.env.CLOUDFLARE_ACCESS_AUD;
  process.env.MCP_AUTH_MODE = "cloudflare";
  process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN = "https://example.cloudflareaccess.com";
  process.env.CLOUDFLARE_ACCESS_AUD = "test-audience";
  try {
    const missing = response();
    cloudflareAuthMiddleware(request("127.0.0.1"), missing as any, () => undefined);
    assert.equal(missing.statusCode, 401);
  } finally {
    if (previousMode === undefined) delete process.env.MCP_AUTH_MODE;
    else process.env.MCP_AUTH_MODE = previousMode;
    if (previousTeam === undefined) delete process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN;
    else process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN = previousTeam;
    if (previousAud === undefined) delete process.env.CLOUDFLARE_ACCESS_AUD;
    else process.env.CLOUDFLARE_ACCESS_AUD = previousAud;
  }
});

test("Cloudflare JWT validation accepts only a valid RS256 issuer and audience", async () => {
  const [{ privateKey, publicKey }, wrongKeys] = await Promise.all([
    generateKeyPair("RS256"),
    generateKeyPair("RS256"),
  ]);
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "test-key";
  const teamDomain = await new Promise<string>((resolve) => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ keys: [publicJwk] }));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to start JWKS test server");
      resolve(`http://127.0.0.1:${address.port}`);
    });
    server.unref();
  });

  const audience = "maps-audience";
  const previous = {
    mode: process.env.MCP_AUTH_MODE,
    team: process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN,
    aud: process.env.CLOUDFLARE_ACCESS_AUD,
  };
  process.env.MCP_AUTH_MODE = "cloudflare";
  process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN = teamDomain;
  process.env.CLOUDFLARE_ACCESS_AUD = audience;

  const invoke = async (token: string): Promise<{ statusCode: number; nextCalled: boolean }> => {
    const result = response();
    let nextCalled = false;
    cloudflareAuthMiddleware(request("127.0.0.1", token), result as any, () => {
      nextCalled = true;
    });
    await new Promise<void>((resolve) => {
      const deadline = Date.now() + 1000;
      const check = () => {
        if (nextCalled || result.statusCode !== 200 || Date.now() >= deadline) {
          resolve();
          return;
        }
        setTimeout(check, 10);
      };
      check();
    });
    return { statusCode: result.statusCode, nextCalled };
  };

  const now = Math.floor(Date.now() / 1000);
  const valid = await new SignJWT({ sub: "test-user" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(teamDomain)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .sign(privateKey);
  const serviceToken = await new SignJWT({ sub: "", common_name: "service-token.access" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(teamDomain)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .sign(privateKey);
  const expired = await new SignJWT({ sub: "test-user" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(teamDomain)
    .setAudience(audience)
    .setIssuedAt(now - 120)
    .setExpirationTime(now - 60)
    .sign(privateKey);
  const wrongAudience = await new SignJWT({ sub: "test-user" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(teamDomain)
    .setAudience("other-audience")
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .sign(privateKey);
  const wrongSignature = await new SignJWT({ sub: "test-user" })
    .setProtectedHeader({ alg: "RS256", kid: "wrong-key" })
    .setIssuer(teamDomain)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .sign(wrongKeys.privateKey);
  const missingExpiry = await new SignJWT({ sub: "test-user" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(teamDomain)
    .setAudience(audience)
    .setIssuedAt(now)
    .sign(privateKey);

  try {
    assert.deepEqual(await invoke(valid), { statusCode: 200, nextCalled: true });
    assert.deepEqual(await invoke(serviceToken), { statusCode: 200, nextCalled: true });
    assert.equal((await invoke(expired)).statusCode, 403);
    assert.equal((await invoke(wrongAudience)).statusCode, 403);
    assert.equal((await invoke(wrongSignature)).statusCode, 403);
    assert.equal((await invoke(missingExpiry)).statusCode, 403);
  } finally {
    if (previous.mode === undefined) delete process.env.MCP_AUTH_MODE;
    else process.env.MCP_AUTH_MODE = previous.mode;
    if (previous.team === undefined) delete process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN;
    else process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN = previous.team;
    if (previous.aud === undefined) delete process.env.CLOUDFLARE_ACCESS_AUD;
    else process.env.CLOUDFLARE_ACCESS_AUD = previous.aud;
  }
});
