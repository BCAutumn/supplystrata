import type { DatabaseStore } from "@supplystrata/db";
import {
  claimDueSourceCheckJobs,
  enqueueDueSourceCheckJobs,
  listDueSourceChecks,
  markSourceCheckJobFailed,
  markSourceCheckJobSucceeded,
  type DueSourceCheckRow,
  type SourceCheckJobRow,
  type SourceCheckJobStatus,
  type SourceCheckTargetSelection
} from "@supplystrata/source-monitor";
import { messageFromUnknown } from "@supplystrata/observability";
import {
  connectorKey,
  listSourceCheckConnectorCapabilities,
  runSourceCheckConnector,
  unsupportedSourceCheckTargetMessage,
  type SourceCheckConnectorCapability,
  type SourceCheckConnector,
  type SourceCheckTargetRow
} from "@supplystrata/source-connectors";
import { appleSupplierListReviewSourceCheckConnector } from "./apple-suppliers.js";
import { censusTradeSourceCheckConnector } from "./census-trade-checks.js";
import { dartKrCompanyFilingsSourceCheckConnector } from "./dart-kr-checks.js";
import { edinetDailyFilingsSourceCheckConnector } from "./edinet-checks.js";
import { officialIrSourceCheckConnectors } from "./official-ir-checks.js";
import { oshSourceCheckConnector } from "./osh-checks.js";
import { secCompanyFactsSourceCheckConnector, secEdgarSourceCheckConnector } from "./sec-edgar.js";
import { twseMopsElectronicDocumentsSourceCheckConnector } from "./twse-mops-checks.js";
import { worldBankPinkSourceCheckConnector } from "./worldbank-pink-checks.js";
import type { SourceCheckSummary } from "./source-check-runner.js";

export interface DueSourceCheckRunItem {
  job_id?: string;
  check_target_id: string;
  source_adapter_id: string;
  target_kind: string;
  subject_entity_id: string | null;
  status: "checked" | "failed" | "dead";
  attempts?: number;
  error_message?: string;
  checked_documents: number;
  summaries: SourceCheckSummary[];
}

export interface DueSourceCheckRunResult {
  due_targets: number;
  enqueued_jobs: number;
  skipped_active_jobs: number;
  claimed_jobs: number;
  checked_targets: number;
  failed_targets: number;
  dead_jobs: number;
  items: DueSourceCheckRunItem[];
}

export interface ManualSourceCheckInput {
  source_adapter_id: string;
  target_kind?: string;
  target_config: Record<string, unknown>;
  check_target_id?: string;
  subject_entity_id?: string;
}

export type DueSourceCheckRunInput = { now?: string; limit?: number } & SourceCheckTargetSelection;

export async function runDueSourceChecks(store: DatabaseStore, input: DueSourceCheckRunInput = {}): Promise<DueSourceCheckRunResult> {
  const enqueue = await store.transaction((client) =>
    enqueueDueSourceCheckJobs(client, {
      limit: input.limit ?? 50,
      ...(input.now === undefined ? {} : { now: input.now }),
      ...(input.check_target_ids === undefined ? {} : { check_target_ids: input.check_target_ids }),
      ...(input.source_adapter_ids === undefined ? {} : { source_adapter_ids: input.source_adapter_ids })
    })
  );
  const due = await store.transaction((client) =>
    claimDueSourceCheckJobs(client, {
      limit: input.limit ?? 50,
      ...(input.check_target_ids === undefined ? {} : { check_target_ids: input.check_target_ids }),
      ...(input.source_adapter_ids === undefined ? {} : { source_adapter_ids: input.source_adapter_ids })
    })
  );
  const items: DueSourceCheckRunItem[] = [];
  for (const job of due) {
    items.push(await runDueSourceCheckJob(store, job));
  }
  return {
    due_targets: enqueue.due_targets,
    enqueued_jobs: enqueue.enqueued_jobs,
    skipped_active_jobs: enqueue.skipped_active_jobs,
    claimed_jobs: due.length,
    checked_targets: items.filter((item) => item.status === "checked").length,
    failed_targets: items.filter((item) => item.status === "failed").length,
    dead_jobs: items.filter((item) => item.status === "dead").length,
    items
  };
}

