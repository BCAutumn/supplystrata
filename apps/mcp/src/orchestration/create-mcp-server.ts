import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { SUPPLYSTRATA_MCP_SERVER_NAME, SUPPLYSTRATA_MCP_SERVER_VERSION, type SupplyStrataMcpServer } from "../definitions/mcp-server.js";
import { registerPingTool } from "../features/ping/orchestration/register-ping-tool.js";

export function createSupplyStrataMcpServer(): SupplyStrataMcpServer {
  const server = new McpServer({
    name: SUPPLYSTRATA_MCP_SERVER_NAME,
    version: SUPPLYSTRATA_MCP_SERVER_VERSION
  });

  registerPingTool(server);

  return { server };
}
