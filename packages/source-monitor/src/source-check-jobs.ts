import { randomUUID } from "node:crypto";
import type { DbClient, DbTxClient } from "@supplystrata/db/write";
import { normalizeSourceCheckTargetSelection } from "./source-check-target-selection.js";
import type { DueSourceCheckRow, SourceCheckJobRow, SourceCheckJobStateRow, SourceCheckRunStatusRow } from "./db-rows.js";
import type { SourceCheckTargetSelection } from "./types.js";
import type { SourceCheckJobStatus } from "./types.js";

const DEFAULT_SOURCE_CHECK_JOB_LEASE_MINUTES = 15;

export interface SourceCheckJobEnqueueResult {
  due_targets: number;
  enqueued_jobs: number;
  skipped_active_jobs: number;
}

export interface SourceCheckJobEnqueueAndClaimResult extends SourceCheckJobEnqueueResult {
  claimed_jobs: SourceCheckJobRow[];
}

export interface SourceCheckRunStatusItem {
  job_id: string;
  status: SourceCheckJobStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  next_attempt_at: string;
  claimed_at: string | null;
  lease_expires_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  check_target_id: string;
  source_adapter_id: string;
  target_kind: string;
  subject_entity_id: string | null;
  target_enabled: boolean;
  policy_enabled: boolean;
  next_check_at: string | null;
}

export interface SourceCheckRunStatusSummary {
  total: number;
  pending: number;
  in_progress: number;
  failed: number;
  succeeded: number;
  dead: number;
}

export interface SourceCheckRunStatusReport {
  generated_at: string;
  summary: SourceCheckRunStatusSummary;
  jobs: SourceCheckRunStatusItem[];
}

export async function enqueueAndClaimDueSourceCheckJobs(
  client: DbTxClient,
  input: { now: string; limit?: number; lease_minutes?: number } & SourceCheckTargetSelection
): Promise<SourceCheckJobEnqueueAndClaimResult> {
  const enqueue = await enqueueDueSourceCheckJobs(client, {
    limit: input.limit ?? 50,
    now: input.now,
    ...(input.check_target_ids === undefined ? {} : { check_target_ids: input.check_target_ids }),
    ...(input.source_adapter_ids === undefined ? {} : { source_adapter_ids: input.source_adapter_ids })
  });
  const claimedJobs = await claimDueSourceCheckJobs(client, {
    limit: input.limit ?? 50,
    ...(input.lease_minutes === undefined ? {} : { lease_minutes: input.lease_minutes }),
    ...(input.check_target_ids === undefined ? {} : { check_target_ids: input.check_target_ids }),
    ...(input.source_adapter_ids === undefined ? {} : { source_adapter_ids: input.source_adapter_ids })
  });
  return { ...enqueue, claimed_jobs: claimedJobs };
}

export async function enqueueDueSourceCheckJobs(
  client: DbTxClient,
  input: { now: string; limit?: number } & SourceCheckTargetSelection
): Promise<SourceCheckJobEnqueueResult> {
  const dueTargets = await claimDueSourceCheckTargets(client, {
    limit: input.limit ?? 50,
    now: input.now,
    ...(input.check_target_ids === undefined ? {} : { check_target_ids: input.check_target_ids }),
    ...(input.source_adapter_ids === undefined ? {} : { source_adapter_ids: input.source_adapter_ids })
  });
  let enqueuedJobs = 0;
  for (const target of dueTargets) {
    const result = await client.query(
      `INSERT INTO source_check_jobs (
         job_id, check_target_id, source_adapter_id, target_kind, status, attempts, max_attempts,
         backoff_base_minutes, backoff_max_minutes, next_attempt_at
       )
       VALUES ($1,$2,$3,$4,'pending',0,$5,$6,$7,$8::timestamptz)
       ON CONFLICT DO NOTHING`,
      [
        `SCJ-${randomUUID()}`,
        target.check_target_id,
        target.source_adapter_id,
        target.target_kind,
        target.effective_max_attempts,
        target.effective_backoff_base_minutes,
        target.effective_backoff_max_minutes,
        input.now
      ]
    );
    enqueuedJobs += result.rowCount ?? 0;
  }
  return {
    due_targets: dueTargets.length,
    enqueued_jobs: enqueuedJobs,
    skipped_active_jobs: dueTargets.length - enqueuedJobs
  };
}

