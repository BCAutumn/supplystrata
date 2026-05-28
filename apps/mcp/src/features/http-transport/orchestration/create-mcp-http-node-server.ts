import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest, type JSONRPCMessage, type MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";

import type { SupplyStrataMcpServer, SupplyStrataMcpServerOptions } from "../../../definitions/mcp-server.js";
import { createSupplyStrataMcpServer } from "../../../orchestration/create-mcp-server.js";
import { MCP_HTTP_ENDPOINT_PATH, type CreateMcpHttpNodeServerOptions, type McpHttpNodeServer } from "../definitions/mcp-http-transport.js";
import { writeMcpHttpOptionsResponse, writePlainHttpResponse } from "../functions/http-response.js";

const MCP_HTTP_METHODS = new Set(["GET", "POST", "DELETE"]);

export async function createMcpHttpNodeServer(options: CreateMcpHttpNodeServerOptions = {}): Promise<McpHttpNodeServer> {
  const sessionsById = new Map<string, McpHttpSession>();
  const sessions = new Set<McpHttpSession>();

  const nodeServer = createServer((request, response) => {
    void handleMcpHttpRequest(request, response, {
      mcp: options.mcp,
      sessions,
      sessionsById
    });
  });
  let closeRuntimePromise: Promise<void> | undefined;

  const closeRuntime = (): Promise<void> => {
    closeRuntimePromise ??= closeMcpHttpSessions(sessions);
    return closeRuntimePromise;
  };

  nodeServer.once("close", () => {
    void closeRuntime();
  });

  return {
    endpointPath: MCP_HTTP_ENDPOINT_PATH,
    nodeServer,
    close: async () => {
      if (nodeServer.listening) await closeNodeServer(nodeServer);
      await closeRuntime();
    }
  };
}

interface McpHttpSessionRegistry {
  readonly mcp: SupplyStrataMcpServerOptions | undefined;
  readonly sessions: Set<McpHttpSession>;
  readonly sessionsById: Map<string, McpHttpSession>;
}

interface McpHttpSession {
  readonly mcpServer: SupplyStrataMcpServer["server"];
  readonly transport: McpStreamableHttpNodeTransport;
}

async function handleMcpHttpRequest(request: IncomingMessage, response: ServerResponse, registry: McpHttpSessionRegistry): Promise<void> {
  if (!isMcpEndpoint(request.url)) {
    writePlainHttpResponse(response, 404, "Not Found");
    return;
  }

  if (request.method === "OPTIONS") {
    writeMcpHttpOptionsResponse(response);
    return;
  }

  if (request.method === undefined || !MCP_HTTP_METHODS.has(request.method)) {
    response.setHeader("allow", "GET, POST, DELETE, OPTIONS");
    writePlainHttpResponse(response, 405, "Method Not Allowed");
    return;
  }

  try {
    const parsedBody = request.method === "POST" ? await readJsonBody(request) : undefined;
    const session = await resolveMcpHttpSession(request, response, parsedBody, registry);
    if (session === undefined) return;

    // SDK 的 Streamable HTTP transport 已包含 SSE stream 支持；这里不再接已废弃的 SSEServerTransport。
    await session.transport.handleRequest(request, response, parsedBody);
  } catch {
    if (!response.headersSent) writePlainHttpResponse(response, 500, "Internal MCP transport error");
  }
}

async function resolveMcpHttpSession(
  request: IncomingMessage,
  response: ServerResponse,
  parsedBody: unknown,
  registry: McpHttpSessionRegistry
): Promise<McpHttpSession | undefined> {
  const sessionId = readSingleHeader(request.headers["mcp-session-id"]);
  if (sessionId !== undefined) {
    const existing = registry.sessionsById.get(sessionId);
    if (existing !== undefined) return existing;
    writePlainHttpResponse(response, 400, "Invalid MCP session ID");
    return undefined;
  }

  if (request.method === "POST" && isInitializeRequest(parsedBody)) {
    return createMcpHttpSession(registry);
  }

  writePlainHttpResponse(response, 400, "Missing MCP session ID");
  return undefined;
}

async function createMcpHttpSession(registry: McpHttpSessionRegistry): Promise<McpHttpSession> {
  let session: McpHttpSession | undefined;
  const transport = new McpStreamableHttpNodeTransport(
    new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (sessionId) => {
        if (session !== undefined) registry.sessionsById.set(sessionId, session);
      }
    })
  );
  const { server: mcpServer } = createSupplyStrataMcpServer(registry.mcp);
  session = {
    mcpServer,
    transport
  };
  registry.sessions.add(session);
  await mcpServer.connect(transport);

  const protocolOnClose = transport.onclose;
  transport.onclose = () => {
    protocolOnClose?.();
    registry.sessions.delete(session);
    const sessionId = transport.readSessionId();
    if (sessionId !== undefined) registry.sessionsById.delete(sessionId);
  };
  transport.applyCallbacks();
  return session;
}

function isMcpEndpoint(rawUrl: string | undefined): boolean {
  if (rawUrl === undefined) return false;
  return new URL(rawUrl, "http://localhost").pathname === MCP_HTTP_ENDPOINT_PATH;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(httpBodyChunkToBuffer(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) return undefined;
  const parsed: unknown = JSON.parse(raw);
  return parsed;
}

function httpBodyChunkToBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === "string") return Buffer.from(chunk, "utf8");
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  throw new Error("Unsupported MCP HTTP request body chunk.");
}

function readSingleHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function closeNodeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

async function closeMcpHttpSessions(sessions: Set<McpHttpSession>): Promise<void> {
  await Promise.all(
    [...sessions].map(async (session) => {
      await session.transport.close();
      await session.mcpServer.close();
    })
  );
}

// SDK 的 Node transport 声明和本仓库的 exactOptionalPropertyTypes 不完全兼容；
// 用窄 adapter 保留严格类型，同时避免用断言绕过 Transport contract。
class McpStreamableHttpNodeTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;

  constructor(private readonly transport: StreamableHTTPServerTransport) {}

  applyCallbacks(): void {
    this.transport.onclose = this.onclose;
    this.transport.onerror = this.onerror;
    this.transport.onmessage =
      this.onmessage === undefined
        ? undefined
        : (message, extra) => {
            this.onmessage?.(message, extra);
          };
  }

  readSessionId(): string | undefined {
    return this.transport.sessionId;
  }

  async start(): Promise<void> {
    this.applyCallbacks();
    await this.transport.start();
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    this.applyCallbacks();
    await this.transport.send(message, options);
  }

  async close(): Promise<void> {
    await this.transport.close();
  }

  async handleRequest(request: IncomingMessage, response: ServerResponse, parsedBody: unknown): Promise<void> {
    this.applyCallbacks();
    await this.transport.handleRequest(request, response, parsedBody);
  }
}
