import { messageFromUnknown } from "@supplystrata/observability";
import type { FetchTask, NormalizedDocument, RawDocument } from "@supplystrata/core";
import type { AdapterContext, SourceAdapter } from "@supplystrata/source-adapter-spec";
import { connectorKey } from "@supplystrata/source-connectors";
import { appleSuppliersAdapter, createAppleSuppliersAdapterContext } from "@supplystrata/sources-apple-suppliers";
import { censusTradeAdapter, createCensusTradeAdapterContext } from "@supplystrata/sources-census-trade";
import { createOshAdapterContext, oshAdapter } from "@supplystrata/sources-osh";
import { createAdapterContext as createSecAdapterContext, secCompanyFactsAdapter, secEdgarAdapter } from "@supplystrata/sources-sec-edgar";
import { createWorldBankPinkAdapterContext, worldBankPinkAdapter } from "@supplystrata/sources-worldbank-pink";
import { appleSupplierInputFromConfig } from "./apple-suppliers.js";
import { censusTradeInputFromConfig } from "./census-trade-checks.js";
import { createDartKrAdapterContext, dartKrAdapter, dartKrCompanyFilingsInputFromConfig } from "./dart-kr-checks.js";
import { createEdinetAdapterContext, edinetAdapter, edinetDailyFilingsInputFromConfig } from "./edinet-checks.js";
import {
  asmlIrAdapter,
  companyIrExplicitUrlAdapter,
  createOfficialIrAdapterContext,
  micronIrAdapter,
  samsungIrAdapter,
  skHynixIrAdapter,
  tsmcIrAdapter
} from "./official-ir-adapters.js";
import {
  asmlIrInputFromConfig,
  companyIrExplicitUrlInputFromConfig,
  micronIrInputFromConfig,
  samsungIrInputFromConfig,
  skHynixIrInputFromConfig,
  tsmcIrInputFromConfig
} from "./official-ir-checks.js";
import { oshInputFromConfig } from "./osh-checks.js";
import { secCompanyFactsInputFromTargetConfig, secEdgarInputFromTargetConfig } from "./sec-edgar.js";
import { createTwseMopsAdapterContext, twseMopsAdapter, twseMopsElectronicDocumentsInputFromConfig } from "./twse-mops-checks.js";
import { worldBankPinkInputFromConfig } from "./worldbank-pink-checks.js";

export interface SourcePlanSmokeTarget {
  check_target_id: string;
  source_adapter_id: string;
  target_kind: string;
  target_config: Record<string, unknown>;
}

export interface SourcePlanSmokeInput {
  targets: readonly SourcePlanSmokeTarget[];
  source_adapter_ids?: readonly string[];
  limit?: number;
}

export type SourcePlanSmokeTargetStatus = "checked" | "failed" | "skipped";
export type SourcePlanSmokeIssueKind =
  | "missing_credentials"
  | "target_config_invalid"
  | "connector_unsupported"
  | "source_unreachable"
  | "source_response_error"
  | "adapter_error";

export interface SourcePlanSmokeDocument {
  task_id: string;
  source_url: string;
  doc_id: string;
  document_type?: string;
  source_date?: string;
  source_fetch_status?: "live" | "fallback";
  text_chars?: number;
  chunks?: number;
}

export interface SourcePlanSmokeItem {
  check_target_id: string;
  source_adapter_id: string;
  target_kind: string;
  status: SourcePlanSmokeTargetStatus;
  planned_tasks: number;
  fetched_documents: number;
  normalized_documents: number;
  degraded_documents: number;
  documents: readonly SourcePlanSmokeDocument[];
  issue_kind?: SourcePlanSmokeIssueKind;
  error_message?: string;
}

export interface SourcePlanSmokeSummary {
  requested_targets: number;
  selected_targets: number;
  checked_targets: number;
  failed_targets: number;
  skipped_targets: number;
  planned_tasks: number;
  fetched_documents: number;
  normalized_documents: number;
  degraded_documents: number;
  by_source: Record<string, number>;
  by_source_status: Record<string, SourcePlanSmokeSourceSummary>;
}

export interface SourcePlanSmokeSourceSummary {
  selected_targets: number;
  checked_targets: number;
  failed_targets: number;
  skipped_targets: number;
  planned_tasks: number;
  fetched_documents: number;
  normalized_documents: number;
  degraded_documents: number;
  target_kinds: Record<string, number>;
  issue_kinds: Record<string, number>;
}

export interface SourcePlanSmokeReport {
  schema_version: "1.0.0";
  summary: SourcePlanSmokeSummary;
  items: readonly SourcePlanSmokeItem[];
}

interface SourcePlanSmokeRunner {
  source_adapter_id: string;
  target_kind: string;
  run(target: SourcePlanSmokeTarget): Promise<SourcePlanSmokeItem>;
}

