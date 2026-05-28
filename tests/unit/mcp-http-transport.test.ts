import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

import type { ApiOperationHandlerInput, ApiOperationHandlers } from "@supplystrata/api-orchestration";
import {
  createMcpHttpNodeServer,
  DEFAULT_MCP_HTTP_BIND,
  DEFAULT_MCP_HTTP_PORT,
  MCP_HTTP_ENDPOINT_PATH,
  MCP_TRANSPORT_HTTP,
  MCP_TRANSPORT_STDIO,
  parseMcpCliOptions,
  PING_TOOL_NAME
} from "@supplystrata/mcp";

const FIXED_NOW = "2026-05-28T00:00:00.000Z";

describe("mcp http transport", () => {
  it("parses stdio and http CLI options without accepting transport-specific leakage", () => {
    expect(parseMcpCliOptions([])).toEqual({ transport: MCP_TRANSPORT_STDIO });
    expect(parseMcpCliOptions(["--transport=http"])).toEqual({
      transport: MCP_TRANSPORT_HTTP,
      port: DEFAULT_MCP_HTTP_PORT,
      bind: DEFAULT_MCP_HTTP_BIND
    });
    expect(parseMcpCliOptions(["--transport=http", "--port=7474", "--bind=0.0.0.0"])).toEqual({
      transport: MCP_TRANSPORT_HTTP,
      port: 7474,
      bind: "0.0.0.0"
    });
    expect(() => parseMcpCliOptions(["--transport=stdio", "--port=7474"])).toThrow("--port is only supported with --transport=http.");
    expect(() => parseMcpCliOptions(["--transport=http", "--port=0"])).toThrow("Invalid MCP HTTP port: 0");
  });

  it("serves the MCP streamable HTTP endpoint and routes read calls through api-orchestration", async () => {
    const { endpointPath, nodeServer, close } = await createMcpHttpNodeServer({
      mcp: {
        handlers: fakeReadHandlers(),
        now: () => FIXED_NOW
      }
    });
    const port = await listenOnLocalhost(nodeServer);
    const transport = new McpStreamableHttpClientTransport(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}${endpointPath}`)));
    const client = new Client({
      name: "supplystrata-mcp-http-test-client",
      version: "0.1.0"
    });

    try {
      await client.connect(transport);

      const pingResult = await client.callTool({
        name: PING_TOOL_NAME,
        arguments: {}
      });
      expect(pingResult.structuredContent).toEqual({
        ok: true,
        message: "pong"
      });

      const readResult = await client.callTool({
        name: "resolve_company",
        arguments: {
          query: "NVIDIA"
        }
      });
      expect(readResult.structuredContent).toMatchObject({
        data: {
          operation_id: "getCompanyCard",
          path_params: {
            id: "NVIDIA"
          }
        },
        meta: {
          generated_at: FIXED_NOW
        }
      });
    } finally {
      await client.close();
      await close();
    }
  });

  it("keeps non-MCP paths outside the protocol endpoint", async () => {
    const { nodeServer, close } = await createMcpHttpNodeServer();
    const port = await listenOnLocalhost(nodeServer);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/not-mcp`);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not Found");

      const optionsResponse = await fetch(`http://127.0.0.1:${port}${MCP_HTTP_ENDPOINT_PATH}`, {
        method: "OPTIONS"
      });
      expect(optionsResponse.status).toBe(204);
      expect(optionsResponse.headers.get("allow")).toBe("GET, POST, DELETE, OPTIONS");
    } finally {
      await close();
    }
  });
});

function listenOnLocalhost(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(readPort(server.address()));
    });
  });
}

function readPort(address: AddressInfo | string | null): number {
  if (address === null || typeof address === "string") throw new Error("Expected MCP HTTP test server to listen on a TCP port.");
  return address.port;
}

function fakeReadHandlers(): ApiOperationHandlers {
  return {
    getCompanyCard: async (input) => fakeReadData(input)
  };
}

function fakeReadData(input: ApiOperationHandlerInput): Record<string, unknown> {
  const query: Record<string, string> = {};
  input.query.forEach((value, key) => {
    query[key] = value;
  });
  return {
    operation_id: input.route.operation_id,
    path_params: input.path_params,
    query,
    observed_at: input.now
  };
}

// 测试侧同样不用类型断言穿透 SDK exactOptionalPropertyTypes 差异。
class McpStreamableHttpClientTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(private readonly transport: StreamableHTTPClientTransport) {}

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

  setProtocolVersion(version: string): void {
    this.transport.setProtocolVersion(version);
  }

  private applyCallbacks(): void {
    if (this.onclose === undefined) delete this.transport.onclose;
    else this.transport.onclose = this.onclose;

    if (this.onerror === undefined) delete this.transport.onerror;
    else this.transport.onerror = this.onerror;

    if (this.onmessage === undefined) delete this.transport.onmessage;
    else this.transport.onmessage = this.onmessage;
  }
}
