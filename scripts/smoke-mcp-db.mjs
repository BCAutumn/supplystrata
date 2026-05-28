#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT_DIR = process.cwd();
const TIMEOUT_MS = 90_000;
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const company = process.env["SUPPLYSTRATA_MCP_DB_SMOKE_COMPANY"] ?? "NVIDIA";

const stderrChunks = [];
const transport = new StdioClientTransport({
  command: pnpmBin,
  args: ["--silent", "tsx", "apps/mcp/src/main.ts", "--transport=stdio", "--runtime=db"],
  cwd: ROOT_DIR,
  stderr: "pipe",
  env: {
    ...process.env,
    NODE_OPTIONS: nodeOptionsWithDevelopmentCondition(process.env["NODE_OPTIONS"])
  }
});

transport.stderr?.on("data", (chunk) => {
  stderrChunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
});

const client = new Client({
  name: "supplystrata-mcp-db-smoke-client",
  version: "0.1.0"
});

try {
  await withTimeout(runSmoke(), TIMEOUT_MS);
} catch (error) {
  await closeQuietly();
  const stderr = stderrChunks.join("").trim();
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write([`MCP DB smoke failed: ${message}`, stderr].filter((item) => item.length > 0).join("\n"));
  process.stderr.write("\n");
  process.exitCode = 1;
}

async function runSmoke() {
  await client.connect(transport);

  const pendingResearch = await callStructuredTool("start_research_session", {
    company,
    depth: 2,
    reviewer: "smoke:mcp:db"
  });
  assertPath(pendingResearch, ["status"], "requires_confirmation");
  const researchPendingId = readStringPath(pendingResearch, ["pending_id"]);
  const researchToken = readStringPath(pendingResearch, ["confirmation_token"]);

  const confirmedResearch = await callStructuredTool("confirm_research_session", {
    pending_id: researchPendingId,
    confirmation_token: researchToken
  });
  assertPath(confirmedResearch, ["status"], "executed");
  const runId = readStringPath(confirmedResearch, ["data", "data", "run", "run_id"]);
  const companyEntityId = readOptionalStringPath(confirmedResearch, ["data", "data", "run", "company_entity_id"]);
  const checkTargetIds = readStringArrayPath(confirmedResearch, ["data", "data", "run", "source_check_target_ids"]);

  if (checkTargetIds.length === 0) throw new Error(`Research run ${runId} did not produce source-check targets.`);

  const pendingSourceCheck = await callStructuredTool("run_source_check", { check_target_ids: checkTargetIds });
  assertPath(pendingSourceCheck, ["status"], "requires_confirmation");
  const sourcePendingId = readStringPath(pendingSourceCheck, ["pending_id"]);
  const sourceToken = readStringPath(pendingSourceCheck, ["confirmation_token"]);

  const confirmedSourceCheck = await callStructuredTool("run_source_check", {
    pending_id: sourcePendingId,
    confirmation_token: sourceToken
  });
  assertPath(confirmedSourceCheck, ["status"], "executed");

  const runStatus = await callStructuredTool("poll_research_run", { run_id: runId });
  assertPath(runStatus, ["data", "operation_id"], "getResearchRunStatus");
  assertPath(runStatus, ["data", "run", "run_id"], runId);

  if (companyEntityId !== undefined) {
    const chain = await callStructuredTool("traverse_chain", { scope: `company:${companyEntityId}`, depth: 2 });
    assertPath(chain, ["data", "operation_id"], "getChain");
  }

  await closeQuietly();
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        transport: "stdio",
        runtime: "db",
        company,
        run_id: runId,
        source_check_targets: checkTargetIds.length
      },
      null,
      2
    )}\n`
  );
}

async function callStructuredTool(name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError === true) throw new Error(`${name} returned MCP error: ${toolErrorText(result)}`);
  if (!isRecord(result.structuredContent)) throw new Error(`${name} did not return structuredContent.`);
  return result.structuredContent;
}

function toolErrorText(result) {
  const messages = result.content
    .filter((item) => isRecord(item) && item.type === "text" && typeof item.text === "string")
    .map((item) => item.text.trim())
    .filter((text) => text.length > 0);
  return messages.length > 0 ? messages.join("\n") : JSON.stringify(result);
}

function assertPath(root, path, expected) {
  const value = readPath(root, path);
  if (value !== expected) throw new Error(`Expected ${path.join(".")} to equal ${JSON.stringify(expected)}, got ${JSON.stringify(value)}.`);
}

function readOptionalStringPath(root, path) {
  const value = readPath(root, path);
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) throw new Error(`Expected ${path.join(".")} to be a non-empty string or null.`);
  return value;
}

function readStringPath(root, path) {
  const value = readPath(root, path);
  if (typeof value !== "string" || value.length === 0) throw new Error(`Expected ${path.join(".")} to be a non-empty string.`);
  return value;
}

function readStringArrayPath(root, path) {
  const value = readPath(root, path);
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Expected ${path.join(".")} to be a string array.`);
  }
  return value;
}

function readPath(root, path) {
  let current = root;
  for (const segment of path) {
    if (!isRecord(current) || !(segment in current)) throw new Error(`Missing structuredContent path: ${path.join(".")}`);
    current = current[segment];
  }
  return current;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nodeOptionsWithDevelopmentCondition(current) {
  const parts = current === undefined || current.trim().length === 0 ? [] : current.split(/\s+/);
  return parts.includes("--conditions=development") ? parts.join(" ") : ["--conditions=development", ...parts].join(" ");
}

function withTimeout(promise, timeoutMs) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms.`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeout);
  });
}

async function closeQuietly() {
  try {
    await client.close();
  } catch {
    await transport.close();
  }
}
