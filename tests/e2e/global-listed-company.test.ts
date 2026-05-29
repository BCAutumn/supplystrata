import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importDevFixturesFromCsv, migrate } from "@supplystrata/db/admin";
import { canConnectToIntegrationDatabase, createIntegrationDatabaseStore } from "../integration/helpers.js";

const hasDatabase = await canConnectToIntegrationDatabase();
const describeDb = hasDatabase ? describe.sequential : describe.skip;

interface GlobalCompanyCase {
  query: string;
  expectedDirectoryAdapter?: "dart-kr" | "twse-mops";
}

interface ResearchRunSnapshot {
  run_id: string;
  session_id: string;
  company_entity_id: string | null;
  company_query: string;
  status: string;
  profile_layer: string | null;
  profile_derivation_status: string | null;
  source_check_target_ids: string[];
}

const MCP_TIMEOUT_MS = 120_000;
const FIXTURE_NAMESPACE_PREFIX = "c7-global-e2e";
const DB_COMPANY_CASES: readonly GlobalCompanyCase[] = [
  { query: "Samsung Electronics", expectedDirectoryAdapter: "dart-kr" },
  { query: "TSMC", expectedDirectoryAdapter: "twse-mops" },
  { query: "LVMH" },
  { query: "AstraZeneca" }
];

describeDb("global listed company mcp db e2e", () => {
  const pool = createIntegrationDatabaseStore();
  const stderrChunks: string[] = [];
  const transport = new StdioClientTransport({
    command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    args: ["--silent", "tsx", "apps/mcp/src/main.ts", "--transport=stdio", "--runtime=db"],
    cwd: process.cwd(),
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptionsWithDevelopmentCondition(process.env["NODE_OPTIONS"])
    }
  });
  const client = new Client({
    name: "supplystrata-global-listed-company-e2e-client",
    version: "0.1.0"
  });

  transport.stderr?.on("data", (chunk) => {
    stderrChunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
  });

  beforeAll(async () => {
    await migrate(pool);
    await importDevFixturesFromCsv(pool, process.cwd());
    await client.connect(transport);
  }, MCP_TIMEOUT_MS);

  afterAll(async () => {
    await closeQuietly(client, transport);
    await pool.close();
  }, MCP_TIMEOUT_MS);

  it(
    "covers Samsung, TSMC, LVMH, and AstraZeneca through MCP read/write contract with db runtime",
    async () => {
      for (const companyCase of DB_COMPANY_CASES) {
        const resolveResult = await callStructuredTool(client, "resolve_company", { query: companyCase.query });
        assertPath(resolveResult, ["schema_version"], "1.0.0");
        assertPath(resolveResult, ["contract_version"], "0.1.0");

        const pendingResearch = await callStructuredTool(client, "start_research_session", {
          company: companyCase.query,
          depth: 2,
          reviewer: "tests/e2e/global-listed-company",
          source_target_namespace: `${FIXTURE_NAMESPACE_PREFIX}-${normalizeNamespace(companyCase.query)}-${randomUUID().slice(0, 8)}`
        });
        assertPath(pendingResearch, ["status"], "requires_confirmation");

        const confirmResearch = await callStructuredTool(client, "confirm_research_session", {
          pending_id: readStringPath(pendingResearch, ["pending_id"]),
          confirmation_token: readStringPath(pendingResearch, ["confirmation_token"])
        });
        assertPath(confirmResearch, ["status"], "executed");

        const createdRun = readResearchRunSnapshot(confirmResearch, "data");
        expect(createdRun.session_id).toBe(createdRun.run_id);
        expect(createdRun.company_query).toBe(companyCase.query);

        if (companyCase.expectedDirectoryAdapter === undefined) {
          expect(createdRun.source_check_target_ids).toEqual([]);
          expect(createdRun.status).toBe("cannot_conclude");
          expect(createdRun.profile_layer).toBeNull();
        } else {
          expect(["anchor", "derived"]).toContain(createdRun.profile_layer);
          if (createdRun.profile_layer === "derived") expect(createdRun.profile_derivation_status).toBe("generic");
          expect(createdRun.source_check_target_ids.some((targetId) => targetId.includes(`:${companyCase.expectedDirectoryAdapter}:`))).toBe(true);
          expect(["queued_source_checks", "in_progress", "failed", "succeeded"]).toContain(createdRun.status);
        }

        if (createdRun.source_check_target_ids.length > 0) {
          const pendingSourceCheck = await callStructuredTool(client, "run_source_check", {
            check_target_ids: createdRun.source_check_target_ids,
            reviewer: "tests/e2e/global-listed-company"
          });
          assertPath(pendingSourceCheck, ["status"], "requires_confirmation");

          const executeSourceCheck = await callStructuredTool(client, "run_source_check", {
            pending_id: readStringPath(pendingSourceCheck, ["pending_id"]),
            confirmation_token: readStringPath(pendingSourceCheck, ["confirmation_token"])
          });
          assertPath(executeSourceCheck, ["status"], "executed");
          assertPath(executeSourceCheck, ["data", "schema_version"], "1.0.0");
        }

        const pollResult = await callStructuredTool(client, "poll_research_run", { run_id: createdRun.run_id });
        assertPath(pollResult, ["schema_version"], "1.0.0");
        const polledRun = readResearchRunSnapshot(pollResult);
        expect(polledRun.run_id).toBe(createdRun.run_id);
        expect(polledRun.session_id).toBe(createdRun.session_id);
        expect(polledRun.source_check_target_ids).toEqual(createdRun.source_check_target_ids);

        if (createdRun.company_entity_id !== null) {
          const traverseResult = await callStructuredTool(client, "traverse_chain", {
            scope: `company:${createdRun.company_entity_id}`,
            depth: 2
          });
          assertPath(traverseResult, ["schema_version"], "1.0.0");
        }
      }
    },
    MCP_TIMEOUT_MS
  );
});

