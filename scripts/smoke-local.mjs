#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const withNetwork = process.argv.includes("--with-network");
const withDb = withNetwork || process.argv.includes("--with-db");

function runPnpm(args, options = {}) {
  const capture = options.capture === true;
  const result = spawnSync(pnpmBin, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: process.env
  });

  if (result.status !== 0) {
    const stderr = result.stderr === null ? "" : result.stderr.trim();
    const stdout = result.stdout === null ? "" : result.stdout.trim();
    const detail = [stdout, stderr].filter((item) => item.length > 0).join("\n");
    throw new Error(`命令失败：pnpm ${args.join(" ")}${detail.length > 0 ? `\n${detail}` : ""}`);
  }

  return result.stdout === null ? "" : result.stdout;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} 输出不是合法 JSON：${message}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

console.log(`SupplyStrata smoke (${withNetwork ? "network" : "local"})`);

if (!withDb) {
  const rootHelp = runPnpm(["--silent", "cli", "--help"], { capture: true });
  const previewHelp = runPnpm(["--silent", "cli", "preview", "--help"], { capture: true });
  const reviewHelp = runPnpm(["--silent", "cli", "review", "--help"], { capture: true });
  assert(rootHelp.includes("Usage:"), "CLI 根命令 help 缺少 Usage");
  assert(previewHelp.includes("sec-edgar"), "preview help 缺少 sec-edgar 命令");
  assert(reviewHelp.includes("apply-approved"), "review help 缺少 apply-approved 命令");
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "local",
        db: false,
        checked: ["cli --help", "cli preview --help", "cli review --help"]
      },
      null,
      2
    )
  );
  process.exit(0);
}

// DB smoke 验证本地 truth store + GraphStore 链路；联网 smoke 额外抓 SEC 并生成 NVIDIA 研究输出。
runPnpm(["db:migrate"]);
runPnpm(["cli", "admin", "seed"]);

if (withNetwork) {
  runPnpm(["cli", "pipeline", "nvidia"]);
}

runPnpm(["cli", "graph", "rebuild"]);

const graphCheck = parseJson(runPnpm(["--silent", "cli", "graph", "check", "--format", "json"], { capture: true }), "graph check");
assert(graphCheck.ok === true, "Graph check 未通过");
assert(graphCheck.check?.status === "synced", "Postgres 与 Neo4j 计数不一致");

const summary = {
  ok: true,
  mode: withNetwork ? "network" : "local",
  graph: graphCheck.check
};

if (withNetwork) {
  const companyMarkdown = runPnpm(["--silent", "cli", "company", "nvidia", "--format", "markdown"], { capture: true });
  assert(companyMarkdown.includes("# NVIDIA"), "NVIDIA company 输出缺少标题");
  assert(companyMarkdown.includes("Evidence:"), "NVIDIA company 输出缺少 evidence 引用");
  assert(companyMarkdown.includes("Unknown map"), "NVIDIA company 输出缺少 unknown map");

  const unknownMapMarkdown = runPnpm(["--silent", "cli", "unknown-map", "nvidia", "--format", "markdown"], { capture: true });
  assert(unknownMapMarkdown.includes("# Unknown map"), "unknown-map 输出缺少标题");
  assert(unknownMapMarkdown.split("\n- ").length >= 6, "unknown-map 至少应包含 5 个未知项");

  summary.research_output = {
    company_contains_evidence: true,
    unknown_map_items_at_least: 5
  };
}

console.log(JSON.stringify(summary, null, 2));
