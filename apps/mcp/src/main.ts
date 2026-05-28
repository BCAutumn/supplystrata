#!/usr/bin/env node
import { MCP_TRANSPORT_HTTP, MCP_TRANSPORT_STDIO, parseMcpCliOptions, runHttpMcpServer, runStdioMcpServer } from "./index.js";

try {
  const options = parseMcpCliOptions(process.argv.slice(2));

  switch (options.transport) {
    case MCP_TRANSPORT_STDIO:
      await runStdioMcpServer();
      break;
    case MCP_TRANSPORT_HTTP:
      await runHttpMcpServer(options);
      break;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown MCP server startup error.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