export async function runSourcePlanConnectivitySmoke(input: SourcePlanSmokeInput): Promise<SourcePlanSmokeReport> {
  const selectedTargets = selectSourcePlanSmokeTargets(input);
  const items: SourcePlanSmokeItem[] = [];
  for (const target of selectedTargets) {
    const runner = findSmokeRunner(target);
    if (runner === undefined) {
      items.push(skippedSmokeItem(target, `Unsupported source-plan smoke target: ${connectorKey(target)}`));
      continue;
    }
    try {
      items.push(await runner.run(target));
    } catch (error) {
      items.push(failedSmokeItem(target, error, { plannedTasks: 0, fetchedDocuments: 0, normalizedDocuments: 0, degradedDocuments: 0, documents: [] }));
    }
  }
  return {
    schema_version: "1.0.0",
    summary: summarizeSmokeItems(input.targets.length, selectedTargets.length, items),
    items
  };
}

// 这里刻意只做选择，不触碰 adapter；这样 CLI/host app 可以先审计本轮会访问哪些外部源。
export function selectSourcePlanSmokeTargets(input: SourcePlanSmokeInput): SourcePlanSmokeTarget[] {
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1)) throw new Error("source-plan smoke limit must be a positive integer");
  const sourceIds = input.source_adapter_ids === undefined ? undefined : new Set(input.source_adapter_ids);
  const selected = sourceIds === undefined ? [...input.targets] : input.targets.filter((target) => sourceIds.has(target.source_adapter_id));
  return input.limit === undefined ? selected : selected.slice(0, input.limit);
}

const SMOKE_RUNNERS: readonly SourcePlanSmokeRunner[] = [
  createSmokeRunner({
    source_adapter_id: "apple-suppliers",
    target_kind: "supplier-list-review",
    adapter: appleSuppliersAdapter,
    inputFromConfig: appleSupplierInputFromConfig,
    createContext: createAppleSuppliersAdapterContext
  }),
  createSmokeRunner({
    source_adapter_id: "dart-kr",
    target_kind: "company-filings",
    adapter: dartKrAdapter,
    inputFromConfig: dartKrCompanyFilingsInputFromConfig,
    createContext: createDartKrAdapterContext
  }),
  createSmokeRunner({
    source_adapter_id: "edinet",
    target_kind: "daily-filings",
    adapter: edinetAdapter,
    inputFromConfig: edinetDailyFilingsInputFromConfig,
    createContext: createEdinetAdapterContext
  }),
  createSmokeRunner({
    source_adapter_id: "twse-mops",
    target_kind: "electronic-documents",
    adapter: twseMopsAdapter,
    inputFromConfig: twseMopsElectronicDocumentsInputFromConfig,
    createContext: createTwseMopsAdapterContext
  }),
  createSmokeRunner({
    source_adapter_id: "sec-edgar",
    target_kind: "sec-company-filings",
    adapter: secEdgarAdapter,
    inputFromConfig: secEdgarInputFromTargetConfig,
    createContext: createSecAdapterContext
  }),
  createSmokeRunner({
    source_adapter_id: "sec-edgar",
    target_kind: "sec-company-facts",
    adapter: secCompanyFactsAdapter,
    inputFromConfig: secCompanyFactsInputFromTargetConfig,
    createContext: createSecAdapterContext
  }),
  createSmokeRunner({
    source_adapter_id: "company-ir",
    target_kind: "official-html-disclosure",
    adapter: companyIrExplicitUrlAdapter,
    inputFromConfig: companyIrExplicitUrlInputFromConfig,
    createContext: createOfficialIrAdapterContext
  }),
  createSmokeRunner({
    source_adapter_id: "tsmc-ir",
    target_kind: "official-html-disclosure",
    adapter: tsmcIrAdapter,
    inputFromConfig: tsmcIrInputFromConfig,
    createContext: createOfficialIrAdapterContext
  }),
  createSmokeRunner({
    source_adapter_id: "samsung-ir",
    target_kind: "official-html-disclosure",
    adapter: samsungIrAdapter,
    inputFromConfig: samsungIrInputFromConfig,
    createContext: createOfficialIrAdapterContext
  }),
  createSmokeRunner({
    source_adapter_id: "skhynix-ir",
    target_kind: "official-html-disclosure",
    adapter: skHynixIrAdapter,
    inputFromConfig: skHynixIrInputFromConfig,
    createContext: createOfficialIrAdapterContext
  }),
  createSmokeRunner({
    source_adapter_id: "asml-ir",
    target_kind: "official-html-disclosure",
    adapter: asmlIrAdapter,
    inputFromConfig: asmlIrInputFromConfig,
    createContext: createOfficialIrAdapterContext
  }),
  createSmokeRunner({
    source_adapter_id: "micron-ir",
    target_kind: "official-html-disclosure",
    adapter: micronIrAdapter,
    inputFromConfig: micronIrInputFromConfig,
    createContext: createOfficialIrAdapterContext
  }),
  createSmokeRunner({
    source_adapter_id: "census-trade",
    target_kind: "trade-flow-observation",
    adapter: censusTradeAdapter,
    inputFromConfig: censusTradeInputFromConfig,
    createContext: createCensusTradeAdapterContext
  }),
  createSmokeRunner({
    source_adapter_id: "osh",
    target_kind: "facility-search",
    adapter: oshAdapter,
    inputFromConfig: oshInputFromConfig,
    createContext: createOshAdapterContext
  }),
  createSmokeRunner({
    source_adapter_id: "worldbank-pink",
    target_kind: "commodity-price-observation",
    adapter: worldBankPinkAdapter,
    inputFromConfig: worldBankPinkInputFromConfig,
    createContext: createWorldBankPinkAdapterContext
  })
];

