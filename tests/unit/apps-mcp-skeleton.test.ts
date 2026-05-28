import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createSupplyStrataMcpServer, PING_TOOL_NAME, SUPPLYSTRATA_MCP_SERVER_NAME, SUPPLYSTRATA_MCP_SERVER_VERSION } from "@supplystrata/mcp";

describe("apps/mcp skeleton", () => {
  it("initializes the server and registers the ping tool", async () => {
    const { server } = createSupplyStrataMcpServer();
    const client = new Client({
      name: "supplystrata-mcp-test-client",
      version: "0.1.0"
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      expect(client.getServerVersion()).toEqual({
        name: SUPPLYSTRATA_MCP_SERVER_NAME,
        version: SUPPLYSTRATA_MCP_SERVER_VERSION
      });

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain(PING_TOOL_NAME);

      const result = await client.callTool({
        name: PING_TOOL_NAME,
        arguments: {}
      });

      if (!("content" in result)) {
        throw new Error("Expected ping to return a standard MCP tool result.");
      }

      expect(result.content).toEqual([
        {
          type: "text",
          text: "pong"
        }
      ]);
      expect(result.structuredContent).toEqual({
        ok: true,
        message: "pong"
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
