import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { SupplyStrataMcpClient } from "@supplystrata/agent";

export type AgentCliMcpTransport = "stdio" | "http";
export type AgentCliMcpRuntime = "fixture" | "db";

export interface AgentCliMcpClientOptions {
  readonly transport: AgentCliMcpTransport;
  readonly runtime: AgentCliMcpRuntime;
  readonly httpUrl?: string;
  readonly command?: string;
  readonly args?: readonly string[];
}

export interface ConnectedAgentMcpClient {
  readonly client: SupplyStrataMcpClient;
  readResource(uri: string): Promise<unknown>;
  close(): Promise<void>;
}

export async function connectAgentMcpClient(options: AgentCliMcpClientOptions): Promise<ConnectedAgentMcpClient> {
  const client = new Client({ name: "supplystrata-agent-cli", version: "0.1.0" });
  const transport = mcpTransport(options);
  await client.connect(transport);
  return {
    client: {
      async callTool(name, input) {
        const result = await client.callTool({ name, arguments: input });
        if (result.isError === true) throw new Error(`${name} returned MCP error: ${toolErrorText(result.content)}`);
        if (!isRecord(result.structuredContent)) throw new Error(`${name} did not return structuredContent.`);
        return result.structuredContent;
      }
    },
    async readResource(uri) {
      return client.readResource({ uri });
    },
    async close() {
      await closeQuietly(client, transport);
    }
  };
}

function mcpTransport(options: AgentCliMcpClientOptions): Transport {
  if (options.transport === "http") return new OptionalCallbackHttpTransport(new StreamableHTTPClientTransport(new URL(httpUrl(options))));
  return new StdioClientTransport({
    command: options.command ?? defaultMcpCommand(),
    args: options.args === undefined ? defaultMcpArgs(options.runtime) : [...options.args],
    cwd: process.cwd(),
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptionsWithDevelopmentCondition(process.env["NODE_OPTIONS"])
    }
  });
}

function httpUrl(options: AgentCliMcpClientOptions): string {
  if (options.httpUrl !== undefined) return options.httpUrl;
  return "http://127.0.0.1:3737/mcp";
}

function defaultMcpCommand(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function defaultMcpArgs(runtime: AgentCliMcpRuntime): string[] {
  return ["--silent", "tsx", "apps/mcp/src/main.ts", "--transport=stdio", `--runtime=${runtime}`];
}

function nodeOptionsWithDevelopmentCondition(current: string | undefined): string {
  const parts = current === undefined || current.trim().length === 0 ? [] : current.split(/\s+/);
  return parts.includes("--conditions=development") ? parts.join(" ") : ["--conditions=development", ...parts].join(" ");
}

function toolErrorText(content: unknown): string {
  if (!Array.isArray(content)) return JSON.stringify(content);
  const messages = content
    .filter((item): item is { type: string; text: string } => isRecord(item) && item["type"] === "text" && typeof item["text"] === "string")
    .map((item) => item.text.trim())
    .filter((text) => text.length > 0);
  return messages.length > 0 ? messages.join("\n") : JSON.stringify(content);
}

async function closeQuietly(client: Client, transport: Transport): Promise<void> {
  try {
    await client.close();
  } catch {
    await transport.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class OptionalCallbackHttpTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(private readonly transport: StreamableHTTPClientTransport) {}

  async start(): Promise<void> {
    this.applyCallbacks();
    await this.transport.start();
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    this.applyCallbacks();
    await this.transport.send(message, options);
  }

  async close(): Promise<void> {
    await this.transport.close();
  }

  setProtocolVersion(version: string): void {
    this.transport.setProtocolVersion(version);
  }

  private applyCallbacks(): void {
    if (this.onclose === undefined) delete this.transport.onclose;
    else this.transport.onclose = this.onclose;

    if (this.onerror === undefined) delete this.transport.onerror;
    else this.transport.onerror = this.onerror;

    if (this.onmessage === undefined) delete this.transport.onmessage;
    else this.transport.onmessage = this.onmessage;
  }
}