const SOURCE_CHECK_CONNECTORS: readonly SourceCheckConnector<DatabaseStore, SourceCheckSummary, DueSourceCheckRow>[] = [
  appleSupplierListReviewSourceCheckConnector,
  dartKrCompanyFilingsSourceCheckConnector,
  edinetDailyFilingsSourceCheckConnector,
  twseMopsElectronicDocumentsSourceCheckConnector,
  secEdgarSourceCheckConnector,
  secCompanyFactsSourceCheckConnector,
  ...officialIrSourceCheckConnectors,
  censusTradeSourceCheckConnector,
  oshSourceCheckConnector,
  worldBankPinkSourceCheckConnector
];

async function runDueSourceCheckTarget(store: DatabaseStore, target: DueSourceCheckRow): Promise<DueSourceCheckRunItem> {
  const summaries = await runSourceCheckConnector(store, target, SOURCE_CHECK_CONNECTORS);
  return {
    check_target_id: target.check_target_id,
    source_adapter_id: target.source_adapter_id,
    target_kind: target.target_kind,
    subject_entity_id: target.subject_entity_id,
    status: "checked",
    checked_documents: summaries.length,
    summaries
  };
}

async function runDueSourceCheckJob(store: DatabaseStore, job: SourceCheckJobRow): Promise<DueSourceCheckRunItem> {
  try {
    const item = await runDueSourceCheckTarget(store, job);
    await store.transaction((client) => markSourceCheckJobSucceeded(client, { job_id: job.job_id }));
    return { ...item, job_id: job.job_id };
  } catch (error) {
    const errorMessage = messageFromUnknown(error);
    const failed = await store.transaction((client) => markSourceCheckJobFailed(client, { job_id: job.job_id, error_message: errorMessage }));
    return failedSourceCheckRunItem(job, failedSourceCheckStatus(failed.status), failed.attempts, errorMessage);
  }
}

export async function runManualSourceCheck(store: DatabaseStore, input: ManualSourceCheckInput): Promise<SourceCheckSummary[]> {
  const target = manualSourceCheckTarget(input);
  return runSourceCheckConnector(store, target, SOURCE_CHECK_CONNECTORS);
}

export function listSourceCheckConnectorIds(): string[] {
  return SOURCE_CHECK_CONNECTORS.map((connector) => connectorKey(connector)).sort();
}

export function listRegisteredSourceCheckConnectorCapabilities(): SourceCheckConnectorCapability[] {
  return listSourceCheckConnectorCapabilities(SOURCE_CHECK_CONNECTORS);
}

function manualSourceCheckTarget(input: ManualSourceCheckInput): SourceCheckTargetRow {
  const targetKind = input.target_kind ?? inferUniqueTargetKind(input.source_adapter_id);
  return {
    check_target_id: input.check_target_id ?? `manual:${input.source_adapter_id}:${targetKind}`,
    source_adapter_id: input.source_adapter_id,
    target_kind: targetKind,
    target_config: input.target_config
  };
}

function inferUniqueTargetKind(sourceAdapterId: string): string {
  const matches = SOURCE_CHECK_CONNECTORS.filter((connector) => connector.source_adapter_id === sourceAdapterId);
  const onlyMatch = matches[0];
  if (matches.length === 1 && onlyMatch !== undefined) return onlyMatch.target_kind;
  if (matches.length === 0) {
    throw new Error(unsupportedSourceCheckTargetMessage({ source_adapter_id: sourceAdapterId, target_kind: "(unspecified)" }, SOURCE_CHECK_CONNECTORS));
  }
  throw new Error(`Source check target kind is required for ${sourceAdapterId}; supported: ${matches.map((item) => connectorKey(item)).join(", ")}`);
}

function failedSourceCheckRunItem(
  job: SourceCheckJobRow,
  status: Extract<SourceCheckJobStatus, "failed" | "dead">,
  attempts: number,
  errorMessage: string
): DueSourceCheckRunItem {
  return {
    job_id: job.job_id,
    check_target_id: job.check_target_id,
    source_adapter_id: job.source_adapter_id,
    target_kind: job.target_kind,
    subject_entity_id: job.subject_entity_id,
    status,
    attempts,
    error_message: errorMessage,
    checked_documents: 0,
    summaries: []
  };
}

function failedSourceCheckStatus(status: SourceCheckJobStatus): Extract<SourceCheckJobStatus, "failed" | "dead"> {
  if (status === "failed" || status === "dead") return status;
  throw new Error(`Unexpected source check job failure status: ${status}`);
}
