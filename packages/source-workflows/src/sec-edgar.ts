import { saveNormalizedDocumentTx, type DatabaseStore, type DbTxClient } from "@supplystrata/db/write";
import { storeObservation } from "@supplystrata/observation-store";
import { messageFromUnknown, noopLogger } from "@supplystrata/observability";
import { recordSourceFailure } from "@supplystrata/source-monitor";
import {
  optionalConfigPositiveInteger,
  requireConfigString,
  requireConfigStringArray,
  type SourceCheckAdapterContextInput,
  type SourceCheckConnector,
  type SourceCheckConnectorLogger
} from "@supplystrata/source-connectors";
import {
  createAdapterContext,
  isSecEdgarFormType,
  parseSecCompanyFactObservations,
  secCompanyFactsAdapter,
  secEdgarAdapter,
  SEC_COMPANY_FACT_METRIC_NAMES,
  type SecCompanyFactMetricName,
  type SecCompanyFactObservationDraft,
  type SecCompanyFactsInput,
  type SecEdgarFormType,
  type SecEdgarInput
} from "@supplystrata/sources-sec-edgar";
import { runSourceAdapterCheck, type SourceCheckSummary } from "./source-check-runner.js";
import { recordSavedDocumentObservation } from "./saved-document-observation.js";
import { documentObservationStoreOption } from "./document-observation-context.js";
import type { SourceDocumentObservationStore } from "./document-observation-port.js";

export interface SourceCheckOptions {
  checkTargetId?: string;
  adapterContextInput: SourceCheckAdapterContextInput;
  documentObservationStore?: SourceDocumentObservationStore;
  logger?: SourceCheckConnectorLogger;
}

export const secEdgarSourceCheckConnector: SourceCheckConnector<DatabaseStore, SourceCheckSummary> = {
  source_adapter_id: "sec-edgar",
  target_kind: "sec-company-filings",
  config_schema: {
    fields: [
      { key: "cik", type: "string", required: true, description: "SEC CIK without punctuation." },
      { key: "entity_id", type: "string", required: true, description: "Primary SupplyStrata entity id for the filer." },
      { key: "form_types", type: "string_array", required: true, description: "SEC form types to monitor.", allowed_values: ["10-K", "10-Q", "20-F", "8-K"] },
      { key: "limit", type: "positive_integer", required: false, description: "Maximum filings to fetch per check." }
    ]
  },
  run(store, target, context) {
    return checkSecEdgarSource(store, secEdgarInputFromTargetConfig(target.target_config), {
      checkTargetId: target.check_target_id,
      adapterContextInput: context.adapter_context_input,
      ...documentObservationStoreOption(context),
      ...(context.logger === undefined ? {} : { logger: context.logger })
    });
  }
};

export const secCompanyFactsSourceCheckConnector: SourceCheckConnector<DatabaseStore, SourceCheckSummary> = {
  source_adapter_id: "sec-edgar",
  target_kind: "sec-company-facts",
  config_schema: {
    fields: [
      { key: "cik", type: "string", required: true, description: "SEC CIK without punctuation." },
      { key: "entity_id", type: "string", required: true, description: "Primary SupplyStrata entity id for the filer." },
      {
        key: "metrics",
        type: "string_array",
        required: false,
        description: "Optional financial metrics to keep.",
        allowed_values: SEC_COMPANY_FACT_METRIC_NAMES
      },
      { key: "max_periods", type: "positive_integer", required: false, description: "Maximum periods to keep per metric." }
    ]
  },
  run(store, target, context) {
    return checkSecCompanyFactsSource(store, secCompanyFactsInputFromTargetConfig(target.target_config), {
      checkTargetId: target.check_target_id,
      adapterContextInput: context.adapter_context_input,
      ...documentObservationStoreOption(context),
      ...(context.logger === undefined ? {} : { logger: context.logger })
    });
  }
};

export async function checkSecEdgarSource(store: DatabaseStore, input: SecEdgarInput, options: SourceCheckOptions): Promise<SourceCheckSummary[]> {
  const context = createAdapterContext(options.adapterContextInput);
  return runSourceAdapterCheck(store, {
    adapter: secEdgarAdapter,
    adapterInput: input,
    context,
    options: { ...options, failureCausedBy: "source-check.sec-edgar" }
  });
}