export async function claimDueSourceCheckJobs(
  client: DbTxClient,
  input: { limit?: number; lease_minutes?: number } & SourceCheckTargetSelection = {}
): Promise<SourceCheckJobRow[]> {
  const filter = normalizeSourceCheckTargetSelection(input);
  const leaseMinutes = normalizeLeaseMinutes(input.lease_minutes);
  const result = await client.query<SourceCheckJobRow>(
    `WITH due AS (
       SELECT j.job_id
       FROM source_check_jobs j
       JOIN source_check_targets t ON t.check_target_id = j.check_target_id
       JOIN source_policies p ON p.source_adapter_id = t.source_adapter_id
       WHERE (
           (j.status IN ('pending','failed') AND j.next_attempt_at <= now())
           OR (j.status = 'in_progress' AND j.lease_expires_at IS NOT NULL AND j.lease_expires_at <= now())
         )
         AND t.enabled = true
         AND p.enabled = true
         AND ($2::text[] IS NULL OR t.check_target_id = ANY($2::text[]))
         AND ($3::text[] IS NULL OR t.source_adapter_id = ANY($3::text[]))
       ORDER BY p.priority, t.priority, j.next_attempt_at, j.created_at, j.job_id
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     ),
     claimed AS (
       UPDATE source_check_jobs jobs
       SET status = 'in_progress',
           claimed_at = now(),
           lease_expires_at = now() + ($4::int * interval '1 minute'),
           updated_at = now()
       FROM due
       WHERE jobs.job_id = due.job_id
       RETURNING jobs.job_id, jobs.status AS job_status, jobs.attempts, jobs.max_attempts, jobs.last_error,
                 jobs.backoff_base_minutes, jobs.backoff_max_minutes,
                 jobs.next_attempt_at, jobs.claimed_at, jobs.lease_expires_at, jobs.completed_at, jobs.created_at, jobs.updated_at,
                 jobs.check_target_id, jobs.source_adapter_id, jobs.target_kind
     )
     SELECT claimed.job_id, claimed.job_status, claimed.attempts, claimed.max_attempts, claimed.last_error,
            claimed.backoff_base_minutes, claimed.backoff_max_minutes,
            claimed.next_attempt_at, claimed.claimed_at, claimed.lease_expires_at, claimed.completed_at, claimed.created_at, claimed.updated_at,
            t.check_target_id, t.source_adapter_id, t.target_kind, t.subject_entity_id, t.target_config,
            t.enabled AS target_enabled, t.priority AS target_priority, t.config_source AS target_config_source, t.notes AS target_notes,
            p.enabled AS policy_enabled, p.check_cadence_minutes, p.jitter_minutes, p.priority AS policy_priority,
            COALESCE(t.check_cadence_minutes, p.check_cadence_minutes) AS effective_check_cadence_minutes,
            COALESCE(t.jitter_minutes, p.jitter_minutes) AS effective_jitter_minutes,
            COALESCE(t.max_attempts, p.max_attempts) AS effective_max_attempts,
            COALESCE(t.backoff_base_minutes, p.backoff_base_minutes) AS effective_backoff_base_minutes,
            COALESCE(t.backoff_max_minutes, p.backoff_max_minutes) AS effective_backoff_max_minutes,
            p.config_source AS policy_config_source, COALESCE(t.next_check_at, p.next_check_at) AS next_check_at,
            p.notes AS policy_notes
     FROM claimed
     JOIN source_check_targets t ON t.check_target_id = claimed.check_target_id
     JOIN source_policies p ON p.source_adapter_id = t.source_adapter_id
     ORDER BY p.priority, t.priority, claimed.next_attempt_at, claimed.created_at, claimed.job_id`,
    [input.limit ?? 50, filter.check_target_ids, filter.source_adapter_ids, leaseMinutes]
  );
  return result.rows;
}

