#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const rootDir = process.cwd();
const checks = [];
const withDb = process.argv.includes("--with-db");

function addCheck(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  const status = ok ? "ok" : "fail";
  console.log(`[${status}] ${name}${detail.length > 0 ? ` - ${detail}` : ""}`);
}

function runPnpm(args, options = {}) {
  const capture = options.capture === true;
  const result = spawnSync(pnpmBin, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: process.env
  });
  const stdout = result.stdout === null ? "" : result.stdout;
  const stderr = result.stderr === null ? "" : result.stderr;
  if (result.status !== 0) {
    throw new Error([`pnpm ${args.join(" ")} failed`, stdout.trim(), stderr.trim()].filter(Boolean).join("\n"));
  }
  return stdout;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} did not return valid JSON: ${message}`);
  }
}

async function main() {
  console.log("SupplyStrata release check");
  await checkIgnoreRules();
  await checkNoSecretsInTrackedSurface();

  await runNamedCommand("type-check", ["type-check"]);
  await runNamedCommand("format check", ["format:check"]);
  await runNamedCommand("build", ["build"]);
  await runNamedCommand("unit tests", ["test:unit"]);
  await runNamedCommand("integration tests", ["test:integration"]);
  await runNamedCommand("e2e fixture tests", ["test:e2e"]);
  await runNamedCommand("lint", ["lint"]);
  await runNamedCommand("dependency boundaries", ["dep-check"]);
  await runNamedCommand("local smoke", withDb ? ["smoke:local", "--with-db"] : ["smoke:local"]);
  await runNamedCommand("MCP stdio smoke", ["smoke:mcp"]);
  await runNamedCommand("MCP HTTP smoke", ["smoke:mcp:http"]);

  if (withDb) {
    const dq = parseJson(runPnpm(["--silent", "cli", "dq", "run", "--format", "json"], { capture: true }), "dq run");
    addCheck("data quality", dq.ok === true, `errors=${dq.counts?.error ?? "?"}, warnings=${dq.counts?.warn ?? "?"}`);

    const graph = parseJson(runPnpm(["--silent", "cli", "graph", "check", "--format", "json"], { capture: true }), "graph check");
    addCheck("graph consistency", graph.ok === true, graph.check?.status ?? "unknown");
  } else {
    addCheck("data quality", true, "skipped; pass --with-db to require a SQL truth store");
    addCheck("graph consistency", true, "skipped; pass --with-db to require a GraphStore");
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    console.error(`Release check failed: ${failed.length} failed check(s).`);
    process.exitCode = 1;
    return;
  }
  console.log("Release check passed.");
}

async function runNamedCommand(name, args) {
  runPnpm(args);
  addCheck(name, true);
}

async function checkIgnoreRules() {
  const gitignore = await readFile(join(rootDir, ".gitignore"), "utf8");
  const required = ["node_modules/", "/data/", "/reports/", ".env"];
  for (const item of required) {
    addCheck(`.gitignore contains ${item}`, gitignore.split(/\r?\n/).includes(item));
  }
}

async function checkNoSecretsInTrackedSurface() {
  const findings = [];
  for await (const file of walk(rootDir)) {
    const text = await readFile(file, "utf8");
    const rel = relative(rootDir, file);
    for (const pattern of secretPatterns()) {
      if (pattern.test(text)) findings.push(`${rel}: ${pattern.source}`);
    }
  }
  addCheck("secret scan", findings.length === 0, findings.length === 0 ? "no obvious secrets outside ignored paths" : findings.join("; "));
}

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    const rel = relative(rootDir, path);
    if (shouldSkip(rel, entry.name)) continue;
    if (entry.isDirectory()) {
      yield* walk(path);
      continue;
    }
    if (!entry.isFile()) continue;
    const info = await stat(path);
    if (info.size > 1_000_000) continue;
    if (!isLikelyTextFile(entry.name)) continue;
    yield path;
  }
}

function shouldSkip(rel, name) {
  return (
    name === ".env" ||
    name === "dist" ||
    name === "coverage" ||
    name === ".tmp-build-test" ||
    rel === ".git" ||
    rel.startsWith(".git/") ||
    rel === "node_modules" ||
    rel.startsWith("node_modules/") ||
    rel === "data" ||
    rel.startsWith("data/") ||
    rel === "reports" ||
    rel.startsWith("reports/") ||
    rel === "coverage" ||
    rel.startsWith("coverage/") ||
    rel === "dist" ||
    rel.startsWith("dist/")
  );
}

function isLikelyTextFile(name) {
  return (
    /\.(cjs|csv|html|js|json|md|mjs|ts|tsx|txt|yaml|yml)$/i.test(name) ||
    name === ".gitignore" ||
    name === ".env.example" ||
    name === "LICENSE" ||
    name === "NOTICE"
  );
}

function secretPatterns() {
  return [
    /\bsk-(?:proj-[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{32,})\b/,
    /^(?:export\s+)?(?:OPENAI|ANTHROPIC|DEEPSEEK|OPEN_CORPORATES|COMPANIES_HOUSE)_(?:API_KEY|API_TOKEN)[ \t]*=[ \t]*[^\s#\r\n]+/m
  ];
}

await main();
