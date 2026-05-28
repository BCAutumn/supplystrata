import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiOperationHandlers } from "@supplystrata/api-orchestration";
import type { McpWriteExecutors, PendingWriteStore } from "../features/write-surface/definitions/write-surface.js";

export const SUPPLYSTRATA_MCP_SERVER_NAME = "supplystrata";
export const SUPPLYSTRATA_MCP_SERVER_VERSION = "0.1.0";

export interface SupplyStrataMcpServer {
  readonly server: McpServer;
}

export interface SupplyStrataMcpServerOptions {
  readonly handlers?: ApiOperationHandlers;
  readonly pendingWrites?: PendingWriteStore;
  readonly now?: () => string;
  readonly writeExecutors?: Partial<McpWriteExecutors>;
}