export async function listSourceCheckRunStatus(
  client: DbClient,
  input: { generated_at: string; limit?: number; statuses?: readonly SourceCheckJobStatus[] } & SourceCheckTargetSelection
): Promise<SourceCheckRunStatusReport> {
  const filter = normalizeSourceCheckTargetSelection(input);
  const result = await client.query<SourceCheckRunStatusRow>(
    `SELECT j.job_id, j.status, j.attempts, j.max_attempts, j.last_error,
            j.next_attempt_at, j.claimed_at, j.lease_expires_at, j.completed_at, j.created_at, j.updated_at,
            t.check_target_id, t.source_adapter_id, t.target_kind, t.subject_entity_id,
            t.enabled AS target_enabled, p.enabled AS policy_enabled,
            COALESCE(t.next_check_at, p.next_check_at) AS next_check_at
     FROM source_check_jobs j
     JOIN source_check_targets t ON t.check_target_id = j.check_target_id
     JOIN source_policies p ON p.source_adapter_id = t.source_adapter_id
     WHERE ($2::text[] IS NULL OR t.check_target_id = ANY($2::text[]))
       AND ($3::text[] IS NULL OR t.source_adapter_id = ANY($3::text[]))
       AND ($4::text[] IS NULL OR j.status = ANY($4::text[]))
     ORDER BY
       CASE j.status
         WHEN 'in_progress' THEN 0
         WHEN 'failed' THEN 1
         WHEN 'dead' THEN 2
         WHEN 'pending' THEN 3
         ELSE 4
       END,
       j.updated_at DESC,
       j.created_at DESC,
       j.job_id
     LIMIT $1`,
    [input.limit ?? 100, filter.check_target_ids, filter.source_adapter_ids, input.statuses ?? null]
  );
  const jobs = result.rows.map(sourceCheckRunStatusItemFromRow);
  return {
    generated_at: input.generated_at,
    summary: summarizeSourceCheckRunStatus(jobs),
    jobs
  };
}

export async function markSourceCheckJobSucceeded(client: DbClient, input: { job_id: string }): Promise<void> {
  await client.query(
    `UPDATE source_check_jobs
     SET status = 'succeeded',
         completed_at = now(),
         lease_expires_at = NULL,
         updated_at = now()
     WHERE job_id = $1`,
    [input.job_id]
  );
}

function sourceCheckRunStatusItemFromRow(row: SourceCheckRunStatusRow): SourceCheckRunStatusItem {
  return {
    job_id: row.job_id,
    status: row.status,
    attempts: row.attempts,
    max_attempts: row.max_attempts,
    last_error: row.last_error,
    next_attempt_at: row.next_attempt_at.toISOString(),
    claimed_at: row.claimed_at === null ? null : row.claimed_at.toISOString(),
    lease_expires_at: row.lease_expires_at === null ? null : row.lease_expires_at.toISOString(),
    completed_at: row.completed_at === null ? null : row.completed_at.toISOString(),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    check_target_id: row.check_target_id,
    source_adapter_id: row.source_adapter_id,
    target_kind: row.target_kind,
    subject_entity_id: row.subject_entity_id,
    target_enabled: row.target_enabled,
    policy_enabled: row.policy_enabled,
    next_check_at: row.next_check_at === null ? null : row.next_check_at.toISOString()
  };
}

function summarizeSourceCheckRunStatus(jobs: readonly SourceCheckRunStatusItem[]): SourceCheckRunStatusSummary {
  const summary: SourceCheckRunStatusSummary = { total: jobs.length, pending: 0, in_progress: 0, failed: 0, succeeded: 0, dead: 0 };
  for (const job of jobs) summary[job.status] += 1;
  return summary;
}

