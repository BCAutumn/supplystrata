import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import { checkSecEdgarSource, runDueSourceChecks, type DueSourceCheckRunResult, type SourceCheckSummary } from "@supplystrata/pipeline";
import { renderChanges } from "@supplystrata/render";
import {
  listDueSourceChecks,
  listSourceHealthRows,
  parseSourcePolicyConfig,
  syncSourceHealthRegistry,
  syncSourcePolicyConfig
} from "@supplystrata/source-monitor";
import { planSourcesForComponents } from "@supplystrata/source-plan";
import { listSources, sourceStatusSummary } from "@supplystrata/source-registry";
import { defaultSince, isSupportedFormType, parseChangeScope, parseFormat, parseLimit, parseSince, withDatabase, write, writeJson } from "../cli-utils.js";
import { renderDueSources, renderSourceHealth, renderSourcePlan, renderSourcesList } from "../source-render.js";

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
          `Scoped: ${summary.scoped}`,
          `Manual-only: ${summary.manualOnly}`,
          `Requires key: ${summary.requiresKey}`
        ].join("\n")
      );
    });
  sources
    .command("sync")
    .description("sync source registry metadata into Postgres")
    .action(async () => {
      await withDatabase(async (pool) => {
        const result = await syncSourceHealthRegistry(pool);
        writeJson({ ok: true, ...result });
      });
    });
  sources
    .command("health")
    .option("--format <format>", "markdown or json", "markdown")
    .description("show source monitoring health from Postgres")
    .action(async (options: { format: string }) => {
      await withDatabase(async (pool) => {
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
      await withDatabase(async (pool) => {
        const due = await listDueSourceChecks(pool, { limit: parseLimit(options.limit) });
        write(renderDueSources(due, parseFormat(options.format)));
      });
    });
  sources
    .command("run-due")
    .option("--limit <count>", "max due source targets to run", "10")
    .option("--format <format>", "markdown or json", "markdown")
    .description("run due source check targets and record monitoring events")
    .action(async (options: { limit: string; format: string }) => {
      await withDatabase(async (pool) => {
        const result = await runDueSourceChecks(pool, { limit: parseLimit(options.limit) });
        if (parseFormat(options.format) === "json") {
          writeJson({ schema_version: "1.0.0", ...result });
          return;
        }
        write(renderDueSourceCheckRun(result));
      });
    });
  sources
    .command("check")
    .requiredOption("--source <sourceAdapterId>", "implemented source adapter id; currently sec-edgar")
    .option("--cik <cik>", "SEC CIK when --source sec-edgar")
    .option("--entity <entityId>", "primary entity id when --source sec-edgar")
    .option("--forms <forms>", "comma-separated SEC forms, e.g. 10-K,10-Q,8-K", "10-K")
    .option("--limit <count>", "max documents to check", "1")
    .option("--format <format>", "markdown or json", "markdown")
    .description("run one configured source check and record source monitor events")
    .action(async (options: { source: string; cik?: string; entity?: string; forms: string; limit: string; format: string }) => {
      await withDatabase(async (pool) => {
        if (options.source !== "sec-edgar") throw new Error(`Unsupported source check adapter: ${options.source}`);
        if (options.cik === undefined || options.entity === undefined) throw new Error("--cik and --entity are required for sec-edgar source checks");
        const summaries = await checkSecEdgarSource(pool, {
          cik: options.cik,
          entityId: options.entity,
          formTypes: parseSecForms(options.forms),
          limit: parseLimit(options.limit)
        });
        if (parseFormat(options.format) === "json") {
          writeJson({ schema_version: "1.0.0", source_adapter_id: options.source, checked: summaries.length, summaries });
          return;
        }
        write(renderSourceCheckSummary(options.source, summaries));
      });
    });
  sources
    .command("plan")
    .requiredOption("--component <ids>", "component id or comma-separated component ids, e.g. COMP-WAFER,COMP-HBM")
    .option("--entity <ids>", "optional entity id or comma-separated entity ids for company-specific sources")
    .option("--depth <depth>", "max upstream catalog depth", "3")
    .option("--format <format>", "markdown or json", "markdown")
    .description("plan free/public data sources for component upstream research")
    .action((options: { component: string; entity?: string; depth: string; format: string }) => {
      const componentIds = parseComponentIds(options.component);
      const entityIds = options.entity === undefined ? [] : parseComponentIds(options.entity);
      const plan = planSourcesForComponents({ component_ids: componentIds, entity_ids: entityIds, maxTierDepth: parseLimit(options.depth) });
      write(renderSourcePlan(plan, parseFormat(options.format)));
    });

  const sourcePolicy = sources.command("policy").description("source monitoring policy commands");
  sourcePolicy
    .command("sync")
    .requiredOption("--file <path>", "JSON source policy config")
    .description("sync external source monitoring policy config")
    .action(async (options: { file: string }) => {
      await withDatabase(async (pool) => {
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
      await withDatabase(async (pool) => {
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

function parseComponentIds(value: string): string[] {
  const ids = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (ids.length === 0) throw new Error("--component must include at least one component id");
  return [...new Set(ids)].sort();
}

function parseSecForms(value: string): ("10-K" | "10-Q" | "20-F" | "8-K")[] {
  const rawForms = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (rawForms.length === 0) throw new Error("--forms must include at least one SEC form");
  const forms: ("10-K" | "10-Q" | "20-F" | "8-K")[] = [];
  for (const form of rawForms) {
    if (!isSupportedFormType(form)) throw new Error(`Unsupported SEC form: ${form}`);
    forms.push(form);
  }
  return [...new Set(forms)];
}

function renderSourceCheckSummary(sourceAdapterId: string, summaries: readonly SourceCheckSummary[]): string {
  const lines = [`# Source Check: ${sourceAdapterId}`, "", `Documents checked: ${summaries.length}`];
  for (const item of summaries) {
    lines.push("", `- ${item.change_type} ${item.doc_id}`);
    lines.push(`  Task: ${item.task_id}`);
    lines.push(`  Source item: ${item.source_item_id}`);
    lines.push(`  Event: ${item.source_event_id}`);
    lines.push(`  Observations: ${item.observations}`);
    lines.push(`  Semantic changes: ${item.semantic_changes}`);
    lines.push(`  Relation changes: ${item.relation_changes}`);
    lines.push(`  URL: ${item.source_url}`);
  }
  return lines.join("\n");
}

function renderDueSourceCheckRun(result: DueSourceCheckRunResult): string {
  const lines = ["# Due Source Check Run", "", `Due targets: ${result.due_targets}`, `Checked targets: ${result.checked_targets}`];
  for (const item of result.items) {
    lines.push("", `- ${item.check_target_id} (${item.source_adapter_id})`);
    lines.push(`  Kind: ${item.target_kind}; subject: ${item.subject_entity_id ?? "n/a"}`);
    lines.push(`  Documents checked: ${item.checked_documents}`);
    for (const summary of item.summaries) {
      lines.push(
        `  - ${summary.change_type} ${summary.doc_id} (${summary.observations} observations, ${summary.semantic_changes} semantic changes, ${summary.relation_changes} relation changes)`
      );
    }
  }
  return lines.join("\n");
}
