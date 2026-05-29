import type { ScbomDocument } from "@scbom/spec";

const DEFAULT_MCP_ENDPOINT = "http://127.0.0.1:7474/mcp";
const MCP_PROTOCOL_VERSION = "2025-06-18";

export interface ScbomMcpResourceTransport {
  readResource(uri: string): Promise<unknown>;
}

export interface ReadScbomCompanyResourceInput {
  readonly companyId: string;
  readonly transport?: ScbomMcpResourceTransport;
}

export interface StreamableHttpScbomResourceTransportOptions {
  readonly endpoint?: string;
  readonly allowRemoteEndpoint?: boolean;
  readonly fetch?: FetchLike;
}

export type FetchLike = (input: string, init: FetchInitLike) => Promise<FetchResponseLike>;

export interface FetchInitLike {
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: {
    get(name: string): string | null;
  };
  text(): Promise<string>;
}

export class StreamableHttpScbomResourceTransport implements ScbomMcpResourceTransport {
  private readonly endpoint: string;
  private readonly fetchImpl: FetchLike;
  private sessionId: string | undefined = undefined;
  private nextId = 1;

  constructor(options: StreamableHttpScbomResourceTransportOptions = {}) {
    this.endpoint = options.endpoint ?? DEFAULT_MCP_ENDPOINT;
    assertLocalEndpoint(this.endpoint, options.allowRemoteEndpoint === true);
    this.fetchImpl = options.fetch ?? defaultFetch;
  }

  async readResource(uri: string): Promise<unknown> {
    await this.ensureInitialized();
    const response = await this.postJsonRpc("resources/read", { uri });
    return readJsonRpcResult(response, "resources/read");
  }

  private async ensureInitialized(): Promise<void> {
    if (this.sessionId !== undefined) return;
    const response = await this.postJsonRpc("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "scbom-web-viewer",
        version: "0.1.0"
      }
    });
    readJsonRpcResult(response, "initialize");
    await this.postJsonRpc("notifications/initialized", {});
  }

  private async postJsonRpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    const headers: Record<string, string> = {
      accept: "application/json, text/event-stream",
      "content-type": "application/json"
    };
    if (this.sessionId !== undefined) headers["mcp-session-id"] = this.sessionId;

    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: this.nextId++,
      method,
      params
    });
    const response = await this.fetchImpl(this.endpoint, { method: "POST", headers, body });
    if (!response.ok) throw new Error(`MCP HTTP ${method} failed with status ${response.status}`);
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId !== null && sessionId.length > 0) this.sessionId = sessionId;
    return parseMcpHttpResponse(await response.text());
  }
}

export async function readScbomCompanyResource(input: ReadScbomCompanyResourceInput): Promise<ScbomDocument> {
  const transport = input.transport ?? new StreamableHttpScbomResourceTransport();
  const resource = await transport.readResource(`supplystrata://scbom/company/${encodeURIComponent(input.companyId)}`);
  const document = scbomDocumentFromResource(resource);
  if (document === undefined) throw new Error(`MCP resource for ${input.companyId} did not return a valid SCBOM document`);
  return document;
}

function parseMcpHttpResponse(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.startsWith("event:") || trimmed.startsWith("data:")) {
    const dataLine = trimmed
      .split(/\r?\n/u)
      .find((line) => line.startsWith("data:"))
      ?.slice("data:".length)
      .trim();
    if (dataLine === undefined || dataLine.length === 0) return undefined;
    const parsed: unknown = JSON.parse(dataLine);
    return parsed;
  }
  const parsed: unknown = JSON.parse(trimmed);
  return parsed;
}

function readJsonRpcResult(value: unknown, method: string): unknown {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`MCP HTTP ${method} returned a non-object response`);
  const error = value["error"];
  if (error !== undefined) throw new Error(`MCP HTTP ${method} returned an error response`);
  return value["result"];
}

function scbomDocumentFromResource(resource: unknown): ScbomDocument | undefined {
  if (!isRecord(resource)) return undefined;
  const contents = resource["contents"];
  if (!isUnknownArray(contents)) return undefined;
  const firstText = firstTextContent(contents);
  if (firstText === undefined) return undefined;
  const parsed: unknown = JSON.parse(firstText);
  return isScbomDocument(parsed) ? parsed : undefined;
}

function isScbomDocument(value: unknown): value is ScbomDocument {
  return isRecord(value) && value["schema_version"] === "0.0.1" && typeof value["document_id"] === "string" && Array.isArray(value["objects"]);
}

function assertLocalEndpoint(endpoint: string, allowRemoteEndpoint: boolean): void {
  const url = new URL(endpoint);
  if (allowRemoteEndpoint) return;
  if (url.protocol !== "http:") throw new Error("SCBOM MCP browser client defaults to local http endpoints; set allowRemoteEndpoint for remote endpoints");
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error("SCBOM MCP browser client requires an explicit allowRemoteEndpoint flag for non-local endpoints");
  }
}

async function defaultFetch(input: string, init: FetchInitLike): Promise<FetchResponseLike> {
  if (globalThis.fetch === undefined) throw new Error("fetch is not available");
  return globalThis.fetch(input, init);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function firstTextContent(contents: readonly unknown[]): string | undefined {
  for (const item of contents) {
    if (isRecord(item) && typeof item["text"] === "string") return item["text"];
  }
  return undefined;
}
