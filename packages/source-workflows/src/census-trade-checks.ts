import { saveNormalizedDocumentTx, type DatabaseStore, type DbClient } from "@supplystrata/db";
import { findComponentTradeCode, listComponentMaterialExposures } from "@supplystrata/component-context";
import { getLogger, messageFromUnknown } from "@supplystrata/observability";
import { storeObservation, type ObservationScopeKind } from "@supplystrata/observation-store";
import { recordSourceFailure } from "@supplystrata/source-monitor";
import { requireConfigString, type SourceCheckConnector, type SourceCheckConnectorLogger } from "@supplystrata/source-connectors";
import {
  censusTradeAdapter,
  createCensusTradeAdapterContext,
  isCensusTradeDirection,
  parseCensusTradeRows,
  type CensusTradeDirection,
  type CensusTradeInput,
  type CensusTradeRow
} from "@supplystrata/sources-census-trade";
import { recordSavedDocumentObservation } from "@supplystrata/pipeline";
import { sourceWorkflowAdapterContextInput } from "./adapter-context.js";
import type { SourceCheckSummary } from "./source-check-runner.js";
import { CENSUS_TRADE_CREDENTIALS } from "./source-check-credentials.js";

export const censusTradeSourceCheckConnector: SourceCheckConnector<DatabaseStore, SourceCheckSummary> = {
  source_adapter_id: "census-trade",
  target_kind: "trade-flow-observation",
  credential_requirements: CENSUS_TRADE_CREDENTIALS,
  config_schema: {
    fields: [
      { key: "direction", type: "string", required: true, description: "Trade direction.", allowed_values: ["imports", "exports"] },
      { key: "time", type: "string", required: true, description: "Month in YYYY-MM format." },
      { key: "commodity_code", type: "string", required: true, description: "HS or Census commodity code." },
      { key: "country_code", type: "string", required: false, description: "Optional partner country code." },
      { key: "component_id", type: "string", required: false, description: "Component id that this macro observation contextualizes." },
      {
        key: "scope_kind",
        type: "string",
        required: false,
        description: "Observation scope kind.",
        allowed_values: ["company", "component", "facility", "country", "port", "route", "topic"]
      },
      { key: "scope_id", type: "string", required: false, description: "Observation scope id; defaults to component_id or commodity code." }
    ]
  },
  run(store, target, context) {
    return runCensusTradeSourceCheck(store, censusTradeInputFromConfig(target.target_config), {
      checkTargetId: target.check_target_id,
      targetConfig: target.target_config,
      ...(context.logger === undefined ? {} : { logger: context.logger })
    });
  }
};

interface CensusTradeCheckOptions {
  checkTargetId: string;
  targetConfig: Record<string, unknown>;
  logger?: SourceCheckConnectorLogger;
}

async function runCensusTradeSourceCheck(store: DatabaseStore, input: CensusTradeInput, options: CensusTradeCheckOptions): Promise<SourceCheckSummary[]> {
  const context = createCensusTradeAdapterContext(sourceWorkflowAdapterContextInput());
  const summaries: SourceCheckSummary[] = [];
  const logger = options.logger ?? getLogger();
  try {
    for await (const task of censusTradeAdapter.plan(input, context)) {
      logger.info({ stage: "source-check", adapter: censusTradeAdapter.id, task_id: task.task_id }, "checking Census trade source task");
      const raw = await censusTradeAdapter.fetch(task, context);
      const normalized = await censusTradeAdapter.normalize(raw, context);
      const rows = parseCensusTradeRows(raw.body, input.direction);
      const { saved, documentObservation, storedObservations } = await store.transaction(async (client) => {
        const savedDocument = await saveNormalizedDocumentTx(client, normalized);
        const savedObservation = await recordSavedDocumentObservation(client, normalized, savedDocument.doc_id, { checkTargetId: options.checkTargetId });
        const observationCount = await storeTradeFlowObservations(client, rows, {
          docId: savedDocument.doc_id,
          sourceItemId: savedObservation.source_item_id,
          sourceUrl: normalized.source_url,
          targetConfig: options.targetConfig
        });
        return { saved: savedDocument, documentObservation: savedObservation, storedObservations: observationCount };
      });
      summaries.push({
        source_adapter_id: censusTradeAdapter.id,
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
        source_adapter_id: censusTradeAdapter.id,
        check_target_id: options.checkTargetId,
        error_message: messageFromUnknown(error),
        caused_by: "source-check.census-trade"
      });
    });
    throw error;
  }
}

