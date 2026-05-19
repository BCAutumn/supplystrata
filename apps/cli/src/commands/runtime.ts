import { existsSync } from "node:fs";
import type { Command } from "commander";
import { loadEnv } from "@supplystrata/config";
import { createDatabaseStore } from "@supplystrata/db";
import { buildRuntimeDoctorReport, type RuntimeDoctorReport } from "@supplystrata/runtime-profile";
import { parseFormat, write, writeJson } from "../cli-utils.js";

export function registerRuntimeCommands(program: Command): void {
  const runtime = program.command("runtime").description("runtime mode diagnostics");

  runtime
    .command("doctor")
    .option("--format <format>", "markdown or json", "markdown")
    .option("--workbench <file>", "workbench JSON used by the no-database snapshot mode", "reports/nvidia-workbench.json")
    .option("--check-db", "try connecting to the configured Postgres truth store")
    .description("show which no-Docker runtime modes are usable in the current environment")
    .action(async (options: { format: string; workbench: string; checkDb?: boolean }) => {
      const report = await probeRuntimeDoctorReport({ workbenchPath: options.workbench, checkDb: options.checkDb === true });
      if (parseFormat(options.format) === "json") {
        writeJson(report);
        return;
      }
      write(renderRuntimeDoctorReport(report));
    });
}

async function probeRuntimeDoctorReport(input: { workbenchPath: string; checkDb: boolean }): Promise<RuntimeDoctorReport> {
  const env = loadEnv();
  const workbenchExists = existsSync(input.workbenchPath);
  const dbReachable = input.checkDb ? await checkDatabaseConnection() : null;
  return buildRuntimeDoctorReport({
    checked_at: new Date().toISOString(),
    postgres_url: env.POSTGRES_URL,
    neo4j_uri: env.NEO4J_URI,
    checked_db: input.checkDb,
    db_reachable: dbReachable,
    workbench_path: input.workbenchPath,
    workbench_exists: workbenchExists
  });
}

async function checkDatabaseConnection(): Promise<boolean> {
  const store = createDatabaseStore();
  try {
    await store.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await store.close();
  }
}

function renderRuntimeDoctorReport(report: RuntimeDoctorReport): string {
  const lines = [
    "# Runtime Doctor",
    "",
    `Checked at: ${report.checked_at}`,
    `Workbench JSON: ${report.workbench_path} (${report.workbench_exists ? "found" : "missing"})`,
    `Postgres URL: ${report.postgres_url}`,
    `Database ping: ${formatDatabasePing(report)}`,
    "",
    "| Mode | Status | Docker | What it runs | Command |",
    "| --- | --- | --- | --- | --- |"
  ];
  for (const mode of report.modes) {
    lines.push(`| ${mode.id} | ${mode.status} | no | ${mode.summary} | \`${mode.command}\` |`);
  }
  lines.push(
    "",
    "Notes:",
    "- Docker is only a convenience for starting local Postgres / Neo4j.",
    "- `preview` and `workbench_snapshot` do not need Postgres or Neo4j.",
    "- `truth_store` needs a reachable SQL truth store; Neo4j remains optional unless graph projection commands are used."
  );
  return lines.join("\n");
}

function formatDatabasePing(report: RuntimeDoctorReport): string {
  if (!report.checked_db) return "not checked (pass --check-db)";
  return report.db_reachable === true ? "reachable" : "unreachable";
}
