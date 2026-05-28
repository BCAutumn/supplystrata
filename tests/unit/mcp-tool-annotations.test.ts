import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createSupplyStrataMcpServer, MCP_FACT_WRITING_TOOL_NAMES, MCP_WRITE_TOOL_NAMES } from "@supplystrata/mcp";

describe("mcp write tool annotations", () => {
  it("uses only standard MCP risk annotation fields for write tools", async () => {
    const { server } = createSupplyStrataMcpServer();
    const client = new Client({
      name: "supplystrata-mcp-annotation-test-client",
      version: "0.1.0"
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const tools = await client.listTools();
      for (const toolName of MCP_WRITE_TOOL_NAMES) {
        const tool = tools.tools.find((candidate) => candidate.name === toolName);
        expect(tool?.annotations?.readOnlyHint).toBe(false);
      }

      for (const toolName of MCP_FACT_WRITING_TOOL_NAMES) {
        const tool = tools.tools.find((candidate) => candidate.name === toolName);
        expect(tool?.annotations?.destructiveHint).toBe(true);
        expect(tool?.annotations?.openWorldHint).toBe(false);
      }

      expect(tools.tools.find((tool) => tool.name === "start_research_session")?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      });
      expect(tools.tools.find((tool) => tool.name === "run_source_check")?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      });
      expect(tools.tools.find((tool) => tool.name === "confirm_research_session")?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