async function storeTradeFlowObservations(
  client: DbClient,
  rows: readonly CensusTradeRow[],
  input: { docId: string; sourceItemId: string; sourceUrl: string; targetConfig: Record<string, unknown> }
): Promise<number> {
  let count = 0;
  const componentId = componentIdFromConfig(input.targetConfig);
  for (const row of rows) {
    const taxonomyContext = componentTradeObservationContext(componentId, row.commodity_code);
    // Census Trade 是宏观观测源：只能落 observation，不能在这里升级成公司级事实边。
    await storeObservation(client, {
      observation_type: "TRADE_FLOW_OBSERVATION",
      source_adapter_id: "census-trade",
      source_item_id: input.sourceItemId,
      doc_id: input.docId,
      scope_kind: scopeKindFromConfig(input.targetConfig),
      scope_id: scopeIdFromConfig(input.targetConfig, row),
      ...(row.country_code === undefined ? {} : { geography_kind: "country", geography_id: row.country_code }),
      ...(componentId === undefined ? {} : { component_id: componentId }),
      metric_name: metricNameForRow(row),
      metric_value: row.value_usd,
      metric_unit: "USD",
      time_window_start: `${row.time}-01`,
      time_window_end: monthEndDate(row.time),
      confidence: 0.82,
      provenance: {
        source_url: input.sourceUrl,
        commodity_code: row.commodity_code,
        commodity_description: row.commodity_description,
        country_code: row.country_code,
        country_name: row.country_name,
        direction: row.direction,
        no_company_edge: true,
        component_hs_proxy: taxonomyContext.isProxy,
        component_hs_code_description: taxonomyContext.description,
        component_hs_code_confidence: taxonomyContext.confidence,
        component_hs_code_notes: taxonomyContext.notes,
        component_material_ids: taxonomyContext.materialIds
      },
      attrs: {
        semantic_layer: "observation",
        observation_policy: "macro_trade_flow_cannot_create_company_edge",
        ...(taxonomyContext.isProxy ? { component_trade_taxonomy: "matched" } : { component_trade_taxonomy: "unmatched" })
      }
    });
    count += 1;
  }
  return count;
}

function componentTradeObservationContext(
  componentId: string | undefined,
  commodityCode: string
): {
  isProxy: boolean;
  description: string | null;
  confidence: number | null;
  notes: string | null;
  materialIds: string[];
} {
  if (componentId === undefined) {
    return { isProxy: false, description: null, confidence: null, notes: null, materialIds: [] };
  }
  const code = findComponentTradeCode(componentId, commodityCode);
  if (code === undefined) {
    return {
      isProxy: false,
      description: null,
      confidence: null,
      notes: null,
      materialIds: listComponentMaterialExposures(componentId).map((item) => item.material_id)
    };
  }
  return {
    isProxy: code.proxy_only,
    description: code.description,
    confidence: code.confidence,
    notes: code.notes,
    materialIds: listComponentMaterialExposures(componentId).map((item) => item.material_id)
  };
}

export function censusTradeInputFromConfig(config: Record<string, unknown>): CensusTradeInput {
  const label = "Census Trade source check target";
  const direction = censusDirectionFromConfig(config);
  const countryCode = optionalConfigString(config, "country_code", label);
  const componentId = optionalConfigString(config, "component_id", label);
  const scopeId = optionalConfigString(config, "scope_id", label);
  return {
    direction,
    time: requireConfigString(config, "time", label),
    commodityCode: requireConfigString(config, "commodity_code", label),
    ...(countryCode === undefined ? {} : { countryCode }),
    ...(componentId === undefined ? {} : { componentId }),
    ...(scopeId === undefined ? {} : { scopeId })
  };
}

function censusDirectionFromConfig(config: Record<string, unknown>): CensusTradeDirection {
  const value = requireConfigString(config, "direction", "Census Trade source check target");
  if (!isCensusTradeDirection(value)) throw new Error(`Census Trade direction must be imports or exports: ${value}`);
  return value;
}

function scopeKindFromConfig(config: Record<string, unknown>): ObservationScopeKind {
  const value = optionalConfigString(config, "scope_kind", "Census Trade source check target") ?? "component";
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
  throw new Error(`Unsupported Census Trade observation scope_kind: ${value}`);
}

function scopeIdFromConfig(config: Record<string, unknown>, row: CensusTradeRow): string {
  return optionalConfigString(config, "scope_id", "Census Trade source check target") ?? componentIdFromConfig(config) ?? row.commodity_code;
}

function componentIdFromConfig(config: Record<string, unknown>): string | undefined {
  return optionalConfigString(config, "component_id", "Census Trade source check target");
}

function metricNameForRow(row: CensusTradeRow): string {
  return `census_trade.${row.direction}.hs.${row.metric_name}`;
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
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex)) throw new Error(`Invalid Census Trade month: ${month}`);
  return new Date(Date.UTC(year, monthIndex, 0)).toISOString().slice(0, 10);
}
