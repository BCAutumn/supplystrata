import {
  DEFAULT_MCP_HTTP_BIND,
  DEFAULT_MCP_HTTP_PORT,
  MCP_TRANSPORT_HTTP,
  MCP_TRANSPORT_STDIO,
  type McpCliOptions,
  type McpHttpBindAddress,
  type McpTransport
} from "../definitions/mcp-transport.js";
import { MCP_RUNTIME_DB, MCP_RUNTIME_FIXTURE, type McpRuntimeMode } from "../../runtime/definitions/mcp-runtime.js";

const TRANSPORT_PREFIX = "--transport=";
const RUNTIME_PREFIX = "--runtime=";
const PORT_PREFIX = "--port=";
const BIND_PREFIX = "--bind=";
const PACK_PREFIX = "--pack=";

export function parseMcpCliOptions(args: readonly string[]): McpCliOptions {
  const parsed = parseRawOptions(args);
  const transport = parseTransport(parsed.transport);
  const runtime = parseRuntime(parsed.runtime);

  if (transport === MCP_TRANSPORT_STDIO) {
    if (parsed.port !== undefined) throw new Error("--port is only supported with --transport=http.");
    if (parsed.bind !== undefined) throw new Error("--bind is only supported with --transport=http.");
    return { transport: MCP_TRANSPORT_STDIO, runtime, ...(parsed.packPath === undefined ? {} : { packPath: parsed.packPath }) };
  }

  return {
    transport: MCP_TRANSPORT_HTTP,
    runtime,
    ...(parsed.packPath === undefined ? {} : { packPath: parsed.packPath }),
    port: parsePort(parsed.port ?? String(DEFAULT_MCP_HTTP_PORT)),
    bind: parseBind(parsed.bind ?? DEFAULT_MCP_HTTP_BIND)
  };
}

function parseRawOptions(args: readonly string[]): { transport?: string; runtime?: string; port?: string; bind?: string; packPath?: string } {
  const output: { transport?: string; runtime?: string; port?: string; bind?: string; packPath?: string } = {};
  for (const arg of args) {
    if (arg.startsWith(TRANSPORT_PREFIX)) output.transport = arg.slice(TRANSPORT_PREFIX.length);
    else if (arg.startsWith(RUNTIME_PREFIX)) output.runtime = arg.slice(RUNTIME_PREFIX.length);
    else if (arg.startsWith(PORT_PREFIX)) output.port = arg.slice(PORT_PREFIX.length);
    else if (arg.startsWith(BIND_PREFIX)) output.bind = arg.slice(BIND_PREFIX.length);
    else if (arg.startsWith(PACK_PREFIX)) output.packPath = arg.slice(PACK_PREFIX.length);
    else throw new Error(`Unsupported MCP CLI argument: ${arg}`);
  }
  return output;
}

function parseTransport(value: string | undefined): McpTransport {
  if (value === undefined || value === MCP_TRANSPORT_STDIO) return MCP_TRANSPORT_STDIO;
  if (value === MCP_TRANSPORT_HTTP) return MCP_TRANSPORT_HTTP;
  throw new Error(`Unsupported MCP transport "${value}". Supported transports: ${MCP_TRANSPORT_STDIO}, ${MCP_TRANSPORT_HTTP}.`);
}

function parseRuntime(value: string | undefined): McpRuntimeMode {
  if (value === undefined || value === MCP_RUNTIME_FIXTURE) return MCP_RUNTIME_FIXTURE;
  if (value === MCP_RUNTIME_DB) return MCP_RUNTIME_DB;
  throw new Error(`Unsupported MCP runtime "${value}". Supported runtimes: ${MCP_RUNTIME_FIXTURE}, ${MCP_RUNTIME_DB}.`);
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
