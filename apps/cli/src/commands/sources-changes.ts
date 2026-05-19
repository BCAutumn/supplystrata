import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import { listChangeTimeline } from "@supplystrata/db";
import {
  listRegisteredSourceCheckConnectorCapabilities,
  listSourceCheckConnectorIds,
  runDueSourceChecks,
  runManualSourceCheck,
  type DueSourceCheckRunResult,
  type SourceCheckSummary
} from "@supplystrata/source-workflows";
import {
  assertValidSourceManagementConfig,
  buildSourceCheckTargetIdsFromPlan,
  buildSourceManagementCatalog,
  buildSourcePolicyConfigFromPlanTargets,
  parseManagedSourcePlanDocument
} from "@supplystrata/source-management";
import { renderChangeTimelineItems } from "@supplystrata/render";
import {
  listDueSourceChecks,
  listSourceHealthRows,
  parseSourcePolicyConfig,
  enableSourceCheckTargets,
  syncSourceHealthRegistry,
  syncSourcePolicyConfig,
  type SourcePolicyConfig
} from "@supplystrata/source-monitor";
import { planSourcesForComponents } from "@supplystrata/source-plan";
import { listSources, sourceStatusSummary } from "@supplystrata/source-registry";
import { defaultSince, parseChangeScope, parseFormat, parseLimit, parseSince, withDatabase, write, writeJson } from "../cli-utils.js";
import { renderDueSources, renderSourceHealth, renderSourceManagementCatalog, renderSourcePlan, renderSourcesList } from "../source-render.js";

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
    .command("catalog")
    .option("--format <format>", "markdown or json", "markdown")
    .description("show source registry entries with runnable connector capabilities")
    .action((options: { format: string }) => {
      const catalog = buildSourceManagementCatalog({ connector_capabilities: listRegisteredSourceCheckConnectorCapabilities() });
      write(renderSourceManagementCatalog(catalog, parseFormat(options.format)));
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
    .option("--check-target-id <ids>", "comma-separated source_check_targets ids to include")
    .option("--source <ids>", "comma-separated source adapter ids to include")
    .option("--source-plan <path>", "research-pack source-plan.json; requires --namespace")
    .option("--namespace <name>", "stable namespace used with --source-plan")
    .option("--format <format>", "markdown or json", "markdown")
    .description("list sources whose configured check time is due")
    .action(async (options: { limit: string; checkTargetId?: string; source?: string; sourcePlan?: string; namespace?: string; format: string }) => {
      await withDatabase(async (pool) => {
        const selection = await buildSourceCheckSelectionOptions(options);
        const due = await listDueSourceChecks(pool, { limit: parseLimit(options.limit), ...selection });
        write(renderDueSources(due, parseFormat(options.format)));
      });
    });
  sources
    .command("run-due")
    .option("--limit <count>", "max due source targets to run", "10")
    .option("--check-target-id <ids>", "comma-separated source_check_targets ids to include")
    .option("--source <ids>", "comma-separated source adapter ids to include")
    .option("--source-plan <path>", "research-pack source-plan.json; requires --namespace")
    .option("--namespace <name>", "stable namespace used with --source-plan")
    .option("--format <format>", "markdown or json", "markdown")
    .description("run due source check targets and record monitoring events")
    .action(async (options: { limit: string; checkTargetId?: string; source?: string; sourcePlan?: string; namespace?: string; format: string }) => {
      await withDatabase(async (pool) => {
        const selection = await buildSourceCheckSelectionOptions(options);
        const result = await runDueSourceChecks(pool, { limit: parseLimit(options.limit), ...selection });
        if (parseFormat(options.format) === "json") {
          writeJson({ schema_version: "1.0.0", ...result });
          return;
        }
        write(renderDueSourceCheckRun(result));
      });
    });
  sources
    .command("check")
    .requiredOption("--source <sourceAdapterId>", `source adapter id; supported connectors: ${listSourceCheckConnectorIds().join(", ")}`)
    .option("--target-kind <kind>", "source check target kind; inferred when the source has exactly one connector")
    .option("--config <json>", "JSON object passed to the source check connector")
    .option("--config-file <path>", "JSON file object passed to the source check connector")
    .option("--cik <cik>", "convenience config field for SEC CIK")
    .option("--entity <entityId>", "convenience config field for primary entity_id")
    .option("--forms <forms>", "convenience config field for SEC form_types, e.g. 10-K,10-Q,8-K")
    .option("--year <year>", "convenience config field for official IR year")
    .option("--query <query>", "convenience config field for source checks that search by query")
    .option("--limit <count>", "convenience config field for connector limit")
    .option("--format <format>", "markdown or json", "markdown")
    .description("run one configured source check and record source monitor events")
    .action(
      async (options: {
        source: string;
        targetKind?: string;
        config?: string;
        configFile?: string;
        cik?: string;
        entity?: string;
        forms?: string;
        year?: string;
        query?: string;
        limit?: string;
        format: string;
      }) => {
        await withDatabase(async (pool) => {
          const targetConfig = await buildManualSourceCheckConfig(options);
          const summaries = await runManualSourceCheck(pool, {
            source_adapter_id: options.source,
            ...(options.targetKind === undefined ? {} : { target_kind: options.targetKind }),
            target_config: targetConfig
          });
          if (parseFormat(options.format) === "json") {
            writeJson({
              schema_version: "1.0.0",
              source_adapter_id: options.source,
              target_kind: options.targetKind ?? null,
              checked: summaries.length,
              summaries
            });
            return;
          }
          write(renderSourceCheckSummary(options.source, summaries));
        });
      }
    );
  sources
    .command("plan")
    .requiredOption("--component <ids>", "component id or comma-separated component ids, e.g. COMP-WAFER,COMP-HBM")
    .option("--entity <ids>", "optional entity id or comma-separated entity ids for company-specific sources")
    .option("--depth <depth>", "max upstream catalog depth", "3")
    .option("--trade-month <yyyy-mm>", "also emit Census Trade observation target suggestions for this month")
    .option("--trade-country <code>", "optional Census partner country code for trade target suggestions")
    .option("--trade-directions <directions>", "comma-separated trade directions for target suggestions", "imports,exports")
    .option("--material-year <yyyy>", "also emit annual material observation target suggestions for USGS/IEA-style sources")
    .option("--commodity-month <yyyy-mm>", "also emit monthly commodity price observation target suggestions for World Bank-style sources")
    .option("--official-year <yyyy>", "also emit official IR disclosure target suggestions for this year")
    .option("--format <format>", "markdown or json", "markdown")
    .description("plan free/public data sources for component upstream research")
    .action(
      (options: {
        component: string;
        entity?: string;
        depth: string;
        tradeMonth?: string;
        tradeCountry?: string;
        tradeDirections: string;
        materialYear?: string;
        commodityMonth?: string;
        officialYear?: string;
        format: string;
      }) => {
        const componentIds = parseComponentIds(options.component);
        const entityIds = options.entity === undefined ? [] : parseComponentIds(options.entity);
        const plan = planSourcesForComponents({
          component_ids: componentIds,
          entity_ids: entityIds,
          maxTierDepth: parseLimit(options.depth),
          ...(options.tradeMonth === undefined
            ? {}
            : {
                tradeObservationMonth: options.tradeMonth,
                ...(options.tradeCountry === undefined ? {} : { tradeObservationCountryCode: options.tradeCountry }),
                tradeObservationDirections: parseTradeDirections(options.tradeDirections)
              }),
          ...(options.materialYear === undefined ? {} : { materialObservationYear: options.materialYear }),
          ...(options.commodityMonth === undefined ? {} : { commodityObservationMonth: options.commodityMonth }),
          ...(options.officialYear === undefined ? {} : { officialDisclosureYear: options.officialYear })
        });
        write(renderSourcePlan(plan, parseFormat(options.format)));
      }
    );

  const sourcePolicy = sources.command("policy").description("source monitoring policy commands");
  sourcePolicy
    .command("sync")
    .requiredOption("--file <path>", "JSON source policy config")
    .description("sync external source monitoring policy config")
    .action(async (options: { file: string }) => {
      await withDatabase(async (pool) => {
        const config = parseSourcePolicyConfig(await readFile(options.file, "utf8"));
        const validation = assertValidSourceManagementConfig(config, {
          connector_capabilities: listRegisteredSourceCheckConnectorCapabilities()
        });
        const result = await syncSourcePolicyConfig(pool, { config, configSource: options.file });
        writeJson({ ok: true, validation_warnings: validation.warnings, ...result });
      });
    });
  sourcePolicy
    .command("sync-plan-targets")
    .requiredOption("--source-plan <path>", "research-pack source-plan.json")
    .requiredOption("--namespace <name>", "stable namespace for generated check_target_id values, e.g. nvidia-memory-2025")
    .option("--enable", "enable generated targets immediately", false)
    .option("--next-check-at <iso>", "optional initial next_check_at for generated targets")
    .option("--check-cadence-minutes <minutes>", "optional target-level cadence override")
    .option("--jitter-minutes <minutes>", "optional target-level jitter override")
    .option("--max-attempts <count>", "optional target-level retry limit")
    .option("--backoff-base-minutes <minutes>", "optional target-level retry backoff base")
    .option("--backoff-max-minutes <minutes>", "optional target-level retry backoff max")
    .description("sync runnable target suggestions from a research-pack source-plan into source_check_targets")
    .action(
      async (options: {
        sourcePlan: string;
        namespace: string;
        enable: boolean;
        nextCheckAt?: string;
        checkCadenceMinutes?: string;
        jitterMinutes?: string;
        maxAttempts?: string;
        backoffBaseMinutes?: string;
        backoffMaxMinutes?: string;
      }) => {
        const sourcePlanDocument = parseManagedSourcePlanDocument(await readFile(options.sourcePlan, "utf8"));
        const config = buildSourcePolicyConfigFromPlanTargets({
          source_plan: sourcePlanDocument.source_plan,
          namespace: options.namespace,
          enabled: options.enable,
          ...(options.nextCheckAt === undefined ? {} : { next_check_at: parseIsoDateTime(options.nextCheckAt, "--next-check-at") }),
          ...(options.checkCadenceMinutes === undefined
            ? {}
            : { check_cadence_minutes: parseOptionalPositiveInteger(options.checkCadenceMinutes, "--check-cadence-minutes") }),
          ...(options.jitterMinutes === undefined ? {} : { jitter_minutes: parseOptionalNonNegativeInteger(options.jitterMinutes, "--jitter-minutes") }),
          ...(options.maxAttempts === undefined ? {} : { max_attempts: parseOptionalPositiveInteger(options.maxAttempts, "--max-attempts") }),
          ...(options.backoffBaseMinutes === undefined
            ? {}
            : { backoff_base_minutes: parseOptionalPositiveInteger(options.backoffBaseMinutes, "--backoff-base-minutes") }),
          ...(options.backoffMaxMinutes === undefined
            ? {}
            : { backoff_max_minutes: parseOptionalPositiveInteger(options.backoffMaxMinutes, "--backoff-max-minutes") })
        });
        await withDatabase(async (pool) => {
          const validation = assertValidSourceManagementConfig(config, {
            connector_capabilities: listRegisteredSourceCheckConnectorCapabilities()
          });
          const sourcePolicyConfig: SourcePolicyConfig = {
            schema_version: "1.0.0",
            policies: [],
            check_targets: [...config.check_targets]
          };
          const result = await syncSourcePolicyConfig(pool, { config: sourcePolicyConfig, configSource: options.sourcePlan });
          writeJson({
            ok: true,
            schema_version: "1.0.0",
            generated_targets: config.check_targets.length,
            enabled_targets: config.check_targets.filter((target) => target.enabled).length,
            validation_warnings: validation.warnings,
            ...result
          });
        });
      }
    );
  sourcePolicy
    .command("enable-plan-targets")
    .requiredOption("--source-plan <path>", "research-pack source-plan.json")
    .requiredOption("--namespace <name>", "stable namespace used when the plan targets were synced")
    .option("--next-check-at <iso>", "optional target-level initial next_check_at")
    .option("--check-cadence-minutes <minutes>", "optional target-level cadence override")
    .option("--jitter-minutes <minutes>", "optional target-level jitter override")
    .option("--max-attempts <count>", "optional target-level retry limit")
    .option("--backoff-base-minutes <minutes>", "optional target-level retry backoff base")
    .option("--backoff-max-minutes <minutes>", "optional target-level retry backoff max")
    .option("--notes <text>", "optional notes written to enabled targets")
    .description("enable already-synced runnable targets from a research-pack source-plan")
    .action(
      async (options: {
        sourcePlan: string;
        namespace: string;
        nextCheckAt?: string;
        checkCadenceMinutes?: string;
        jitterMinutes?: string;
        maxAttempts?: string;
        backoffBaseMinutes?: string;
        backoffMaxMinutes?: string;
        notes?: string;
      }) => {
        const sourcePlanDocument = parseManagedSourcePlanDocument(await readFile(options.sourcePlan, "utf8"));
        const checkTargetIds = buildSourceCheckTargetIdsFromPlan({
          source_plan: sourcePlanDocument.source_plan,
          namespace: options.namespace
        });
        await withDatabase(async (pool) => {
          const result = await enableSourceCheckTargets(pool, {
            check_target_ids: checkTargetIds,
            config_source: options.sourcePlan,
            ...(options.nextCheckAt === undefined ? {} : { next_check_at: parseIsoDateTime(options.nextCheckAt, "--next-check-at") }),
            ...(options.checkCadenceMinutes === undefined
              ? {}
              : { check_cadence_minutes: parseOptionalPositiveInteger(options.checkCadenceMinutes, "--check-cadence-minutes") }),
            ...(options.jitterMinutes === undefined ? {} : { jitter_minutes: parseOptionalNonNegativeInteger(options.jitterMinutes, "--jitter-minutes") }),
            ...(options.maxAttempts === undefined ? {} : { max_attempts: parseOptionalPositiveInteger(options.maxAttempts, "--max-attempts") }),
            ...(options.backoffBaseMinutes === undefined
              ? {}
              : { backoff_base_minutes: parseOptionalPositiveInteger(options.backoffBaseMinutes, "--backoff-base-minutes") }),
            ...(options.backoffMaxMinutes === undefined
              ? {}
              : { backoff_max_minutes: parseOptionalPositiveInteger(options.backoffMaxMinutes, "--backoff-max-minutes") }),
            ...(options.notes === undefined ? {} : { notes: options.notes })
          });
          writeJson({ ok: true, schema_version: "1.0.0", ...result });
        });
      }
    );

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
          ...(scope === undefined ? {} : { scope }),
          ...(options.type === undefined ? {} : { changeType: options.type }),
          ...(options.source === undefined ? {} : { sourceAdapterId: options.source }),
          attentionOnly: options.attentionOnly
        };
        const changes = await listChangeTimeline(pool, input);
        write(renderChangeTimelineItems(changes, { format: parseFormat(options.format), since: input.since }));
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

function parseTradeDirections(value: string): ("imports" | "exports")[] {
  const directions = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (directions.length === 0) throw new Error("--trade-directions must include imports or exports");
  const unique: ("imports" | "exports")[] = [];
  for (const direction of [...new Set(directions)]) {
    if (direction !== "imports" && direction !== "exports") throw new Error(`Unsupported --trade-directions value: ${direction}`);
    unique.push(direction);
  }
  return unique.sort();
}

async function buildSourceCheckSelectionOptions(options: {
  checkTargetId?: string;
  source?: string;
  sourcePlan?: string;
  namespace?: string;
}): Promise<{ check_target_ids?: string[]; source_adapter_ids?: string[] }> {
  const directCheckTargetIds = options.checkTargetId === undefined ? [] : parseCommaSeparated(options.checkTargetId);
  const planCheckTargetIds =
    options.sourcePlan === undefined
      ? []
      : buildSourceCheckTargetIdsFromPlan({
          source_plan: await readSourcePlanDocument(options.sourcePlan),
          namespace: requireNamespace(options)
        });
  const checkTargetIds = [...new Set([...directCheckTargetIds, ...planCheckTargetIds])].sort();
  const sourceAdapterIds = options.source === undefined ? [] : parseCommaSeparated(options.source).sort();
  if (options.sourcePlan === undefined && options.namespace !== undefined) throw new Error("--namespace requires --source-plan");
  return {
    ...(checkTargetIds.length === 0 ? {} : { check_target_ids: checkTargetIds }),
    ...(sourceAdapterIds.length === 0 ? {} : { source_adapter_ids: sourceAdapterIds })
  };
}

async function readSourcePlanDocument(sourcePlanPath: string): Promise<ReturnType<typeof parseManagedSourcePlanDocument>["source_plan"]> {
  return parseManagedSourcePlanDocument(await readFile(sourcePlanPath, "utf8")).source_plan;
}

function requireNamespace(options: { namespace?: string }): string {
  if (options.namespace === undefined) throw new Error("--source-plan requires --namespace");
  return options.namespace;
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

async function buildManualSourceCheckConfig(options: {
  config?: string;
  configFile?: string;
  cik?: string;
  entity?: string;
  forms?: string;
  year?: string;
  query?: string;
  limit?: string;
}): Promise<Record<string, unknown>> {
  const config = {
    ...(options.configFile === undefined ? {} : parseJsonObject(await readFile(options.configFile, "utf8"), "--config-file")),
    ...(options.config === undefined ? {} : parseJsonObject(options.config, "--config"))
  };
  if (options.cik !== undefined) config["cik"] = options.cik;
  if (options.entity !== undefined) config["entity_id"] = options.entity;
  if (options.forms !== undefined) config["form_types"] = parseCommaSeparated(options.forms);
  if (options.year !== undefined) config["year"] = parseLimit(options.year);
  if (options.query !== undefined) config["query"] = options.query;
  if (options.limit !== undefined) config["limit"] = parseLimit(options.limit);
  return config;
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object`);
  return parsed as Record<string, unknown>;
}

function parseCommaSeparated(value: string): string[] {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (items.length === 0) throw new Error("comma-separated value must include at least one item");
  return [...new Set(items)];
}

function parseOptionalPositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function parseOptionalNonNegativeInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative integer`);
  return parsed;
}

function parseIsoDateTime(value: string, label: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} must be an ISO date/time string`);
  return parsed.toISOString();
}

function renderDueSourceCheckRun(result: DueSourceCheckRunResult): string {
  const lines = [
    "# Due Source Check Run",
    "",
    `Due targets: ${result.due_targets}`,
    `Enqueued jobs: ${result.enqueued_jobs}`,
    `Skipped active jobs: ${result.skipped_active_jobs}`,
    `Claimed jobs: ${result.claimed_jobs}`,
    `Checked targets: ${result.checked_targets}`,
    `Failed targets: ${result.failed_targets}`,
    `Dead jobs: ${result.dead_jobs}`
  ];
  for (const item of result.items) {
    lines.push("", `- ${item.check_target_id} (${item.source_adapter_id})`);
    lines.push(`  Kind: ${item.target_kind}; subject: ${item.subject_entity_id ?? "n/a"}; status: ${item.status}`);
    if (item.job_id !== undefined) lines.push(`  Job: ${item.job_id}`);
    if (item.error_message !== undefined) lines.push(`  Error: ${item.error_message}`);
    lines.push(`  Documents checked: ${item.checked_documents}`);
    for (const summary of item.summaries) {
      lines.push(
        `  - ${summary.change_type} ${summary.doc_id} (${summary.observations} observations, ${summary.semantic_changes} semantic changes, ${summary.relation_changes} relation changes)`
      );
    }
  }
  return lines.join("\n");
}
