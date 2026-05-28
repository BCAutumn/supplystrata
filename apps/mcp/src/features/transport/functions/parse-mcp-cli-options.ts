import {
  DEFAULT_MCP_HTTP_BIND,
  DEFAULT_MCP_HTTP_PORT,
  MCP_TRANSPORT_HTTP,
  MCP_TRANSPORT_STDIO,
  type McpCliOptions,
  type McpHttpBindAddress,
  type McpTransport
} from "../definitions/mcp-transport.js";

const TRANSPORT_PREFIX = "--transport=";
const PORT_PREFIX = "--port=";
const BIND_PREFIX = "--bind=";

export function parseMcpCliOptions(args: readonly string[]): McpCliOptions {
  const parsed = parseRawOptions(args);
  const transport = parseTransport(parsed.transport);

  if (transport === MCP_TRANSPORT_STDIO) {
    if (parsed.port !== undefined) throw new Error("--port is only supported with --transport=http.");
    if (parsed.bind !== undefined) throw new Error("--bind is only supported with --transport=http.");
    return { transport: MCP_TRANSPORT_STDIO };
  }

  return {
    transport: MCP_TRANSPORT_HTTP,
    port: parsePort(parsed.port ?? String(DEFAULT_MCP_HTTP_PORT)),
    bind: parseBind(parsed.bind ?? DEFAULT_MCP_HTTP_BIND)
  };
}

function parseRawOptions(args: readonly string[]): { transport?: string; port?: string; bind?: string } {
  const output: { transport?: string; port?: string; bind?: string } = {};
  for (const arg of args) {
    if (arg.startsWith(TRANSPORT_PREFIX)) output.transport = arg.slice(TRANSPORT_PREFIX.length);
    else if (arg.startsWith(PORT_PREFIX)) output.port = arg.slice(PORT_PREFIX.length);
    else if (arg.startsWith(BIND_PREFIX)) output.bind = arg.slice(BIND_PREFIX.length);
    else throw new Error(`Unsupported MCP CLI argument: ${arg}`);
  }
  return output;
}

function parseTransport(value: string | undefined): McpTransport {
  if (value === undefined || value === MCP_TRANSPORT_STDIO) return MCP_TRANSPORT_STDIO;
  if (value === MCP_TRANSPORT_HTTP) return MCP_TRANSPORT_HTTP;
  throw new Error(`Unsupported MCP transport "${value}". Supported transports: ${MCP_TRANSPORT_STDIO}, ${MCP_TRANSPORT_HTTP}.`);
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid MCP HTTP port: ${value}`);
  return port;
}

function parseBind(value: string): McpHttpBindAddress {
  if (value === "127.0.0.1" || value === "localhost" || value === "::1" || value === "0.0.0.0") return value;
  throw new Error(`Unsupported MCP HTTP bind address: ${value}`);
}
