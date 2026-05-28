import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createSupplyStrataMcpServer } from "../../../orchestration/create-mcp-server.js";

export async function runStdioMcpServer(): Promise<void> {
  const { server } = createSupplyStrataMcpServer();
  await server.connect(new StdioServerTransport());
}
