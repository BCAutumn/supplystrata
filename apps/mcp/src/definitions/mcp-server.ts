import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const SUPPLYSTRATA_MCP_SERVER_NAME = "supplystrata";
export const SUPPLYSTRATA_MCP_SERVER_VERSION = "0.1.0";

export interface SupplyStrataMcpServer {
  readonly server: McpServer;
}
