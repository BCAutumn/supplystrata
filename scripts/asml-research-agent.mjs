#!/usr/bin/env node
// Dogfooding driver: act as an external agent that researches ASML's global supply chain
// purely through the MCP surface (DB runtime), logging every request/response so we can
// judge whether each tool actually gives a consumer the information they need.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT_DIR = process.cwd();
const COMPANY = process.env["ASML_AGENT_COMPANY"] ?? "ASML";
const DEPTH = Number(process.env["ASML_AGENT_DEPTH"] ?? "2");
const HEAVY_TIMEOUT_MS = 300_000;
const OUT_DIR = join(ROOT_DIR, "reports", "asml-dogfood");
mkdirSync(OUT_DIR, { recursive: true });

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const transcript = [];
const stderrChunks = [];

const transport = new StdioClientTransport({
  command: pnpmBin,
  args: ["--silent", "tsx", "apps/mcp/src/main.ts", "--transport=stdio", "--runtime=db"],
  cwd: ROOT_DIR,
  stderr: "pipe",
  env: { ...process.env, NODE_OPTIONS: nodeOptionsWithDevelopmentCondition(process.env["NODE_OPTIONS"]) }
});
transport.stderr?.on("data", (chunk) => stderrChunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk)));

const client = new Client({ name: "asml-dogfood-agent", version: "0.1.0" });

let step = 0;
function log(kind, detail) {
  const entry = { step: (step += 1), at: new Date().toISOString(), kind, ...detail };
  transcript.push(entry);
  const preview = detail.summary ?? detail.error ?? "";
  process.stdout.write(`\n[${entry.step}] ${kind}${preview ? ` :: ${preview}` : ""}\n`);
  return entry;
}

async function callTool(name, args, { heavy = false } = {}) {
  const started = Date.now();
  try {
    const result = await client.callTool({ name, arguments: args }, undefined, heavy ? { timeout: HEAVY_TIMEOUT_MS } : undefined);
    const ms = Date.now() - started;
    const structured = result.structuredContent ?? null;
    const isError = result.isError === true;
    log(`tool:${name}`, {
      args,
      ms,
      isError,
      text: textOf(result),
      structured,
      summary: `${ms}ms${isError ? " ERROR" : ""}`
    });
    return { structured, isError, text: textOf(result) };
  } catch (error) {
    const ms = Date.now() - started;
    log(`tool:${name}`, { args, ms, error: messageOf(error), summary: `${ms}ms THREW: ${messageOf(error)}` });
    return { structured: null, isError: true, text: messageOf(error) };
  }
}

async function readResource(uri, { heavy = false } = {}) {
  const started = Date.now();
  try {
    const result = await client.readResource({ uri }, heavy ? { timeout: HEAVY_TIMEOUT_MS } : undefined);
    const ms = Date.now() - started;
    const first = result.contents?.[0];
    let parsed = null;
    if (first && typeof first.text === "string") {
      try {
        parsed = JSON.parse(first.text);
      } catch {
        parsed = first.text.slice(0, 2000);
      }
    }
    log(`resource:${uri}`, { ms, parsed, summary: `${ms}ms` });
    return parsed;
  } catch (error) {
    const ms = Date.now() - started;
    log(`resource:${uri}`, { ms, error: messageOf(error), summary: `${ms}ms THREW: ${messageOf(error)}` });
    return null;
  }
}

// Two-step confirmation helper: many write tools return requires_confirmation + a single-use token.
async function callWriteWithConfirmation(name, args, { heavy = false } = {}) {
  const pending = await callTool(name, args, { heavy: false });
  if (pending.isError || !pending.structured) return pending;
  const status = pending.structured.status;
  if (status !== "requires_confirmation") return pending; // already executed or other shape
  const pendingId = pending.structured.pending_id;
  const token = pending.structured.confirmation_token;
  if (typeof pendingId !== "string" || typeof token !== "string") {
    log(`note`, { summary: `${name} requires_confirmation but missing pending_id/token` });
    return pending;
  }
  return callTool(name, { pending_id: pendingId, confirmation_token: token }, { heavy });
}

