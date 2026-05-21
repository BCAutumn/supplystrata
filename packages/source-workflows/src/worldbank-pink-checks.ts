import { saveNormalizedDocumentTx, type DatabaseStore, type DbClient } from "@supplystrata/db";
import { getLogger, messageFromUnknown } from "@supplystrata/observability";
import { storeObservation, type ObservationScopeKind } from "@supplystrata/observation-store";
import { recordSavedDocumentObservation } from "@supplystrata/pipeline";
import { recordSourceFailure } from "@supplystrata/source-monitor";
import { requireConfigString, type SourceCheckConnector } from "@supplystrata/source-connectors";
import {
  createWorldBankPinkAdapterContext,
  parseWorldBankPinkRows,
  worldBankPinkAdapter,
  type WorldBankPinkInput,
  type WorldBankPinkRow
} from "@supplystrata/sources-worldbank-pink";
import type { SourceCheckSummary } from "./source-check-runner.js";

export const worldBankPinkSourceCheckConnector: SourceCheckConnector<DatabaseStore, SourceCheckSummary> = {
  source_adapter_id: "worldbank-pink",
  target_kind: "commodity-price-observation",
  config_schema: {
    fields: [
      { key: "commodity", type: "string", required: true, description: "World Bank Pink Sheet commodity alias, e.g. copper or aluminum." },
      { key: "period", type: "string", required: true, description: "Month in YYYY-MM format." },
      { key: "material_id", type: "string", required: false, description: "Material id that this commodity observation contextualizes." },
      { key: "component_id", type: "string", required: false, description: "Component id that this material observation contextualizes." },
      {
        key: "scope_kind",
        type: "string",
        required: false,
        description: "Observation scope kind.",
        allowed_values: ["company", "component", "facility", "country", "port", "route", "topic"]
      },
      { key: "scope_id", type: "string", required: false, description: "Observation scope id; defaults to component_id, material_id, or commodity." }
    ]
  },
  run(store, target) {
    return runWorldBankPinkSourceCheck(store, worldBankPinkInputFromConfig(target.target_config), {
      checkTargetId: target.check_target_id,
      targetConfig: target.target_config
    });
  }
};

interface WorldBankPinkCheckOptions {
  checkTargetId: string;
  targetConfig: Record<string, unknown>;
}

async function runWorldBankPinkSourceCheck(store: DatabaseStore, input: WorldBankPinkInput, options: WorldBankPinkCheckOptions): Promise<SourceCheckSummary[]> {
  const context = createWorldBankPinkAdapterContext();
  const summaries: SourceCheckSummary[] = [];
  try {
    for await (const task of worldBankPinkAdapter.plan(input, context)) {
      getLogger().info({ stage: "source-check", adapter: worldBankPinkAdapter.id, task_id: task.task_id }, "checking World Bank Pink Sheet source task");
      const raw = await worldBankPinkAdapter.fetch(task, context);
      const normalized = await worldBankPinkAdapter.normalize(raw, context);
      const rows = parseWorldBankPinkRows(raw.body, input);
      const { saved, documentObservation, storedObservations } = await store.transaction(async (client) => {
        const savedDocument = await saveNormalizedDocumentTx(client, normalized);
        const savedObservation = await recordSavedDocumentObservation(client, normalized, savedDocument.doc_id, { checkTargetId: options.checkTargetId });
        const observationCount = await storeCommodityPriceObservations(client, rows, {
          docId: savedDocument.doc_id,
          sourceItemId: savedObservation.source_item_id,
          sourceUrl: normalized.source_url,
          targetConfig: options.targetConfig
        });
        return { saved: savedDocument, documentObservation: savedObservation, storedObservations: observationCount };
      });
      summaries.push({
        source_adapter_id: worldBankPinkAdapter.id,
        task_id: task.task_id,
        doc_id: saved.doc_id,
        source_url: normalized.source_url,
        change_type: documentObservation.change_type,
        source_item_id: documentObservation.source_item_id,
        source_event_id: documentObservation.event_id,
        observations: storedObservations,
        semantic_changes: 0,
        relation_changes: 0
      });
    }
    return summaries;
  } catch (error) {
    await store.transaction(async (client) => {
      await recordSourceFailure(client, {
        source_adapter_id: worldBankPinkAdapter.id,
        check_target_id: options.checkTargetId,
        error_message: messageFromUnknown(error),
        caused_by: "source-check.worldbank-pink"
      });
    });
    throw error;
  }
}

