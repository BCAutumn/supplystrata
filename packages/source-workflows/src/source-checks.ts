import type { DatabaseStore } from "@supplystrata/db";
import type { Env } from "@supplystrata/config";
import {
  claimDueSourceCheckJobs,
  enqueueDueSourceCheckJobs,
  markSourceCheckJobFailed,
  markSourceCheckJobSucceeded,
  type DueSourceCheckRow,
  type SourceCheckJobRow,
  type SourceCheckJobStatus,
  type SourceCheckTargetSelection
} from "@supplystrata/source-monitor";
import { messageFromUnknown, noopLogger } from "@supplystrata/observability";
import type { SourceCheckConnectorLogger, SourceCheckTargetRow } from "@supplystrata/source-connectors";
import { sourceWorkflowAdapterContextInput } from "./adapter-context.js";
import { inferUniqueTargetKind, runRegisteredManualSourceCheckConnector, runRegisteredSourceCheckConnector } from "./source-check-registry.js";
import type { SourceCheckSummary } from "./source-check-runner.js";

export { listRegisteredSourceCheckConnectorCapabilities, listSourceCheckConnectorIds } from "./source-check-registry.js";

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

export interface SourceCheckRunOptions {
  env: Env;
  logger?: SourceCheckConnectorLogger;
}

export type DueSourceCheckRunInput = { now?: string; limit?: number } & SourceCheckTargetSelection & SourceCheckRunOptions;

export async function runDueSourceChecks(store: DatabaseStore, input: DueSourceCheckRunInput): Promise<DueSourceCheckRunResult> {
  const logger = input.logger ?? noopLogger;
  const adapterContextInput = sourceWorkflowAdapterContextInput(input.env);
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
    items.push(await runDueSourceCheckJob(store, job, { env: input.env, logger, adapterContextInput }));
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

async function runDueSourceCheckTarget(
  store: DatabaseStore,
  target: DueSourceCheckRow,
  options: SourceCheckRunOptions & { adapterContextInput: ReturnType<typeof sourceWorkflowAdapterContextInput> }
): Promise<DueSourceCheckRunItem> {
  const summaries = await runRegisteredSourceCheckConnector(store, target, {
    logger: options.logger ?? noopLogger,
    adapter_context_input: options.adapterContextInput
  });
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

async function runDueSourceCheckJob(
  store: DatabaseStore,
  job: SourceCheckJobRow,
  options: SourceCheckRunOptions & { adapterContextInput: ReturnType<typeof sourceWorkflowAdapterContextInput> }
): Promise<DueSourceCheckRunItem> {
  try {
    const item = await runDueSourceCheckTarget(store, job, options);
    await store.transaction((client) => markSourceCheckJobSucceeded(client, { job_id: job.job_id }));
    return { ...item, job_id: job.job_id };
  } catch (error) {
    const errorMessage = messageFromUnknown(error);
    const failed = await store.transaction((client) => markSourceCheckJobFailed(client, { job_id: job.job_id, error_message: errorMessage }));
    return failedSourceCheckRunItem(job, failedSourceCheckStatus(failed.status), failed.attempts, errorMessage);
  }
}

export async function runManualSourceCheck(store: DatabaseStore, input: ManualSourceCheckInput, options: SourceCheckRunOptions): Promise<SourceCheckSummary[]> {
  const target = manualSourceCheckTarget(input);
  return runRegisteredManualSourceCheckConnector(store, target, {
    logger: options.logger ?? noopLogger,
    adapter_context_input: sourceWorkflowAdapterContextInput(options.env)
  });
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
