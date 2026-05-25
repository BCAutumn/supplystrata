import { missingSourceCredentialRequirements, type Env } from "@supplystrata/config";
import { messageFromUnknown } from "@supplystrata/observability";
import type { FetchTask, NormalizedDocument, RawDocument } from "@supplystrata/core";
import { extractDisclosureObservations, extractSemanticSections } from "@supplystrata/observation-extractor";
import type { AdapterContext, SourceAdapter } from "@supplystrata/source-adapter-spec";
import type { CreateAdapterContextInput } from "@supplystrata/source-adapter-runtime";
import { connectorKey } from "@supplystrata/source-connectors";
import { sourceWorkflowAdapterContextInput } from "./adapter-context.js";
import { SOURCE_CHECK_CATALOG, type SourceCheckCatalogEntry } from "./source-check-catalog.js";

export interface SourcePlanSmokeTarget {
  check_target_id: string;
  source_adapter_id: string;
  target_kind: string;
  target_config: Record<string, unknown>;
}

export interface SourcePlanSmokeInput {
  env: Env;
  targets: readonly SourcePlanSmokeTarget[];
  checkedAt: string;
  source_adapter_ids?: readonly string[];
  limit?: number;
}

export interface SourcePlanSmokeSelectionInput {
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
  observation_drafts?: number;
  semantic_sections?: number;
  observation_types?: readonly string[];
  semantic_section_kinds?: readonly string[];
}

export interface SourcePlanSmokeMissingCredential {
  env_key: string;
  description: string;
  required: boolean;
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
  missing_credentials?: readonly SourcePlanSmokeMissingCredential[];
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
  observation_drafts: number;
  semantic_sections: number;
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
  observation_drafts: number;
  semantic_sections: number;
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
  credential_requirements?: readonly SourcePlanSmokeMissingCredential[];
  run(target: SourcePlanSmokeTarget, runtime: SourcePlanSmokeRuntime): Promise<SourcePlanSmokeItem>;
}

interface SourcePlanSmokeRuntime {
  env: Env;
  adapterContextInput: CreateAdapterContextInput;
}

