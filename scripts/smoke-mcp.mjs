#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT_DIR = process.cwd();
const TIMEOUT_MS = 30_000;
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const stderrChunks = [];
const transport = new StdioClientTransport({
  command: pnpmBin,
  args: ["--silent", "tsx", "apps/mcp/src/main.ts", "--transport=stdio", "--runtime=fixture"],
  cwd: ROOT_DIR,
  stderr: "pipe",
  env: {
    NODE_OPTIONS: nodeOptionsWithDevelopmentCondition(process.env["NODE_OPTIONS"])
  }
});

transport.stderr?.on("data", (chunk) => {
  stderrChunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
});

const client = new Client({
  name: "supplystrata-mcp-smoke-client",
  version: "0.1.0"
});

try {
  await withTimeout(runSmoke(), TIMEOUT_MS);
} catch (error) {
  await closeQuietly();
  const stderr = stderrChunks.join("").trim();
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write([`MCP smoke failed: ${message}`, stderr].filter((item) => item.length > 0).join("\n"));
  process.stderr.write("\n");
  process.exitCode = 1;
}

async function runSmoke() {
  await client.connect(transport);

  const tools = await client.listTools();
  assertToolNames(tools, [
    "ping",
    "resolve_company",
    "read_evidence_for_edge",
    "traverse_chain",
    "list_unknowns",
    "list_source_targets",
    "poll_research_run",
    "start_research_session",
    "confirm_research_session",
    "run_source_check",
    "review.approve",
    "review.reject"
  ]);

  const ping = await callStructuredTool("ping", {});
  assertPath(ping, ["ok"], true);

  const resolved = await callStructuredTool("resolve_company", { query: "NVIDIA" });
  assertPath(resolved, ["data", "operation_id"], "getCompanyCard");
  assertPath(resolved, ["data", "entity", "entity_id"], "ENT-NVIDIA");

  const evidence = await callStructuredTool("read_evidence_for_edge", { edge_id: "EV-EDGE-1" });
  assertPath(evidence, ["data", "operation_id"], "getEvidence");

  const unknowns = await callStructuredTool("list_unknowns", { scope: "company:ENT-NVIDIA" });
  assertPath(unknowns, ["data", "operation_id"], "listUnknowns");
  assertArrayPath(unknowns, ["data", "unknowns"]);

  const sourceTargets = await callStructuredTool("list_source_targets", { scope: "company:ENT-NVIDIA" });
  assertPath(sourceTargets, ["data", "operation_id"], "listSourceHealth");
  assertArrayPath(sourceTargets, ["data", "source_targets"]);

  const pendingResearch = await callStructuredTool("start_research_session", { company: "NVIDIA", depth: 2, reviewer: "smoke:mcp" });
  assertPath(pendingResearch, ["status"], "requires_confirmation");
  const confirmedResearch = await callStructuredTool("confirm_research_session", {
    pending_id: readStringPath(pendingResearch, ["pending_id"]),
    confirmation_token: readStringPath(pendingResearch, ["confirmation_token"])
  });
  assertPath(confirmedResearch, ["status"], "executed");

  const invalidSourceCheck = await callStructuredTool("run_source_check", { pending_id: "missing", confirmation_token: "wrong" });
  assertPath(invalidSourceCheck, ["status"], "invalid_token");

  const pendingSourceCheck = await callStructuredTool("run_source_check", { check_target_ids: ["target-sec-edgar-nvidia"] });
  assertPath(pendingSourceCheck, ["status"], "requires_confirmation");
  const pendingId = readStringPath(pendingSourceCheck, ["pending_id"]);
  const confirmationToken = readStringPath(pendingSourceCheck, ["confirmation_token"]);

  const confirmedSourceCheck = await callStructuredTool("run_source_check", {
    pending_id: pendingId,
    confirmation_token: confirmationToken
  });
  assertPath(confirmedSourceCheck, ["status"], "executed");
  assertPath(confirmedSourceCheck, ["data", "checked_targets"], 1);

  const reusedSourceCheckToken = await callStructuredTool("run_source_check", {
    pending_id: pendingId,
    confirmation_token: confirmationToken
  });
  assertPath(reusedSourceCheckToken, ["status"], "invalid_token");

  const pendingApproval = await callStructuredTool("review.approve", { review_id: "REV-1", reviewer: "smoke:mcp", reason: "evidence checked" });
  assertPath(pendingApproval, ["status"], "requires_confirmation");
  const confirmedApproval = await callStructuredTool("review.approve", {
    pending_id: readStringPath(pendingApproval, ["pending_id"]),
    confirmation_token: readStringPath(pendingApproval, ["confirmation_token"])
  });
  assertPath(confirmedApproval, ["status"], "executed");

  const pendingRejection = await callStructuredTool("review.reject", { review_id: "REV-2", reviewer: "smoke:mcp", reason: "bad evidence" });
  assertPath(pendingRejection, ["status"], "requires_confirmation");
  const confirmedRejection = await callStructuredTool("review.reject", {
    pending_id: readStringPath(pendingRejection, ["pending_id"]),
    confirmation_token: readStringPath(pendingRejection, ["confirmation_token"])
  });
  assertPath(confirmedRejection, ["status"], "executed");

  const runStatus = await callStructuredTool("poll_research_run", { run_id: "RUN-NVIDIA-SMOKE" });
  assertPath(runStatus, ["data", "operation_id"], "getResearchRunStatus");
  assertPath(runStatus, ["data", "run_id"], "RUN-NVIDIA-SMOKE");

  const chain = await callStructuredTool("traverse_chain", { scope: "company:ENT-NVIDIA", depth: 2 });
  assertPath(chain, ["data", "operation_id"], "getChain");
  assertArrayPath(chain, ["data", "nodes"]);
  assertArrayPath(chain, ["data", "edges"]);

  await assertResourceOperation("supplystrata://entity/ENT-NVIDIA", "getCompanyCard");
  await assertResourceOperation("supplystrata://evidence/edge/EV-EDGE-1", "getEvidence");
  await assertResourceOperation("supplystrata://unknowns/company/ENT-NVIDIA", "listUnknowns");
  await assertResourceOperation("supplystrata://changes/entity/ENT-NVIDIA", "listChanges");
  await assertResourceOperation("supplystrata://source-health", "listSourceHealth");
  await assertResourceOperation("supplystrata://reasoning-walkthrough/ENT-NVIDIA", "getCompanyReasoningWalkthrough");

  await closeQuietly();
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        transport: "stdio",
        checked: tools.tools.map((tool) => tool.name).sort(),
        resources_checked: 6,
        write_gate: "requires_confirmation_then_single_confirmation_token"
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

async function assertResourceOperation(uri, operationId) {
  const result = await client.readResource({ uri });
  const firstContent = result.contents[0];
  if (!isRecord(firstContent) || typeof firstContent.text !== "string") throw new Error(`Expected ${uri} to return JSON text content.`);
  const parsed = JSON.parse(firstContent.text);
  assertPath(parsed, ["data", "operation_id"], operationId);
}

function assertToolNames(tools, expectedNames) {
  const names = tools.tools.map((tool) => tool.name);
  for (const expectedName of expectedNames) {
    if (!names.includes(expectedName)) throw new Error(`MCP server did not list expected tool: ${expectedName}`);
  }
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

function assertArrayPath(root, path) {
  const value = readPath(root, path);
  if (!Array.isArray(value) || value.length === 0) throw new Error(`Expected ${path.join(".")} to be a non-empty array.`);
}

function readStringPath(root, path) {
  const value = readPath(root, path);
  if (typeof value !== "string" || value.length === 0) throw new Error(`Expected ${path.join(".")} to be a non-empty string.`);
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