async function storeCommodityPriceObservations(
  client: DbClient,
  rows: readonly WorldBankPinkRow[],
  input: { docId: string; sourceItemId: string; sourceUrl: string; targetConfig: Record<string, unknown> }
): Promise<number> {
  let count = 0;
  for (const row of rows) {
    const materialId = optionalConfigString(input.targetConfig, "material_id", "World Bank Pink source check target");
    const componentId = optionalConfigString(input.targetConfig, "component_id", "World Bank Pink source check target");
    await storeObservation(client, {
      observation_type: "COMMODITY_PRICE_OBSERVATION",
      source_adapter_id: "worldbank-pink",
      source_item_id: input.sourceItemId,
      doc_id: input.docId,
      scope_kind: scopeKindFromConfig(input.targetConfig),
      scope_id: scopeIdFromConfig(input.targetConfig, row),
      ...(componentId === undefined ? {} : { component_id: componentId }),
      metric_name: row.metric_name,
      metric_value: row.price,
      metric_unit: row.unit,
      time_window_start: `${row.period}-01`,
      time_window_end: monthEndDate(row.period),
      confidence: 0.78,
      provenance: {
        source_url: input.sourceUrl,
        commodity: row.commodity,
        commodity_code: row.commodity_code,
        material_id: materialId,
        component_id: componentId,
        no_company_edge: true
      },
      attrs: {
        semantic_layer: "observation",
        observation_policy: "commodity_price_cannot_create_company_edge",
        material_id: materialId,
        commodity_code: row.commodity_code
      }
    });
    count += 1;
  }
  return count;
}

export function worldBankPinkInputFromConfig(config: Record<string, unknown>): WorldBankPinkInput {
  const label = "World Bank Pink source check target";
  const materialId = optionalConfigString(config, "material_id", label);
  const componentId = optionalConfigString(config, "component_id", label);
  const scopeId = optionalConfigString(config, "scope_id", label);
  return {
    commodity: requireConfigString(config, "commodity", label),
    period: requireConfigString(config, "period", label),
    ...(materialId === undefined ? {} : { materialId }),
    ...(componentId === undefined ? {} : { componentId }),
    ...(scopeId === undefined ? {} : { scopeId })
  };
}

function scopeKindFromConfig(config: Record<string, unknown>): ObservationScopeKind {
  const value = optionalConfigString(config, "scope_kind", "World Bank Pink source check target") ?? "component";
  if (
    value === "company" ||
    value === "component" ||
    value === "facility" ||
    value === "country" ||
    value === "port" ||
    value === "route" ||
    value === "topic"
  ) {
    return value;
  }
  throw new Error(`Unsupported World Bank Pink observation scope_kind: ${value}`);
}

function scopeIdFromConfig(config: Record<string, unknown>, row: WorldBankPinkRow): string {
  return (
    optionalConfigString(config, "scope_id", "World Bank Pink source check target") ??
    optionalConfigString(config, "component_id", "World Bank Pink source check target") ??
    optionalConfigString(config, "material_id", "World Bank Pink source check target") ??
    row.commodity_code
  );
}

function optionalConfigString(config: Record<string, unknown>, key: string, label: string): string | undefined {
  const value = config[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} ${key} must be a non-empty string`);
  return value.trim();
}

function monthEndDate(month: string): string {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex)) throw new Error(`Invalid World Bank Pink month: ${month}`);
  return new Date(Date.UTC(year, monthIndex, 0)).toISOString().slice(0, 10);
}
