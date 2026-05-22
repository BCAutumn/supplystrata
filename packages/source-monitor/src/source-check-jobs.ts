import { randomUUID } from "node:crypto";
import type { DbClient, DbTxClient } from "@supplystrata/db";
import { normalizeSourceCheckTargetSelection } from "./source-check-target-selection.js";
import type { DueSourceCheckRow, SourceCheckJobRow, SourceCheckJobStateRow } from "./db-rows.js";
import type { SourceCheckTargetSelection } from "./types.js";

const DEFAULT_SOURCE_CHECK_JOB_LEASE_MINUTES = 15;

export interface SourceCheckJobEnqueueResult {
  due_targets: number;
  enqueued_jobs: number;
  skipped_active_jobs: number;
}

export async function enqueueDueSourceCheckJobs(
  client: DbTxClient,
  input: { now?: string; limit?: number } & SourceCheckTargetSelection = {}
): Promise<SourceCheckJobEnqueueResult> {
  const dueTargets = await claimDueSourceCheckTargets(client, {
    limit: input.limit ?? 50,
    ...(input.now === undefined ? {} : { now: input.now }),
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
        input.now ?? new Date().toISOString()
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
  input: { now?: string; limit: number } & SourceCheckTargetSelection
): Promise<DueSourceCheckRow[]> {
  const now = input.now ?? new Date().toISOString();
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
