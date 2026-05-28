export const MCP_TRANSPORT_STDIO = "stdio";
export const MCP_TRANSPORT_HTTP = "http";
export const DEFAULT_MCP_HTTP_PORT = 7474;
export const DEFAULT_MCP_HTTP_BIND = "127.0.0.1";

export type McpTransport = typeof MCP_TRANSPORT_STDIO | typeof MCP_TRANSPORT_HTTP;
export type McpHttpBindAddress = "127.0.0.1" | "localhost" | "::1" | "0.0.0.0";

export interface McpStdioCliOptions {
  readonly transport: typeof MCP_TRANSPORT_STDIO;
}

export interface McpHttpCliOptions {
  readonly transport: typeof MCP_TRANSPORT_HTTP;
  readonly port: number;
  readonly bind: McpHttpBindAddress;
}

export type McpCliOptions = McpStdioCliOptions | McpHttpCliOptions;
