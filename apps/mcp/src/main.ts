#!/usr/bin/env node
import { createMcpRuntime, MCP_TRANSPORT_HTTP, MCP_TRANSPORT_STDIO, parseMcpCliOptions, runHttpMcpServer, runStdioMcpServer } from "./index.js";

try {
  const options = parseMcpCliOptions(process.argv.slice(2));
  const runtime = createMcpRuntime(options.runtime, options.packPath === undefined ? {} : { packPath: options.packPath });
  registerRuntimeClose(runtime.close);

  switch (options.transport) {
    case MCP_TRANSPORT_STDIO:
      await runStdioMcpServer(runtime.serverOptions);
      break;
    case MCP_TRANSPORT_HTTP:
      await runHttpMcpServer(options, runtime.serverOptions);
      break;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown MCP server startup error.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function registerRuntimeClose(close: () => Promise<void>): void {
  for (const signalName of ["SIGINT", "SIGTERM"] as const) {
    process.once(signalName, () => {
      void close().finally(() => {
        process.exit(0);
      });
    });
  }
}