function createSmokeRunner<TInput>(input: {
  source_adapter_id: string;
  target_kind: string;
  adapter: SourceAdapter<TInput, Uint8Array>;
  inputFromConfig(config: Record<string, unknown>): TInput;
  createContext(): AdapterContext;
}): SourcePlanSmokeRunner {
  return {
    source_adapter_id: input.source_adapter_id,
    target_kind: input.target_kind,
    run(target) {
      return runSourceTargetSmoke({
        target,
        adapter: input.adapter,
        adapterInput: input.inputFromConfig(target.target_config),
        context: input.createContext()
      });
    }
  };
}

async function runSourceTargetSmoke<TInput>(input: {
  target: SourcePlanSmokeTarget;
  adapter: SourceAdapter<TInput, Uint8Array>;
  adapterInput: TInput;
  context: AdapterContext;
}): Promise<SourcePlanSmokeItem> {
  let plannedTasks = 0;
  let fetchedDocuments = 0;
  let normalizedDocuments = 0;
  let degradedDocuments = 0;
  const documents: SourcePlanSmokeDocument[] = [];
  try {
    for await (const task of input.adapter.plan(input.adapterInput, input.context)) {
      plannedTasks += 1;
      const raw = await input.adapter.fetch(task, input.context);
      fetchedDocuments += 1;
      if (sourceFetchStatus(raw) === "fallback") {
        // fallback 说明源已退化；smoke 只报告状态，不把缓存内容当作本轮成功 normalize。
        degradedDocuments += 1;
        documents.push(rawSmokeDocument(task, raw));
        continue;
      }
      const normalized = await input.adapter.normalize(raw, input.context);
      normalizedDocuments += 1;
      documents.push(normalizedSmokeDocument(task, raw, normalized));
    }
    return {
      check_target_id: input.target.check_target_id,
      source_adapter_id: input.target.source_adapter_id,
      target_kind: input.target.target_kind,
      status: "checked",
      planned_tasks: plannedTasks,
      fetched_documents: fetchedDocuments,
      normalized_documents: normalizedDocuments,
      degraded_documents: degradedDocuments,
      documents
    };
  } catch (error) {
    return failedSmokeItem(input.target, error, { plannedTasks, fetchedDocuments, normalizedDocuments, degradedDocuments, documents });
  }
}

function findSmokeRunner(target: SourcePlanSmokeTarget): SourcePlanSmokeRunner | undefined {
  return SMOKE_RUNNERS.find((runner) => connectorKey(runner) === connectorKey(target));
}

function skippedSmokeItem(target: SourcePlanSmokeTarget, errorMessage: string): SourcePlanSmokeItem {
  return {
    check_target_id: target.check_target_id,
    source_adapter_id: target.source_adapter_id,
    target_kind: target.target_kind,
    status: "skipped",
    planned_tasks: 0,
    fetched_documents: 0,
    normalized_documents: 0,
    degraded_documents: 0,
    documents: [],
    issue_kind: "connector_unsupported",
    error_message: errorMessage
  };
}

function failedSmokeItem(
  target: SourcePlanSmokeTarget,
  error: unknown,
  counts: {
    plannedTasks: number;
    fetchedDocuments: number;
    normalizedDocuments: number;
    degradedDocuments: number;
    documents: readonly SourcePlanSmokeDocument[];
  }
): SourcePlanSmokeItem {
  const message = messageFromUnknown(error);
  return {
    check_target_id: target.check_target_id,
    source_adapter_id: target.source_adapter_id,
    target_kind: target.target_kind,
    status: "failed",
    planned_tasks: counts.plannedTasks,
    fetched_documents: counts.fetchedDocuments,
    normalized_documents: counts.normalizedDocuments,
    degraded_documents: counts.degradedDocuments,
    documents: counts.documents,
    issue_kind: classifySmokeIssue(message),
    error_message: message
  };
}