export async function runSourcePlanConnectivitySmoke(input: SourcePlanSmokeInput): Promise<SourcePlanSmokeReport> {
  const selectedTargets = selectSourcePlanSmokeTargets(input);
  const runtime = {
    env: input.env,
    adapterContextInput: sourceWorkflowAdapterContextInput(input.env, { now: input.checkedAt })
  };
  const items: SourcePlanSmokeItem[] = [];
  for (const target of selectedTargets) {
    const runner = findSmokeRunner(target);
    if (runner === undefined) {
      items.push(skippedSmokeItem(target, `Unsupported source-plan smoke target: ${connectorKey(target)}`));
      continue;
    }
    try {
      items.push(await runner.run(target, runtime));
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
export function selectSourcePlanSmokeTargets(input: SourcePlanSmokeSelectionInput): SourcePlanSmokeTarget[] {
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1)) throw new Error("source-plan smoke limit must be a positive integer");
  const sourceIds = input.source_adapter_ids === undefined ? undefined : new Set(input.source_adapter_ids);
  const selected = sourceIds === undefined ? [...input.targets] : input.targets.filter((target) => sourceIds.has(target.source_adapter_id));
  return input.limit === undefined ? selected : selected.slice(0, input.limit);
}

const SMOKE_RUNNERS: readonly SourcePlanSmokeRunner[] = SOURCE_CHECK_CATALOG.map((entry) => createSmokeRunner(entry));

export function listSourcePlanSmokeRunnerIds(): string[] {
  return SMOKE_RUNNERS.map((runner) => connectorKey(runner)).sort();
}

function createSmokeRunner(input: SourceCheckCatalogEntry): SourcePlanSmokeRunner {
  return {
    source_adapter_id: input.connector.source_adapter_id,
    target_kind: input.connector.target_kind,
    ...(input.connector.credential_requirements === undefined ? {} : { credential_requirements: input.connector.credential_requirements }),
    run(target, runtime) {
      const missingCredentials = missingCredentialRequirements(runtime.env, input.connector.credential_requirements);
      if (missingCredentials.length > 0) throw new MissingSourceCredentialsError(missingCredentials);
      return input.executeSmoke({
        targetConfig: target.target_config,
        runtime,
        run: (execution) =>
          runSourceTargetSmoke({
            target,
            adapter: execution.adapter,
            adapterInput: execution.adapterInput,
            context: execution.context
          })
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
  const missingCredentials = error instanceof MissingSourceCredentialsError ? error.missingCredentials : [];
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
    error_message: message,
    ...(missingCredentials.length === 0 ? {} : { missing_credentials: missingCredentials })
  };
}

export function classifySmokeIssue(message: string): SourcePlanSmokeIssueKind {
  const normalized = message.toLowerCase();
  if (normalized.includes("missing required environment value") || normalized.includes("requires api key")) return "missing_credentials";
  if (normalized.includes("missing required source credentials")) return "missing_credentials";
  if (normalized.includes("unsupported source-plan smoke target")) return "connector_unsupported";
  if (normalized.includes("fetch timed out") || normalized.includes("fetch failed") || normalized.includes("security page returned"))
    return "source_unreachable";
  if (normalized.includes("api error") || normalized.includes("response data must be") || normalized.includes("disclosure list must be"))
    return "source_response_error";
  if (isTargetConfigIssue(normalized)) return "target_config_invalid";
  return "adapter_error";
}

class MissingSourceCredentialsError extends Error {
  constructor(readonly missingCredentials: readonly SourcePlanSmokeMissingCredential[]) {
    super(`Missing required source credentials: ${missingCredentials.map((credential) => credential.env_key).join(", ")}`);
  }
}

function missingCredentialRequirements(
  env: Env,
  requirements: readonly SourcePlanSmokeMissingCredential[] | undefined
): readonly SourcePlanSmokeMissingCredential[] {
  return missingSourceCredentialRequirements(env, requirements);
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
    observation_drafts: sumItems(items, sumItemObservationDrafts),
    semantic_sections: sumItems(items, sumItemSemanticSections),
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
      observation_drafts: sumItems(sourceItems, sumItemObservationDrafts),
      semantic_sections: sumItems(sourceItems, sumItemSemanticSections),
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
  const signal = normalizedObservationSignal(normalized);
  return {
    ...rawSmokeDocument(task, raw),
    document_type: normalized.document_type,
    ...(normalized.source_date === undefined ? {} : { source_date: normalized.source_date }),
    text_chars: normalized.text.length,
    chunks: normalized.chunks.length,
    observation_drafts: signal.observation_drafts,
    semantic_sections: signal.semantic_sections,
    observation_types: signal.observation_types,
    semantic_section_kinds: signal.semantic_section_kinds
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

function sumItemObservationDrafts(item: SourcePlanSmokeItem): number {
  return item.documents.reduce((sum, document) => sum + (document.observation_drafts ?? 0), 0);
}

function sumItemSemanticSections(item: SourcePlanSmokeItem): number {
  return item.documents.reduce((sum, document) => sum + (document.semantic_sections ?? 0), 0);
}

// smoke 只做只读体检：这里复用 extractor 判断文本是否进入可抽取层，但不持久化 observation，也不提升事实边。
function normalizedObservationSignal(normalized: NormalizedDocument): {
  observation_drafts: number;
  semantic_sections: number;
  observation_types: readonly string[];
  semantic_section_kinds: readonly string[];
} {
  const observations = extractDisclosureObservations(normalized);
  const sections = extractSemanticSections(normalized);
  return {
    observation_drafts: observations.length,
    semantic_sections: sections.length,
    observation_types: uniqueSortedStrings(observations.map((observation) => observation.observation_type)),
    semantic_section_kinds: uniqueSortedStrings(sections.map((section) => section.section_kind))
  };
}

function uniqueSortedStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function countItemsBy(items: readonly SourcePlanSmokeItem[], keyForItem: (item: SourcePlanSmokeItem) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[keyForItem(item)] = (counts[keyForItem(item)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}
