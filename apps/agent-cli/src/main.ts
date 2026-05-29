#!/usr/bin/env node
import { Command } from "commander";
import { runReferenceAgent } from "@supplystrata/agent";
import type { AiAnalysisProvider } from "@supplystrata/llm-helpers";
import { connectAgentMcpClient, type AgentCliMcpRuntime, type AgentCliMcpTransport } from "./mcp-client.js";
import { agentLlmOptions } from "./provider.js";

interface AgentCliOptions {
  readonly company: string;
  readonly provider: AiAnalysisProvider;
  readonly model?: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly mcpTransport: AgentCliMcpTransport;
  readonly mcpRuntime: AgentCliMcpRuntime;
  readonly mcpUrl?: string;
  readonly depth: number;
}

export async function runAgentCli(
  argv: readonly string[],
  io: { stdout: Pick<NodeJS.WriteStream, "write">; stderr: Pick<NodeJS.WriteStream, "write"> }
): Promise<number> {
  const program = new Command();
  program
    .name("supplystrata-agent")
    .description("Reference SupplyStrata MCP-native reporting agent")
    .requiredOption("--company <query>", "Company query, ticker, alias, or entity id.")
    .option("--provider <provider>", "LLM provider: none, openai, deepseek, custom.", "none")
    .option("--model <model>", "LLM model name. Defaults come from llm-helpers provider config.")
    .option("--api-key <key>", "LLM API key. Prefer environment variables for normal use.")
    .option("--base-url <url>", "OpenAI-compatible base URL for custom-compatible providers.")
    .option("--mcp-transport <transport>", "MCP transport: stdio or http.", "stdio")
    .option("--mcp-runtime <runtime>", "MCP runtime used when spawning stdio MCP: db or fixture.", "db")
    .option("--mcp-url <url>", "MCP HTTP endpoint URL. Used only with --mcp-transport http.")
    .option("--depth <n>", "Traversal depth.", parsePositiveInteger, 2)
    .showHelpAfterError();

  try {
    await program.parseAsync([...argv], { from: "user" });
    const options = cliOptions(program.opts<Record<string, unknown>>());
    const generatedAt = new Date().toISOString();
    const mcp = await connectAgentMcpClient({
      transport: options.mcpTransport,
      runtime: options.mcpRuntime,
      ...(options.mcpUrl === undefined ? {} : { httpUrl: options.mcpUrl })
    });
    try {
      const report = await runReferenceAgent(
        { company: options.company, depth: options.depth },
        mcp.client,
        agentLlmOptions({
          provider: options.provider,
          generatedAt,
          ...(options.model === undefined ? {} : { model: options.model }),
          ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
          ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl })
        })
      );
      io.stdout.write(`${report.markdown}\n`);
      return report.status === "completed" ? 0 : 2;
    } finally {
      await mcp.close();
    }
  } catch (error) {
    io.stderr.write(`${formatCliError(error)}\n`);
    return 1;
  }
}

function cliOptions(raw: Record<string, unknown>): AgentCliOptions {
  return {
    company: requiredString(raw["company"], "company"),
    provider: parseProvider(optionalString(raw["provider"]) ?? "none"),
    ...(raw["model"] === undefined ? {} : { model: requiredString(raw["model"], "model") }),
    ...(raw["apiKey"] === undefined ? {} : { apiKey: requiredString(raw["apiKey"], "api-key") }),
    ...(raw["baseUrl"] === undefined ? {} : { baseUrl: requiredString(raw["baseUrl"], "base-url") }),
    mcpTransport: parseMcpTransport(optionalString(raw["mcpTransport"]) ?? "stdio"),
    mcpRuntime: parseMcpRuntime(optionalString(raw["mcpRuntime"]) ?? "db"),
    ...(raw["mcpUrl"] === undefined ? {} : { mcpUrl: requiredString(raw["mcpUrl"], "mcp-url") }),
    depth: typeof raw["depth"] === "number" ? raw["depth"] : 2
  };
}

function parseProvider(value: string): AiAnalysisProvider {
  if (value === "none" || value === "openai" || value === "deepseek" || value === "custom") return value;
  if (value === "anthropic") throw new Error("Provider anthropic is not supported by the OpenAI-compatible reference agent CLI yet.");
  throw new Error(`Unsupported provider: ${value}`);
}

function parseMcpTransport(value: string): AgentCliMcpTransport {
  if (value === "stdio" || value === "http") return value;
  throw new Error(`Unsupported MCP transport: ${value}`);
}

function parseMcpRuntime(value: string): AgentCliMcpRuntime {
  if (value === "fixture" || value === "db") return value;
  throw new Error(`Unsupported MCP runtime: ${value}`);
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("depth must be a positive integer");
  return parsed;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required.`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function formatCliError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown supplystrata-agent error.";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await runAgentCli(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr });
  process.exitCode = code;
}
