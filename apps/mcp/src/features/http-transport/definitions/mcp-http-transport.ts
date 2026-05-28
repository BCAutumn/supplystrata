import type { Server } from "node:http";

import type { SupplyStrataMcpServerOptions } from "../../../definitions/mcp-server.js";

export const MCP_HTTP_ENDPOINT_PATH = "/mcp";

export interface CreateMcpHttpNodeServerOptions {
  readonly mcp?: SupplyStrataMcpServerOptions;
}

export interface McpHttpNodeServer {
  readonly endpointPath: typeof MCP_HTTP_ENDPOINT_PATH;
  readonly nodeServer: Server;
  readonly close: () => Promise<void>;
}