export async function markSourceCheckJobFailed(client: DbClient, input: { job_id: string; error_message: string }): Promise<SourceCheckJobStateRow> {
  const result = await client.query<SourceCheckJobStateRow>(
    `UPDATE source_check_jobs
     SET attempts = attempts + 1,
         status = CASE WHEN attempts + 1 >= max_attempts THEN 'dead' ELSE 'failed' END,
         last_error = $2,
         next_attempt_at = CASE
           WHEN attempts + 1 >= max_attempts THEN next_attempt_at
           ELSE now() + (LEAST(backoff_base_minutes * (attempts + 1) * (attempts + 1), backoff_max_minutes) * interval '1 minute')
         END,
         claimed_at = NULL,
         lease_expires_at = NULL,
         completed_at = CASE WHEN attempts + 1 >= max_attempts THEN now() ELSE completed_at END,
         updated_at = now()
     WHERE job_id = $1
     RETURNING job_id, status, attempts, max_attempts, backoff_base_minutes, backoff_max_minutes, last_error, next_attempt_at, completed_at`,
    [input.job_id, input.error_message]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Source check job not found while marking failure: ${input.job_id}`);
  return row;
}

async function claimDueSourceCheckTargets(
  client: DbTxClient,
  input: { now: string; limit: number } & SourceCheckTargetSelection
): Promise<DueSourceCheckRow[]> {
  const now = input.now;
  const filter = normalizeSourceCheckTargetSelection(input);
  const result = await client.query<DueSourceCheckRow>(
    `SELECT t.check_target_id, t.source_adapter_id, t.target_kind, t.subject_entity_id, t.target_config,
            t.enabled AS target_enabled, t.priority AS target_priority, t.config_source AS target_config_source, t.notes AS target_notes,
            p.enabled AS policy_enabled, p.check_cadence_minutes, p.jitter_minutes, p.priority AS policy_priority,
            COALESCE(t.check_cadence_minutes, p.check_cadence_minutes) AS effective_check_cadence_minutes,
            COALESCE(t.jitter_minutes, p.jitter_minutes) AS effective_jitter_minutes,
            COALESCE(t.max_attempts, p.max_attempts) AS effective_max_attempts,
            COALESCE(t.backoff_base_minutes, p.backoff_base_minutes) AS effective_backoff_base_minutes,
            COALESCE(t.backoff_max_minutes, p.backoff_max_minutes) AS effective_backoff_max_minutes,
            p.config_source AS policy_config_source, COALESCE(t.next_check_at, p.next_check_at) AS next_check_at,
            p.notes AS policy_notes
     FROM source_check_targets t
     JOIN source_policies p ON p.source_adapter_id = t.source_adapter_id
     WHERE t.enabled = true
       AND p.enabled = true
       AND ($3::text[] IS NULL OR t.check_target_id = ANY($3::text[]))
       AND ($4::text[] IS NULL OR t.source_adapter_id = ANY($4::text[]))
       AND (COALESCE(t.next_check_at, p.next_check_at) IS NULL OR COALESCE(t.next_check_at, p.next_check_at) <= $1::timestamptz)
       AND NOT EXISTS (
         SELECT 1
         FROM source_check_jobs active_jobs
         WHERE active_jobs.check_target_id = t.check_target_id
           AND active_jobs.status IN ('pending','in_progress','failed')
       )
     ORDER BY p.priority, t.priority, COALESCE(t.next_check_at, p.next_check_at) NULLS FIRST, t.check_target_id
     LIMIT $2
     FOR UPDATE SKIP LOCKED`,
    [now, input.limit, filter.check_target_ids, filter.source_adapter_ids]
  );
  return result.rows;
}

function normalizeLeaseMinutes(value: number | undefined): number {
  if (value === undefined) return DEFAULT_SOURCE_CHECK_JOB_LEASE_MINUTES;
  if (!Number.isInteger(value) || value < 1) throw new Error("source check job lease_minutes must be a positive integer");
  return value;
}
