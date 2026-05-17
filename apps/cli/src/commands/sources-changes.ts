import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import { renderChanges } from "@supplystrata/render";
import {
  listDueSourceChecks,
  listSourceHealthRows,
  parseSourcePolicyConfig,
  syncSourceHealthRegistry,
  syncSourcePolicyConfig
} from "@supplystrata/source-monitor";
import { listSources, sourceStatusSummary } from "@supplystrata/source-registry";
import { defaultSince, parseChangeScope, parseFormat, parseLimit, parseSince, withPool, write, writeJson } from "../cli-utils.js";
import { renderDueSources, renderSourceHealth, renderSourcesList } from "../source-render.js";

export function registerSourcesAndChangesCommands(program: Command): void {
  const sources = program.command("sources").description("source registry commands");
  sources
    .command("list")
    .option("--format <format>", "markdown or json", "markdown")
    .description("list configured free/public sources")
    .action((options: { format: string }) => {
      write(renderSourcesList(listSources(), parseFormat(options.format)));
    });
  sources
    .command("status")
    .option("--format <format>", "markdown or json", "markdown")
    .description("summarize source implementation status")
    .action((options: { format: string }) => {
      const summary = sourceStatusSummary();
      if (parseFormat(options.format) === "json") {
        writeJson({ schema_version: "1.0.0", summary, sources: listSources() });
        return;
      }
      write(
        [
          "# Source Status",
          "",
          `Total: ${summary.total}`,
          `Implemented: ${summary.implemented}`,
          `Preview: ${summary.preview}`,
          `Planned: ${summary.planned}`,
          `Manual-only: ${summary.manualOnly}`,
          `Requires key: ${summary.requiresKey}`
        ].join("\n")
      );
    });
  sources
    .command("sync")
    .description("sync source registry metadata into Postgres")
    .action(async () => {
      await withPool(async (pool) => {
        const result = await syncSourceHealthRegistry(pool);
        writeJson({ ok: true, ...result });
      });
    });
  sources
    .command("health")
    .option("--format <format>", "markdown or json", "markdown")
    .description("show source monitoring health from Postgres")
    .action(async (options: { format: string }) => {
      await withPool(async (pool) => {
        const health = await listSourceHealthRows(pool);
        write(renderSourceHealth(health, parseFormat(options.format)));
      });
    });
  sources
    .command("due")
    .option("--limit <count>", "max due sources", "50")
    .option("--format <format>", "markdown or json", "markdown")
    .description("list sources whose configured check time is due")
    .action(async (options: { limit: string; format: string }) => {
      await withPool(async (pool) => {
        const due = await listDueSourceChecks(pool, { limit: parseLimit(options.limit) });
        write(renderDueSources(due, parseFormat(options.format)));
      });
    });

  const sourcePolicy = sources.command("policy").description("source monitoring policy commands");
  sourcePolicy
    .command("sync")
    .requiredOption("--file <path>", "JSON source policy config")
    .description("sync external source monitoring policy config")
    .action(async (options: { file: string }) => {
      await withPool(async (pool) => {
        const config = parseSourcePolicyConfig(await readFile(options.file, "utf8"));
        const result = await syncSourcePolicyConfig(pool, { config, configSource: options.file });
        writeJson({ ok: true, ...result });
      });
    });

  program
    .command("changes")
    .option("--since <date>", "ISO date/time lower bound", defaultSince(7))
    .option("--scope <scope>", "company:<id>, entity:<id>, edge:<id>, or source:<id>")
    .option("--type <changeType>", "change/event type filter")
    .option("--source <sourceAdapterId>", "source adapter filter")
    .option("--attention-only", "only show changes requiring attention", false)
    .option("--limit <count>", "max changes", "50")
    .option("--format <format>", "markdown or json", "markdown")
    .description("show graph and source-monitor changes")
    .action(async (options: { since: string; scope?: string; type?: string; source?: string; attentionOnly: boolean; limit: string; format: string }) => {
      await withPool(async (pool) => {
        const scope = parseChangeScope(options.scope);
        const input = {
          since: parseSince(options.since),
          limit: parseLimit(options.limit),
          format: parseFormat(options.format),
          ...(scope === undefined ? {} : { scope }),
          ...(options.type === undefined ? {} : { changeType: options.type }),
          ...(options.source === undefined ? {} : { sourceAdapterId: options.source }),
          attentionOnly: options.attentionOnly
        };
        write(await renderChanges(pool, input));
      });
    });
}
