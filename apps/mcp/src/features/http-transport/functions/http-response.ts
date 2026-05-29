import type { ServerResponse } from "node:http";

const LOCAL_BROWSER_ORIGINS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function writePlainHttpResponse(response: ServerResponse, statusCode: number, body: string): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(body);
}

export function applyMcpHttpCorsHeaders(response: ServerResponse, origin: string | undefined): void {
  if (origin === undefined) return;
  const parsed = parseOrigin(origin);
  if (parsed === null || !LOCAL_BROWSER_ORIGINS.has(parsed.hostname)) return;
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-expose-headers", "mcp-session-id");
  response.setHeader("vary", "Origin");
}

export function writeMcpHttpOptionsResponse(response: ServerResponse, origin: string | undefined): void {
  applyMcpHttpCorsHeaders(response, origin);
  response.statusCode = 204;
  response.setHeader("allow", "GET, POST, DELETE, OPTIONS");
  response.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type, accept, mcp-session-id, last-event-id");
  response.end();
}

function parseOrigin(origin: string): URL | null {
  try {
    return new URL(origin);
  } catch {
    return null;
  }
}