export function classifySmokeIssue(message: string): SourcePlanSmokeIssueKind {
  const normalized = message.toLowerCase();
  if (normalized.includes("missing required environment value") || normalized.includes("requires api key")) return "missing_credentials";
  if (normalized.includes("unsupported source-plan smoke target")) return "connector_unsupported";
  if (normalized.includes("fetch timed out") || normalized.includes("fetch failed") || normalized.includes("security page returned"))
    return "source_unreachable";
  if (normalized.includes("api error") || normalized.includes("response data must be") || normalized.includes("disclosure list must be"))
    return "source_response_error";
  if (isTargetConfigIssue(normalized)) return "target_config_invalid";
  return "adapter_error";
}

function isTargetConfigIssue(message: string): boolean {
  return (
    message.includes("target config") ||
    message.includes("must be") ||
    message.includes("must use") ||
    message.includes("outside supported range") ||
    message.includes("unsupported ") ||
    message.includes("invalid ")
  );
}

function summarizeSmokeItems(requestedTargets: number, selectedTargets: number, items: readonly SourcePlanSmokeItem[]): SourcePlanSmokeSummary {
  return {
    requested_targets: requestedTargets,
    selected_targets: selectedTargets,
    checked_targets: items.filter((item) => item.status === "checked").length,
    failed_targets: items.filter((item) => item.status === "failed").length,
    skipped_targets: items.filter((item) => item.status === "skipped").length,
    planned_tasks: sumItems(items, (item) => item.planned_tasks),
    fetched_documents: sumItems(items, (item) => item.fetched_documents),
    normalized_documents: sumItems(items, (item) => item.normalized_documents),
    degraded_documents: sumItems(items, (item) => item.degraded_documents),
    by_source: countItemsBy(items, (item) => item.source_adapter_id),
    by_source_status: summarizeItemsBySource(items)
  };
}

function summarizeItemsBySource(items: readonly SourcePlanSmokeItem[]): Record<string, SourcePlanSmokeSourceSummary> {
  const bySource = new Map<string, SourcePlanSmokeItem[]>();
  for (const item of items) {
    const existing = bySource.get(item.source_adapter_id);
    if (existing === undefined) bySource.set(item.source_adapter_id, [item]);
    else existing.push(item);
  }
  const summary: Record<string, SourcePlanSmokeSourceSummary> = {};
  for (const [source, sourceItems] of [...bySource.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    summary[source] = {
      selected_targets: sourceItems.length,
      checked_targets: sourceItems.filter((item) => item.status === "checked").length,
      failed_targets: sourceItems.filter((item) => item.status === "failed").length,
      skipped_targets: sourceItems.filter((item) => item.status === "skipped").length,
      planned_tasks: sumItems(sourceItems, (item) => item.planned_tasks),
      fetched_documents: sumItems(sourceItems, (item) => item.fetched_documents),
      normalized_documents: sumItems(sourceItems, (item) => item.normalized_documents),
      degraded_documents: sumItems(sourceItems, (item) => item.degraded_documents),
      target_kinds: countItemsBy(sourceItems, (item) => item.target_kind),
      issue_kinds: countItemsBy(
        sourceItems.filter((item) => item.issue_kind !== undefined),
        (item) => item.issue_kind ?? "adapter_error"
      )
    };
  }
  return summary;
}

function normalizedSmokeDocument(task: FetchTask, raw: RawDocument<Uint8Array>, normalized: NormalizedDocument): SourcePlanSmokeDocument {
  return {
    ...rawSmokeDocument(task, raw),
    document_type: normalized.document_type,
    ...(normalized.source_date === undefined ? {} : { source_date: normalized.source_date }),
    text_chars: normalized.text.length,
    chunks: normalized.chunks.length
  };
}

function rawSmokeDocument(task: FetchTask, raw: RawDocument<Uint8Array>): SourcePlanSmokeDocument {
  const status = sourceFetchStatus(raw);
  return {
    task_id: task.task_id,
    source_url: raw.url,
    doc_id: raw.doc_id,
    ...(status === undefined ? {} : { source_fetch_status: status })
  };
}

function sourceFetchStatus(raw: RawDocument<Uint8Array>): "live" | "fallback" | undefined {
  const value = raw.metadata["source_fetch_status"];
  if (value === "live" || value === "fallback") return value;
  return undefined;
}

function sumItems(items: readonly SourcePlanSmokeItem[], valueForItem: (item: SourcePlanSmokeItem) => number): number {
  return items.reduce((sum, item) => sum + valueForItem(item), 0);
}

function countItemsBy(items: readonly SourcePlanSmokeItem[], keyForItem: (item: SourcePlanSmokeItem) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[keyForItem(item)] = (counts[keyForItem(item)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}
