#!/usr/bin/env node
import { parseStdioCliOptions, runStdioMcpServer } from "./index.js";

try {
  const options = parseStdioCliOptions(process.argv.slice(2));

  switch (options.transport) {
    case "stdio":
      await runStdioMcpServer();
      break;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown MCP server startup error.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
