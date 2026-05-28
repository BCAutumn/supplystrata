import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { SupplyStrataMcpServerOptions } from "../../../definitions/mcp-server.js";
import { createSupplyStrataMcpServer } from "../../../orchestration/create-mcp-server.js";

export async function runStdioMcpServer(options: SupplyStrataMcpServerOptions = {}): Promise<void> {
  const { server } = createSupplyStrataMcpServer(options);
  await server.connect(new StdioServerTransport());
}