export async function checkSecCompanyFactsSource(
  store: DatabaseStore,
  input: SecCompanyFactsInput,
  options: SourceCheckOptions
): Promise<SourceCheckSummary[]> {
  const context = createAdapterContext(options.adapterContextInput);
  const summaries: SourceCheckSummary[] = [];
  const logger = options.logger ?? noopLogger;
  try {
    for await (const task of secCompanyFactsAdapter.plan(input, context)) {
      logger.info({ stage: "source-check", adapter: secCompanyFactsAdapter.id, task_id: task.task_id }, "checking SEC company facts source task");
      const raw = await secCompanyFactsAdapter.fetch(task, context);
      const normalized = await secCompanyFactsAdapter.normalize(raw, context);
      const facts = parseSecCompanyFactObservations(raw.body, {
        ...(input.metrics === undefined ? {} : { metrics: input.metrics }),
        ...(input.maxPeriods === undefined ? {} : { maxPeriods: input.maxPeriods })
      });
      const { saved, documentObservation, storedObservations } = await store.transaction(async (client) => {
        const savedDocument = await saveNormalizedDocumentTx(client, normalized);
        const savedObservation = await recordSavedDocumentObservation(client, normalized, savedDocument.doc_id, {
          ...(options.checkTargetId === undefined ? {} : { checkTargetId: options.checkTargetId })
        });
        const observationCount = await storeSecCompanyFactObservations(client, facts, {
          entityId: input.entityId,
          docId: savedDocument.doc_id,
          sourceItemId: savedObservation.source_item_id,
          sourceUrl: normalized.source_url
        });
        return { saved: savedDocument, documentObservation: savedObservation, storedObservations: observationCount };
      });
      summaries.push({
        source_adapter_id: secCompanyFactsAdapter.id,
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
        source_adapter_id: secCompanyFactsAdapter.id,
        ...(options.checkTargetId === undefined ? {} : { check_target_id: options.checkTargetId }),
        error_message: messageFromUnknown(error),
        caused_by: "source-check.sec-company-facts"
      });
    });
    throw error;
  }
}

export function secEdgarInputFromTargetConfig(config: Record<string, unknown>): SecEdgarInput {
  const label = "SEC source check target";
  const cik = requireConfigString(config, "cik", label);
  const entityId = requireConfigString(config, "entity_id", label);
  const formTypes = requireSecForms(config);
  const limit = optionalConfigPositiveInteger(config, "limit", label);
  return {
    cik,
    entityId,
    formTypes,
    ...(limit === undefined ? {} : { limit })
  };
}

export function secCompanyFactsInputFromTargetConfig(config: Record<string, unknown>): SecCompanyFactsInput {
  const label = "SEC company facts source check target";
  const metrics = optionalSecCompanyFactMetrics(config);
  const maxPeriods = optionalConfigPositiveInteger(config, "max_periods", label);
  return {
    cik: requireConfigString(config, "cik", label),
    entityId: requireConfigString(config, "entity_id", label),
    ...(metrics === undefined ? {} : { metrics }),
    ...(maxPeriods === undefined ? {} : { maxPeriods })
  };
}

function requireSecForms(config: Record<string, unknown>): SecEdgarFormType[] {
  const forms: SecEdgarFormType[] = [];
  for (const item of requireConfigStringArray(config, "form_types", "SEC source check target")) {
    if (!isSecEdgarFormType(item)) throw new Error(`Unsupported SEC source check form type: ${item}`);
    forms.push(item);
  }
  return [...new Set(forms)];
}

async function storeSecCompanyFactObservations(
  client: DbTxClient,
  observations: readonly SecCompanyFactObservationDraft[],
  input: { entityId: string; docId: string; sourceItemId: string; sourceUrl: string }
): Promise<number> {
  let count = 0;
  for (const observation of observations) {
    await storeObservation(client, {
      observation_type: observation.observation_type,
      source_adapter_id: "sec-edgar",
      source_item_id: input.sourceItemId,
      doc_id: input.docId,
      scope_kind: "company",
      scope_id: input.entityId,
      metric_name: observation.metric_name,
      metric_value: observation.metric_value,
      metric_unit: observation.metric_unit,
      ...(observation.time_window_start === undefined ? {} : { time_window_start: observation.time_window_start }),
      time_window_end: observation.time_window_end,
      ...(observation.baseline_value === undefined ? {} : { baseline_value: observation.baseline_value }),
      ...(observation.change_value === undefined ? {} : { change_value: observation.change_value }),
      ...(observation.change_percent === undefined ? {} : { change_percent: observation.change_percent }),
      confidence: observation.confidence,
      provenance: {
        ...observation.provenance,
        source_url: input.sourceUrl
      },
      attrs: observation.attrs
    });
    count += 1;
  }
  return count;
}

function optionalSecCompanyFactMetrics(config: Record<string, unknown>): SecCompanyFactMetricName[] | undefined {
  const value = config["metrics"];
  if (value === undefined) return undefined;
  const metrics: SecCompanyFactMetricName[] = [];
  for (const item of requireConfigStringArray(config, "metrics", "SEC company facts source check target")) {
    if (!isSecCompanyFactMetricName(item)) throw new Error(`Unsupported SEC company facts metric: ${item}`);
    metrics.push(item);
  }
  return [...new Set(metrics)];
}

function isSecCompanyFactMetricName(value: string): value is SecCompanyFactMetricName {
  return SEC_COMPANY_FACT_METRIC_NAMES.some((metric) => metric === value);
}
