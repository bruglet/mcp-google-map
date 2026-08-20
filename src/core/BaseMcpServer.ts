import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import express, { Request, Response } from "express";
import { Server } from "http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Logger } from "../index.js";
import { runWithContext } from "../utils/requestContext.js";
import { cloudflareAuthMiddleware } from "../utils/cloudflareAuth.js";

const VERSION = "0.0.1";

// Define a structure for tool configurations
export interface ToolConfig {
  name: string;
  description: string;
  schema: Record<string, z.ZodTypeAny>;
  annotations?: ToolAnnotations;
  action: (params: any) => Promise<any>;
}

export interface SessionContext {
  apiKey?: string;
  transport: StreamableHTTPServerTransport;
}

export class BaseMcpServer {
  protected readonly server: McpServer;
  private sessions: { [sessionId: string]: SessionContext } = {};
  private httpServer: Server | null = null;
  private httpReady = false;
  private serverName: string;
  private tools: ToolConfig[];

  constructor(name: string, tools: ToolConfig[]) {
    this.serverName = name;
    this.tools = tools;
    this.server = this.createMcpServer();
  }

  private createMcpServer(): McpServer {
    const server = new McpServer(
      { name: this.serverName, version: VERSION },
      {
        capabilities: { logging: {}, tools: {} },
        instructions:
          "Use this MCP for Google-specific places, Place IDs, Maps URLs, routing, and transit planning. " +
          "Results are cost-controlled: optional Places enrichment, reviews, ratings, hours, photos, parking, and atmosphere fields are not requested unless explicitly selected. " +
          "Driving traffic is disabled by default. Matrix usage is billed per origin-destination element. Prefer native weather, image search, and current transit-disruption web search when those capabilities are sufficient.",
      }
    );
    this.tools.forEach((tool) => {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: z.object(tool.schema),
          annotations: tool.annotations,
        },
        async (params: any) => tool.action(params)
      );
    });
    return server;
  }

  async connect(transport: Transport): Promise<void> {
    await this.server.connect(transport);

    // Ensure stdout is only used for JSON messages
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: any, encoding?: any, callback?: any) => {
      if (typeof chunk === "string" && !chunk.startsWith("{")) {
        return true; // Silently skip non-JSON messages
      }
      return originalStdoutWrite(chunk, encoding, callback);
    };

    Logger.log(`${this.serverName} connected and ready to process requests`);
  }

  async startHttpServer(port: number, host: string = "0.0.0.0"): Promise<void> {
    const app = express();
    app.use(express.json());

    app.get("/healthz", (_req: Request, res: Response) => {
      res.status(200).json({
        status: this.httpReady ? "ok" : "starting",
        service: this.serverName,
        version: VERSION,
        liveness: "ok",
        ready: this.httpReady,
        config: {
          googleMapsApiKeyConfigured: Boolean(process.env.GOOGLE_MAPS_API_KEY),
          groundingApiKeyConfigured: Boolean(
            process.env.GOOGLE_MAPS_GROUNDING_API_KEY || process.env.GOOGLE_MAPS_API_KEY
          ),
          cloudflareAccessConfigured: Boolean(
            process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN && process.env.CLOUDFLARE_ACCESS_AUD
          ),
          authMode: process.env.MCP_AUTH_MODE || "cloudflare",
        },
        build: {
          revision: process.env.BUILD_REVISION || "unknown",
          upstreamBase: process.env.UPSTREAM_BASE_COMMIT || "unknown",
        },
      });
    });
    app.use("/mcp", cloudflareAuthMiddleware);

    // Handle POST requests for client-to-server communication
    app.post("/mcp", async (req: Request, res: Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let context: SessionContext;

      if (sessionId && this.sessions[sessionId]) {
        // Reuse existing session
        context = this.sessions[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New initialization request
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId) => {
            this.sessions[sessionId] = context;
            Logger.log(`[${this.serverName}] New session initialized: ${sessionId}`);
          },
          // DNS rebinding protection is disabled by default for backwards compatibility
          // For production use, enable this:
          // enableDnsRebindingProtection: true,
          // allowedHosts: ['127.0.0.1'],
        });

        // Create session context
        context = {
          transport,
          apiKey: process.env.GOOGLE_MAPS_API_KEY,
        };

        // Clean up transport when closed
        transport.onclose = () => {
          if (transport.sessionId) {
            delete this.sessions[transport.sessionId];
            Logger.log(`[${this.serverName}] Session closed: ${transport.sessionId}`);
          }
        };

        const sessionServer = this.createMcpServer();
        await sessionServer.connect(transport);
      } else {
        // Invalid request
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided",
          },
          id: null,
        });
        return;
      }

      // Run the request handler with the API key in context
      await runWithContext({ apiKey: context.apiKey, sessionId }, async () => {
        await context.transport.handleRequest(req, res, req.body);
      });
    });

    // Reusable handler for GET and DELETE requests
    const handleSessionRequest = async (req: Request, res: Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !this.sessions[sessionId]) {
        res.status(400).send("Invalid or missing session ID");
        return;
      }

      const context = this.sessions[sessionId];

      // Run the request handler with the API key in context
      await runWithContext({ apiKey: context.apiKey, sessionId }, async () => {
        await context.transport.handleRequest(req, res);
      });
    };

    // Handle GET requests for server-to-client notifications via SSE
    app.get("/mcp", handleSessionRequest);

    // Handle DELETE requests for session termination
    app.delete("/mcp", handleSessionRequest);

    const displayHost = host === "0.0.0.0" ? "localhost" : host;
    this.httpServer = app.listen(port, host, () => {
      this.httpReady = true;
      Logger.log(`[${this.serverName}] HTTP server listening on ${host}:${port}`);
      Logger.log(`[${this.serverName}] MCP endpoint available at http://${displayHost}:${port}/mcp`);
    });
  }

  async startStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.connect(transport);
  }

  async stopHttpServer(): Promise<void> {
    const httpServer = this.httpServer;
    if (!httpServer) {
      this.httpReady = false;
      return;
    }

    const sessions = Object.values(this.sessions);
    this.sessions = {};
    await Promise.all(
      sessions.map(async (context) => {
        await context.transport.close?.();
      })
    );

    this.httpReady = false;
    this.httpServer = null;

    await new Promise<void>((resolve, reject) => {
      httpServer.close((err: Error | undefined) => {
        if (err && (err as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
          Logger.error(`[${this.serverName}] Error stopping HTTP server:`, err);
          reject(err);
          return;
        }
        resolve();
      });
      httpServer.closeAllConnections();
    });

    Logger.log(`[${this.serverName}] HTTP server and all transports stopped.`);
  }
}
