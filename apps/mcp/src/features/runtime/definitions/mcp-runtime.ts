import type { SupplyStrataMcpServerOptions } from "../../../definitions/mcp-server.js";

export const MCP_RUNTIME_FIXTURE = "fixture";
export const MCP_RUNTIME_DB = "db";

export type McpRuntimeMode = typeof MCP_RUNTIME_FIXTURE | typeof MCP_RUNTIME_DB;

export interface McpRuntimeOptions {
  readonly packPath?: string;
}

export interface McpRuntime {
  readonly mode: McpRuntimeMode;
  readonly serverOptions: SupplyStrataMcpServerOptions;
  close(): Promise<void>;
}
