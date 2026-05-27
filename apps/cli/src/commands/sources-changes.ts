import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import { loadEnv } from "@supplystrata/config";
import { listChangeTimeline } from "@supplystrata/db/read";
import { persistDocumentObservations } from "@supplystrata/pipeline";
import {
  listRegisteredSourceCheckConnectorCapabilities,
  listSourceCheckConnectorIds,
  runDueSourceChecks,
  runManualSourceCheck,
  runSourcePlanConnectivitySmoke
} from "@supplystrata/source-workflows";
import {
  assertValidSourceManagementConfig,
  buildSourceManagementCatalog,
  buildSourcePolicyConfigFromPlanTargets,
  previewSourceCheckTargetsFromPlan
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
import {
  defaultSince,
  parseChangeScope,
  parseCommaSeparated,
  parseFormat,
  parseLimit,
  parseSince,
  parseTradeDirections,
  withDatabase,
  write,
  writeJson
} from "../cli-utils.js";
import { currentIsoTimestamp } from "../cli-clock.js";
import {
  buildManualSourceCheckConfig,
  buildSourceCheckTargetIdsFromSourcePlanFile,
  buildSourceCheckSelectionOptions,
  parseSourceCheckScheduleOptions,
  readSourcePlanDocument
} from "../source-check-options.js";
import {
  renderDueSourceCheckRun,
  renderDueSources,
  renderSourceCheckSummary,
  renderSourceHealth,
  renderSourceManagementCatalog,
  renderSourcePlan,
  renderSourcePlanSmokeReport,
  renderSourcePlanTargetPreview,
  renderSourcesList
} from "../source-render.js";

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
        const result = await pool.transaction((client) => syncSourceHealthRegistry(client));
        writeJson({ ok: true, ...result });
      });
    });
  sources
    .command("health")
    .option("--format <format>", "markdown or json", "markdown")
    .description("show source monitoring health from Postgres")
    .action(async (options: { format: string }) => {
      await withDatabase(async (pool) => {
        const health = await listSourceHealthRows(pool.read);
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
        const due = await listDueSourceChecks(pool.read, { limit: parseLimit(options.limit), now: currentIsoTimestamp(), ...selection });
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
        const result = await runDueSourceChecks(pool, {
          env: loadEnv(),
          limit: parseLimit(options.limit),
          now: currentIsoTimestamp(),
          documentObservationStore: { persistDocumentObservations },
          ...selection
        });
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
          const summaries = await runManualSourceCheck(
            pool,
            {
              source_adapter_id: options.source,
              ...(options.targetKind === undefined ? {} : { target_kind: options.targetKind }),
              target_config: targetConfig
            },
            { env: loadEnv(), checkedAt: currentIsoTimestamp(), documentObservationStore: { persistDocumentObservations } }
          );
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
        const result = await pool.transaction((client) => syncSourcePolicyConfig(client, { config, configSource: options.file }));
        writeJson({ ok: true, validation_warnings: validation.warnings, ...result });
      });
    });
  sourcePolicy
    .command("preview-plan-targets")
    .requiredOption("--source-plan <path>", "research-pack source-plan.json")
    .requiredOption("--namespace <name>", "stable namespace for generated check_target_id values, e.g. nvidia-memory-2025")
    .option("--source <ids>", "comma-separated source adapter ids to include")
    .option("--check-target-id <ids>", "comma-separated generated check_target_id values to include")
    .option("--enable", "preview generated targets as enabled", false)
    .option("--next-check-at <iso>", "optional initial next_check_at for generated targets")
    .option("--check-cadence-minutes <minutes>", "optional target-level cadence override")
    .option("--jitter-minutes <minutes>", "optional target-level jitter override")
    .option("--max-attempts <count>", "optional target-level retry limit")
    .option("--backoff-base-minutes <minutes>", "optional target-level retry backoff base")
    .option("--backoff-max-minutes <minutes>", "optional target-level retry backoff max")
    .option("--format <format>", "markdown or json", "markdown")
    .description("preview runnable target suggestions from a research-pack source-plan without writing source_check_targets")
    .action(
      async (options: {
        sourcePlan: string;
        namespace: string;
        source?: string;
        checkTargetId?: string;
        enable: boolean;
        nextCheckAt?: string;
        checkCadenceMinutes?: string;
        jitterMinutes?: string;
        maxAttempts?: string;
        backoffBaseMinutes?: string;
        backoffMaxMinutes?: string;
        format: string;
      }) => {
        const sourcePlanDocument = await readSourcePlanDocument(options.sourcePlan);
        const report = previewSourceCheckTargetsFromPlan({
          source_plan: sourcePlanDocument.source_plan,
          namespace: options.namespace,
          enabled: options.enable,
          connector_capabilities: listRegisteredSourceCheckConnectorCapabilities(),
          ...(options.source === undefined ? {} : { source_adapter_ids: parseCommaSeparated(options.source) }),
          ...(options.checkTargetId === undefined ? {} : { check_target_ids: parseCommaSeparated(options.checkTargetId) }),
          ...parseSourceCheckScheduleOptions(options)
        });
        write(renderSourcePlanTargetPreview(report, parseFormat(options.format)));
      }
    );
  sourcePolicy
    .command("smoke-plan-targets")
    .requiredOption("--source-plan <path>", "research-pack source-plan.json")
    .requiredOption("--namespace <name>", "stable namespace for generated check_target_id values, e.g. nvidia-memory-2025")
    .option("--source <ids>", "comma-separated source adapter ids to include")
    .option("--limit <count>", "max generated targets to smoke test")
    .option("--format <format>", "markdown or json", "markdown")
    .description("run source-plan target plan/fetch/normalize smoke tests without writing Postgres")
    .action(async (options: { sourcePlan: string; namespace: string; source?: string; limit?: string; format: string }) => {
      const sourcePlanDocument = await readSourcePlanDocument(options.sourcePlan);
      const preview = previewSourceCheckTargetsFromPlan({
        source_plan: sourcePlanDocument.source_plan,
        namespace: options.namespace,
        connector_capabilities: listRegisteredSourceCheckConnectorCapabilities()
      });
      if (!preview.validation.ok) throw new Error(`source-plan targets are invalid: ${preview.validation.errors.map((issue) => issue.message).join("; ")}`);
      const report = await runSourcePlanConnectivitySmoke({
        env: loadEnv(),
        targets: preview.config.check_targets,
        checkedAt: currentIsoTimestamp(),
        ...(options.source === undefined ? {} : { source_adapter_ids: parseCommaSeparated(options.source) }),
        ...(options.limit === undefined ? {} : { limit: parseLimit(options.limit) })
      });
      write(renderSourcePlanSmokeReport(report, parseFormat(options.format)));
    });
  sourcePolicy
    .command("sync-plan-targets")
    .requiredOption("--source-plan <path>", "research-pack source-plan.json")
    .requiredOption("--namespace <name>", "stable namespace for generated check_target_id values, e.g. nvidia-memory-2025")
    .option("--source <ids>", "comma-separated source adapter ids to include")
    .option("--check-target-id <ids>", "comma-separated generated check_target_id values to include")
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
        source?: string;
        checkTargetId?: string;
        enable: boolean;
        nextCheckAt?: string;
        checkCadenceMinutes?: string;
        jitterMinutes?: string;
        maxAttempts?: string;
        backoffBaseMinutes?: string;
        backoffMaxMinutes?: string;
      }) => {
        const sourcePlanDocument = await readSourcePlanDocument(options.sourcePlan);
        const config = buildSourcePolicyConfigFromPlanTargets({
          source_plan: sourcePlanDocument.source_plan,
          namespace: options.namespace,
          enabled: options.enable,
          ...(options.source === undefined ? {} : { source_adapter_ids: parseCommaSeparated(options.source) }),
          ...(options.checkTargetId === undefined ? {} : { check_target_ids: parseCommaSeparated(options.checkTargetId) }),
          ...parseSourceCheckScheduleOptions(options)
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
          const result = await pool.transaction((client) => syncSourcePolicyConfig(client, { config: sourcePolicyConfig, configSource: options.sourcePlan }));
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
    .option("--source <ids>", "comma-separated source adapter ids to include")
    .option("--check-target-id <ids>", "comma-separated generated check_target_id values to include")
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
        source?: string;
        checkTargetId?: string;
        nextCheckAt?: string;
        checkCadenceMinutes?: string;
        jitterMinutes?: string;
        maxAttempts?: string;
        backoffBaseMinutes?: string;
        backoffMaxMinutes?: string;
        notes?: string;
      }) => {
        const checkTargetIds = await buildSourceCheckTargetIdsFromSourcePlanFile({
          sourcePlan: options.sourcePlan,
          namespace: options.namespace,
          ...(options.source === undefined ? {} : { sourceAdapterIds: parseCommaSeparated(options.source) }),
          ...(options.checkTargetId === undefined ? {} : { checkTargetIds: parseCommaSeparated(options.checkTargetId) })
        });
        await withDatabase(async (pool) => {
          const result = await pool.transaction((client) =>
            enableSourceCheckTargets(client, {
              check_target_ids: checkTargetIds,
              config_source: options.sourcePlan,
              ...parseSourceCheckScheduleOptions(options),
              ...(options.notes === undefined ? {} : { notes: options.notes })
            })
          );
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
        const changes = await listChangeTimeline(pool.read, input);
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
