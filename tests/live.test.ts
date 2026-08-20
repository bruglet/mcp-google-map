import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

if (process.env.GOOGLE_MAPS_LIVE_TESTS !== "1") {
  throw new Error("Live tests are opt-in. Set GOOGLE_MAPS_LIVE_TESTS=1 explicitly.");
}

const port = 13579;
const endpoint = `http://127.0.0.1:${port}`;
const child = spawn("node", [resolve(import.meta.dirname ?? ".", "../dist/cli.js"), "--port", String(port)], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, MCP_AUTH_MODE: "loopback", MCP_SERVER_HOST: "127.0.0.1", MCP_SERVER_PORT: String(port) },
});

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`${endpoint}/healthz`);
      if (response.ok) return;
    } catch {
      // The process is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }
  throw new Error("Live test server did not become healthy");
}

async function rpc(
  sessionId: string | undefined,
  id: number,
  method: string,
  params: Record<string, unknown> = {}
): Promise<{ body: any; sessionId?: string }> {
  const response = await fetch(`${endpoint}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const newSessionId = response.headers.get("mcp-session-id") || undefined;
  const text = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const messages = text
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)));
    return { body: messages.find((message) => message.id === id) || messages.at(-1), sessionId: newSessionId };
  }
  return { body: JSON.parse(text), sessionId: newSessionId };
}

try {
  await waitForHealth();
  const initialized = await rpc(undefined, 1, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "live-tests", version: "1.0.0" },
  });
  assert.equal(initialized.body.error, undefined);
  const sessionId = initialized.sessionId;
  assert.ok(sessionId);

  const listed = await rpc(sessionId, 2, "tools/list");
  const names = (listed.body.result?.tools || []).map((tool: { name: string }) => tool.name);
  assert.ok(names.includes("maps_create_url"));
  assert.ok(!names.includes("maps_static_map"));

  const urlResult = await rpc(sessionId, 3, "tools/call", {
    name: "maps_create_url",
    arguments: {
      action: "navigate",
      destination: { kind: "place_id", value: "ChIJtest", label: "Test" },
      mode: "transit",
    },
  });
  assert.equal(urlResult.body.error, undefined);
  assert.match(urlResult.body.result?.content?.[0]?.text || "", /google\.com\/maps/);

  const geocode = await rpc(sessionId, 4, "tools/call", {
    name: "maps_geocode",
    arguments: { address: "1600 Amphitheatre Parkway, Mountain View, CA" },
  });
  assert.equal(geocode.body.error, undefined);
  assert.ok(geocode.body.result?.content?.length);
} finally {
  child.kill("SIGTERM");
  await new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise()));
}
