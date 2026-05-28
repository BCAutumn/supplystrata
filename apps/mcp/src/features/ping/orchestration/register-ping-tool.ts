import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { PING_TOOL_NAME } from "../definitions/ping-tool.js";
import { createPingToolResult } from "../functions/ping.js";

export function registerPingTool(server: McpServer): void {
  server.registerTool(
    PING_TOOL_NAME,
    {
      title: "Ping",
      description: "Verifies that the SupplyStrata MCP server is reachable.",
      inputSchema: {},
      outputSchema: {
        ok: z.literal(true),
        message: z.literal("pong")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      const result = createPingToolResult();

      return {
        content: [
          {
            type: "text",
            text: result.message
          }
        ],
        structuredContent: result
      };
    }
  );
}
