import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  SUPPLYSTRATA_MCP_SERVER_NAME,
  SUPPLYSTRATA_MCP_SERVER_VERSION,
  type SupplyStrataMcpServer,
  type SupplyStrataMcpServerOptions
} from "../definitions/mcp-server.js";
import { registerPingTool } from "../features/ping/orchestration/register-ping-tool.js";
import { registerReadResources } from "../features/read-surface/orchestration/register-read-resources.js";
import { registerReadTools } from "../features/read-surface/orchestration/register-read-tools.js";
import { createApiBackedWriteExecutors } from "../features/write-surface/functions/api-backed-write-executors.js";
import { createInMemoryPendingWriteStore } from "../features/write-surface/functions/pending-write-store.js";
import { registerWriteTools } from "../features/write-surface/orchestration/register-write-tools.js";

export function createSupplyStrataMcpServer(options: SupplyStrataMcpServerOptions = {}): SupplyStrataMcpServer {
  const server = new McpServer({
    name: SUPPLYSTRATA_MCP_SERVER_NAME,
    version: SUPPLYSTRATA_MCP_SERVER_VERSION
  });
  const handlers = options.handlers ?? {};
  const runtime = {
    handlers,
    now: options.now ?? (() => new Date().toISOString())
  };
  const writeRuntime = {
    ...runtime,
    pendingWrites: options.pendingWrites ?? createInMemoryPendingWriteStore(),
    writeExecutors: {
      ...createApiBackedWriteExecutors(handlers),
      ...options.writeExecutors
    }
  };

  registerPingTool(server);
  registerReadResources(server, runtime);
  registerReadTools(server, runtime);
  registerWriteTools(server, writeRuntime);

  return { server };
}
