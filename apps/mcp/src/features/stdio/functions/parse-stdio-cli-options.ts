import { MCP_TRANSPORT_STDIO, type StdioCliOptions } from "../definitions/stdio-cli.js";

const TRANSPORT_PREFIX = "--transport=";

export function parseStdioCliOptions(args: readonly string[]): StdioCliOptions {
  let transport: string | undefined;

  for (const arg of args) {
    if (arg.startsWith(TRANSPORT_PREFIX)) {
      transport = arg.slice(TRANSPORT_PREFIX.length);
    }
  }

  if (transport === undefined || transport === MCP_TRANSPORT_STDIO) {
    return { transport: MCP_TRANSPORT_STDIO };
  }

  throw new Error(`Unsupported MCP transport "${transport}". Supported transport: ${MCP_TRANSPORT_STDIO}.`);
}
