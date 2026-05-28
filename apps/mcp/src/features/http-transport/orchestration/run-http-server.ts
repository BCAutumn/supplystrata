import type { Server } from "node:http";

import { type McpHttpCliOptions } from "../../transport/definitions/mcp-transport.js";
import { createMcpHttpNodeServer } from "./create-mcp-http-node-server.js";

export async function runHttpMcpServer(options: McpHttpCliOptions): Promise<void> {
  const { endpointPath, nodeServer } = await createMcpHttpNodeServer();
  await listen(nodeServer, options.port, options.bind);
  process.stderr.write(`SupplyStrata MCP HTTP listening on http://${formatBindForUrl(options.bind)}:${options.port}${endpointPath}\n`);
}

function listen(server: Server, port: number, bind: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, bind, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function formatBindForUrl(bind: string): string {
  if (bind === "::1") return "[::1]";
  return bind;
}
