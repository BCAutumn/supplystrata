import type { ServerResponse } from "node:http";

export function writePlainHttpResponse(response: ServerResponse, statusCode: number, body: string): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(body);
}

export function writeMcpHttpOptionsResponse(response: ServerResponse): void {
  response.statusCode = 204;
  response.setHeader("allow", "GET, POST, DELETE, OPTIONS");
  response.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type, mcp-session-id, last-event-id");
  response.end();
}