async function callStructuredTool(client: Client, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError === true) throw new Error(`${name} returned MCP error: ${toolErrorText(result.content)}`);
  if (!isRecord(result.structuredContent)) throw new Error(`${name} did not return structuredContent.`);
  return result.structuredContent;
}

function readResearchRunSnapshot(content: Record<string, unknown>, rootKey?: "data"): ResearchRunSnapshot {
  const root = rootKey === undefined ? content : readRecordPath(content, [rootKey]);
  const envelopeData = readRecordPath(root, ["data"]);
  const run = readRecordPath(envelopeData, ["run"]);
  return {
    run_id: readStringPath(run, ["run_id"]),
    session_id: readStringPath(run, ["session_id"]),
    company_entity_id: readNullableStringPath(run, ["company_entity_id"]),
    company_query: readStringPath(run, ["company_query"]),
    status: readStringPath(run, ["status"]),
    ...readResearchProfileSnapshot(run),
    source_check_target_ids: readStringArrayPath(run, ["source_check_target_ids"])
  };
}

function readResearchProfileSnapshot(run: Record<string, unknown>): Pick<ResearchRunSnapshot, "profile_layer" | "profile_derivation_status"> {
  const value = readPath(run, ["profile"]);
  if (value === null) return { profile_layer: null, profile_derivation_status: null };
  if (!isRecord(value)) throw new Error("Expected run.profile to be object|null.");
  return {
    profile_layer: readStringPath(value, ["layer"]),
    profile_derivation_status: readNullableStringPath(value, ["derivation_status"])
  };
}

function readRecordPath(root: Record<string, unknown>, path: readonly string[]): Record<string, unknown> {
  const value = readPath(root, path);
  if (!isRecord(value)) throw new Error(`Expected ${path.join(".")} to be an object.`);
  return value;
}

function readNullableStringPath(root: Record<string, unknown>, path: readonly string[]): string | null {
  const value = readPath(root, path);
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`Expected ${path.join(".")} to be string|null.`);
  return value;
}

function readStringPath(root: Record<string, unknown>, path: readonly string[]): string {
  const value = readPath(root, path);
  if (typeof value !== "string" || value.length === 0) throw new Error(`Expected ${path.join(".")} to be a non-empty string.`);
  return value;
}

function readStringArrayPath(root: Record<string, unknown>, path: readonly string[]): string[] {
  const value = readPath(root, path);
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Expected ${path.join(".")} to be a string array.`);
  }
  return value;
}

function readPath(root: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (!isRecord(current) || !(segment in current)) throw new Error(`Missing structuredContent path: ${path.join(".")}`);
    current = current[segment];
  }
  return current;
}

function assertPath(root: Record<string, unknown>, path: readonly string[], expected: unknown): void {
  const value = readPath(root, path);
  if (value !== expected) throw new Error(`Expected ${path.join(".")} to equal ${JSON.stringify(expected)}, got ${JSON.stringify(value)}.`);
}

function toolErrorText(content: unknown): string {
  if (!Array.isArray(content)) return JSON.stringify(content);
  const messages = content
    .filter((item): item is { type: string; text: string } => isRecord(item) && item["type"] === "text" && typeof item["text"] === "string")
    .map((item) => item.text.trim())
    .filter((text) => text.length > 0);
  return messages.length > 0 ? messages.join("\n") : JSON.stringify(content);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNamespace(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

function nodeOptionsWithDevelopmentCondition(current: string | undefined): string {
  const parts = current === undefined || current.trim().length === 0 ? [] : current.split(/\s+/);
  return parts.includes("--conditions=development") ? parts.join(" ") : ["--conditions=development", ...parts].join(" ");
}

async function closeQuietly(client: Client, transport: StdioClientTransport): Promise<void> {
  try {
    await client.close();
  } catch {
    await transport.close();
  }
}