async function main() {
  await client.connect(transport);

  const tools = await client.listTools();
  log("listTools", { tools: tools.tools.map((t) => t.name), summary: tools.tools.map((t) => t.name).join(", ") });

  // Round 1 — cold resolve. Expect explicit unresolved (not "company does not exist").
  await callTool("resolve_company", { query: COMPANY });

  // Round 2 — start a research session, then confirm via the dedicated confirm tool.
  // NOTE: research sessions confirm through `confirm_research_session` (a distinct tool),
  // unlike run_source_check which re-confirms through its own name. This asymmetry in the
  // write surface is itself a usability data point.
  const pendingResearch = await callTool("start_research_session", { company: COMPANY, depth: DEPTH, reviewer: "dogfood:asml" });
  let research = pendingResearch;
  if (pendingResearch.structured?.status === "requires_confirmation") {
    research = await callTool(
      "confirm_research_session",
      {
        pending_id: pendingResearch.structured.pending_id,
        confirmation_token: pendingResearch.structured.confirmation_token
      },
      { heavy: true }
    );
  }
  const run = deepFind(research.structured, "run");
  const runId = run?.run_id ?? deepFind(research.structured, "run_id");
  const companyEntityId = run?.company_entity_id ?? deepFind(research.structured, "company_entity_id");
  const targetIds = run?.source_check_target_ids ?? deepFind(research.structured, "source_check_target_ids") ?? [];
  log("note", { runId, companyEntityId, targetCount: Array.isArray(targetIds) ? targetIds.length : 0, summary: `run=${runId} entity=${companyEntityId} targets=${Array.isArray(targetIds) ? targetIds.length : 0}` });

  // Round 3 — run the source checks (this now also runs extract + evidence-gated promote).
  if (Array.isArray(targetIds) && targetIds.length > 0) {
    await callWriteWithConfirmation("run_source_check", { check_target_ids: targetIds }, { heavy: true });
  } else {
    log("note", { summary: "No source-check targets produced; skipping run_source_check." });
  }

  // Round 4 — durable run status.
  if (typeof runId === "string") await callTool("poll_research_run", { run_id: runId });

  // Round 5 — resolve again; cache should now be warm.
  const warm = await callTool("resolve_company", { query: COMPANY });
  const warmEntityId = companyEntityId ?? deepFind(warm.structured, "entity_id");

  // Round 6 — traverse the supply chain graph.
  if (typeof warmEntityId === "string") {
    await callTool("traverse_chain", { scope: `company:${warmEntityId}`, depth: DEPTH });
    await callTool("list_unknowns", { scope: `company:${warmEntityId}` });
  }
  await callTool("list_source_targets", {});

  // Round 7 — read resources: SCBOM document + source health + change timeline.
  if (typeof warmEntityId === "string") {
    await readResource(`supplystrata://scbom/company/${warmEntityId}`);
    await readResource(`supplystrata://changes/entity/${warmEntityId}`);
    await readResource(`supplystrata://unknowns/company/${warmEntityId}`);
  }
  await readResource("supplystrata://source-health");

  // Round 8 — drill into evidence for the first discovered edge (audit trail).
  const edgeId = findFirstEdgeId();
  if (edgeId) await callTool("read_evidence_for_edge", { edge_id: edgeId });
  else log("note", { summary: "No edge id surfaced in chain/scbom to audit evidence for." });

  finishAndWrite("ok");
}

function findFirstEdgeId() {
  for (const entry of transcript) {
    const e = deepFind(entry.structured ?? entry.parsed, "edge_id");
    if (typeof e === "string" && e.length > 0) return e;
  }
  return null;
}

function finishAndWrite(status) {
  const summary = buildSummary(status);
  writeFileSync(join(OUT_DIR, "transcript.json"), JSON.stringify(transcript, null, 2));
  writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  writeFileSync(join(OUT_DIR, "server-stderr.log"), stderrChunks.join(""));
  process.stdout.write(`\n=== DOGFOOD SUMMARY ===\n${JSON.stringify(summary, null, 2)}\n`);
}

function buildSummary(status) {
  const calls = transcript.filter((e) => e.kind.startsWith("tool:") || e.kind.startsWith("resource:"));
  return {
    status,
    company: COMPANY,
    depth: DEPTH,
    total_calls: calls.length,
    errors: calls.filter((c) => c.isError || c.error).map((c) => ({ step: c.step, kind: c.kind, detail: c.error ?? c.text })),
    timings_ms: Object.fromEntries(calls.map((c) => [`${c.step}:${c.kind}`, c.ms]))
  };
}

function deepFind(obj, key, depth = 0) {
  if (obj === null || obj === undefined || depth > 8) return undefined;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFind(item, key, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof obj === "object") {
    if (key in obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
    for (const value of Object.values(obj)) {
      const found = deepFind(value, key, depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function textOf(result) {
  if (!Array.isArray(result?.content)) return "";
  return result.content
    .filter((i) => i && i.type === "text" && typeof i.text === "string")
    .map((i) => i.text)
    .join("\n")
    .slice(0, 4000);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function nodeOptionsWithDevelopmentCondition(current) {
  const parts = current === undefined || current.trim().length === 0 ? [] : current.split(/\s+/);
  return parts.includes("--conditions=development") ? parts.join(" ") : ["--conditions=development", ...parts].join(" ");
}

try {
  await main();
} catch (error) {
  log("fatal", { error: messageOf(error), summary: messageOf(error) });
  finishAndWrite("fatal");
  process.exitCode = 1;
} finally {
  try {
    await client.close();
  } catch {
    try {
      await transport.close();
    } catch {
      // ignore
    }
  }
}
