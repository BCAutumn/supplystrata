#!/usr/bin/env node
import { Command } from "commander";
import type { ScbomDocument } from "@scbom/spec";
import { runReferenceAgent } from "@supplystrata/agent";
import type { AiAnalysisProvider } from "@supplystrata/llm-helpers";
import { connectAgentMcpClient, type AgentCliMcpRuntime, type AgentCliMcpTransport } from "./mcp-client.js";
import { agentLlmOptions } from "./provider.js";
import { writeAgentHtmlArtifact } from "./html-artifact.js";

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
  readonly htmlArtifact?: string;
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
    .option("--html-artifact <path>", "Write a self-contained SCBOM HTML artifact.")
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
      if (options.htmlArtifact !== undefined) {
        await writeAgentHtmlArtifact(options.htmlArtifact, {
          title: `SupplyStrata Agent Report: ${options.company}`,
          markdown: report.markdown,
          scbomDocument: await readScbomArtifactDocument(options.company, mcp)
        });
      }
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
    depth: typeof raw["depth"] === "number" ? raw["depth"] : 2,
    ...(raw["htmlArtifact"] === undefined ? {} : { htmlArtifact: requiredString(raw["htmlArtifact"], "html-artifact") })
  };
}

async function readScbomArtifactDocument(company: string, mcp: Awaited<ReturnType<typeof connectAgentMcpClient>>): Promise<ScbomDocument> {
  const resolved = await mcp.client.callTool("resolve_company", { query: company });
  const data = readRecordPath(resolved, ["data"]);
  if (data["status"] !== "resolved") throw new Error("Cannot write SCBOM artifact because company identity could not be resolved.");
  const companyId = readOptionalStringPath(data, ["card", "entity", "entity_id"]);
  if (companyId === null) throw new Error("Cannot write SCBOM artifact because company identity could not be resolved.");
  const resource = await mcp.readResource(`supplystrata://scbom/company/${companyId}`);
  const document = scbomDocumentFromResource(resource);
  if (document === null) throw new Error("MCP SCBOM resource did not return a valid document for HTML artifact.");
  return document;
}

function readRecordPath(root: Record<string, unknown>, path: readonly string[]): Record<string, unknown> {
  const value = readPath(root, path);
  if (!isRecord(value)) throw new Error(`Expected ${path.join(".")} to be an object.`);
  return value;
}

function readOptionalStringPath(root: Record<string, unknown>, path: readonly string[]): string | null {
  const value = readOptionalPath(root, path);
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`Expected ${path.join(".")} to be a string.`);
  return value;
}

function readPath(root: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (!isRecord(current) || !(segment in current)) throw new Error(`Missing ${path.join(".")}.`);
    current = current[segment];
  }
  return current;
}

function readOptionalPath(root: Record<string, unknown>, path: readonly string[]): unknown | null {
  let current: unknown = root;
  for (const segment of path) {
    if (!isRecord(current) || !(segment in current)) return null;
    current = current[segment];
  }
  return current;
}

function scbomDocumentFromResource(resource: unknown): ScbomDocument | null {
  if (!isRecord(resource)) return null;
  const contents = resource["contents"];
  if (!Array.isArray(contents)) return null;
  for (const item of contents) {
    if (isRecord(item) && typeof item["text"] === "string") {
      const parsed: unknown = JSON.parse(item["text"]);
      if (isScbomDocument(parsed)) return parsed;
    }
  }
  return null;
}

function isScbomDocument(value: unknown): value is ScbomDocument {
  return isRecord(value) && value["schema_version"] === "0.0.1" && typeof value["document_id"] === "string" && Array.isArray(value["objects"]);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatCliError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown supplystrata-agent error.";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await runAgentCli(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr });
  process.exitCode = code;
}
