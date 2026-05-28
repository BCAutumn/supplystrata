import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { SupplyStrataLogger } from "@supplystrata/observability";
import { messageFromUnknown, noopLogger } from "@supplystrata/observability";
import type { ApiOperationHandlers } from "../definitions/http-adapter.js";
import { handleApiHttpRequest } from "./http-adapter.js";

export interface ApiNodeServerOptions {
  handlers: ApiOperationHandlers;
  logger?: SupplyStrataLogger;
}

export function createApiNodeServer(options: ApiNodeServerOptions): http.Server {
  const logger = options.logger ?? noopLogger;
  return http.createServer((request, response) => {
    void handleNodeRequest(request, response, options.handlers, logger);
  });
}

async function handleNodeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  handlers: ApiOperationHandlers,
  logger: SupplyStrataLogger
): Promise<void> {
  try {
    const body = await readJsonBody(request);
    const apiResponse = await handleApiHttpRequest(
      {
        method: request.method ?? "GET",
        url: request.url ?? "/",
        ...(body === undefined ? {} : { body })
      },
      handlers
    );
    writeJsonResponse(response, apiResponse.status, apiResponse.headers, apiResponse.body);
  } catch (error) {
    logger.error({ stage: "api-http", err: messageFromUnknown(error) }, "API request failed before route handling");
    writeJsonResponse(response, 500, { "content-type": "application/json; charset=utf-8" }, { error: { status: 500, message: messageFromUnknown(error) } });
  }
}

function writeJsonResponse(response: ServerResponse, status: number, headers: Record<string, string>, body: unknown): void {
  response.writeHead(status, headers);
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.method !== "POST") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of request as AsyncIterable<unknown>) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
    } else if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
    } else {
      throw new Error("Unsupported HTTP request body chunk");
    }
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw.length === 0) return undefined;
  return JSON.parse(raw);
}
