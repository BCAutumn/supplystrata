import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import type { DbClient, DbTxClient } from "@supplystrata/db";
import { listSources, type SourceRegistryEntry } from "@supplystrata/source-registry";
import { parseSourcePolicyConfig } from "./policy-config.js";
import { calculateNextCheckAt } from "./scheduling.js";
import type {
  DocumentObservationInput,
  DocumentObservationResult,
  DueSourceCheckRow,
  SourceCheckJobRow,
  SourceCheckJobStateRow,
  SourceCheckTargetEnableInput,
  SourceCheckTargetEnableResult,
  SourceCheckTargetSelection,
  SourceCheckTargetInput,
  SourceDegradedInput,
  SourceDocumentChangeType,
  SourceFailureInput,
  SourceHealthRow,
  SourcePolicyConfig,
  SourcePolicyInput
} from "./types.js";

export { parseSourcePolicyConfig } from "./policy-config.js";
export { calculateNextCheckAt } from "./scheduling.js";
export { listSourceTargetCoverage } from "./coverage.js";
export type {
  SourceTargetCoverageInput,
  SourceTargetCoverageItem,
  SourceTargetCoverageJob,
  SourceTargetCoverageMatchKind,
  SourceTargetCoverageState,
  SourceTargetCoverageEvent
} from "./coverage.js";
export type {
  DocumentObservationInput,
  DocumentObservationResult,
  DueSourceCheckRow,
  SourceCheckJobRow,
  SourceCheckJobStateRow,
  SourceCheckJobStatus,
  SourceCheckTargetEnableInput,
  SourceCheckTargetEnableResult,
  SourceCheckTargetSelection,
  SourceCheckTargetInput,
  SourceDegradedInput,
  SourceDocumentChangeType,
  SourceFailureInput,
  SourceHealthRow,
  SourcePolicyConfig,
  SourcePolicyInput,
  SourcePolicyRow
} from "./types.js";

interface SourceItemRow extends pg.QueryResultRow {
  source_item_id: string;
  latest_doc_id: string | null;
  latest_bytes_sha256: string | null;
  latest_storage_key: string | null;
}

interface SourceHealthStateRow extends pg.QueryResultRow {
  failure_count: number;
  last_failure_at: Date | null;
  last_error_message: string | null;
}

interface NextCheckPolicyRow extends pg.QueryResultRow {
  check_cadence_minutes: number;
  jitter_minutes: number;
}

interface SourceCheckTargetEnableRow extends pg.QueryResultRow {
  check_target_id: string;
  status: "enabled" | "missing" | "blocked_unregistered" | "blocked_manual_only" | "blocked_rejected" | "blocked_unupdated";
  requires_key: boolean | null;
}

const DEFAULT_SOURCE_CHECK_JOB_LEASE_MINUTES = 15;

export async function syncSourceHealthRegistry(client: DbClient): Promise<{ upserted: number }> {
  const sources = listSources();
  for (const source of sources) {
    await upsertSourceHealth(client, source);
    // 默认策略只在首次建源时写入；外部配置同步后不能被默认值覆盖。
    await upsertDefaultSourcePolicy(client, source);
  }
  return { upserted: sources.length };
}

export async function listSourceHealthRows(client: DbClient): Promise<SourceHealthRow[]> {
  const result = await client.query<SourceHealthRow>(
    `SELECT h.source_adapter_id, h.tier, h.category, h.registry_status, h.automation, h.tos_url, h.official_url, h.requires_key,
            h.last_checked_at, h.last_success_at, h.last_failure_at, h.failure_count, h.last_change_at, h.last_error_message,
            p.enabled AS policy_enabled, p.check_cadence_minutes, p.jitter_minutes, p.priority, p.next_check_at,
            p.config_source AS policy_config_source, p.notes AS policy_notes
     FROM source_health h
     LEFT JOIN source_policies p ON p.source_adapter_id = h.source_adapter_id
     ORDER BY h.tier, p.priority NULLS LAST, h.source_adapter_id`
  );
  return result.rows;
}

export async function syncSourcePolicyConfig(client: DbClient, input: { config: SourcePolicyConfig; configSource: string }): Promise<{ upserted: number }> {
  await syncSourceHealthRegistry(client);
  for (const policy of input.config.policies) {
    await upsertSourcePolicy(client, policy, input.configSource);
  }
  for (const target of input.config.check_targets) {
    await upsertSourceCheckTarget(client, target, input.configSource);
  }
  return { upserted: input.config.policies.length + input.config.check_targets.length };
}

export async function enableSourceCheckTargets(client: DbClient, input: SourceCheckTargetEnableInput): Promise<SourceCheckTargetEnableResult> {
  const checkTargetIds = uniqueCheckTargetIds(input.check_target_ids);
  const configSource = normalizeConfigSource(input.config_source);
  if (checkTargetIds.length === 0) throw new Error("enable source check targets requires at least one check_target_id");
  await syncSourceHealthRegistry(client);
  const result = await client.query<SourceCheckTargetEnableRow>(
    `WITH requested AS (
       SELECT check_target_id, ordinality
       FROM unnest($1::text[]) WITH ORDINALITY AS ids(check_target_id, ordinality)
     ),
     matched AS (
       SELECT r.check_target_id, r.ordinality, t.source_adapter_id, h.automation, h.registry_status, h.requires_key
       FROM requested r
       LEFT JOIN source_check_targets t ON t.check_target_id = r.check_target_id
       LEFT JOIN source_health h ON h.source_adapter_id = t.source_adapter_id
     ),
     eligible AS (
       SELECT check_target_id
       FROM matched
       WHERE source_adapter_id IS NOT NULL
         AND automation IS NOT NULL
         AND registry_status IS NOT NULL
         AND automation <> 'manual_only'
         AND registry_status <> 'rejected'
     ),
     updated AS (
       UPDATE source_check_targets t
       SET enabled = true,
           next_check_at = COALESCE($2::timestamptz, t.next_check_at),
           check_cadence_minutes = COALESCE($3::int, t.check_cadence_minutes),
           jitter_minutes = COALESCE($4::int, t.jitter_minutes),
           max_attempts = COALESCE($5::int, t.max_attempts),
           backoff_base_minutes = COALESCE($6::int, t.backoff_base_minutes),
           backoff_max_minutes = COALESCE($7::int, t.backoff_max_minutes),
           config_source = $8,
           notes = COALESCE($9::text, t.notes),
           updated_at = now()
       FROM eligible e
       WHERE t.check_target_id = e.check_target_id
       RETURNING t.check_target_id
     )
     SELECT m.check_target_id,
            CASE
              WHEN m.source_adapter_id IS NULL THEN 'missing'
              WHEN m.automation IS NULL OR m.registry_status IS NULL THEN 'blocked_unregistered'
              WHEN m.automation = 'manual_only' THEN 'blocked_manual_only'
              WHEN m.registry_status = 'rejected' THEN 'blocked_rejected'
              WHEN u.check_target_id IS NULL THEN 'blocked_unupdated'
              ELSE 'enabled'
            END AS status,
            m.requires_key
     FROM matched m
     LEFT JOIN updated u ON u.check_target_id = m.check_target_id
     ORDER BY m.ordinality`,
    [
      checkTargetIds,
      input.next_check_at ?? null,
      input.check_cadence_minutes ?? null,
      input.jitter_minutes ?? null,
      input.max_attempts ?? null,
      input.backoff_base_minutes ?? null,
      input.backoff_max_minutes ?? null,
      configSource,
      input.notes ?? null
    ]
  );
  return summarizeSourceCheckTargetEnableRows(result.rows);
}

export async function ensureSourceCheckTarget(
  client: DbTxClient,
  input: { target: SourceCheckTargetInput; configSource: string }
): Promise<{ check_target_id: string }> {
  await ensureRegisteredSourceHealth(client, input.target.source_adapter_id);
  await upsertSourceCheckTarget(client, input.target, input.configSource);
  return { check_target_id: input.target.check_target_id };
}

export async function listDueSourceChecks(
  client: DbClient,
  input: { now?: string; limit?: number } & SourceCheckTargetSelection = {}
): Promise<DueSourceCheckRow[]> {
  const now = input.now ?? new Date().toISOString();
  const limit = input.limit ?? 50;
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
     LIMIT $2`,
    [now, limit, filter.check_target_ids, filter.source_adapter_ids]
  );
  return result.rows;
}

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

export async function recordDocumentObservation(client: DbTxClient, input: DocumentObservationInput): Promise<DocumentObservationResult> {
  const observedAt = input.observed_at ?? new Date().toISOString();
  const itemKey = input.item_key ?? input.source_url;
  const sourceItemId = sourceItemIdFor(input.source_adapter_id, itemKey);
  const healthBeforeSuccess = await ensureRegisteredSourceHealth(client, input.source_adapter_id);
  await lockSourceItemObservation(client, sourceItemId);
  const existing = await client.query<SourceItemRow>(
    `SELECT source_item_id, latest_doc_id, latest_bytes_sha256, latest_storage_key
     FROM source_items
     WHERE source_adapter_id = $1 AND item_key = $2
     FOR UPDATE`,
    [input.source_adapter_id, itemKey]
  );
  const previous = existing.rows[0];
  // 变化判断只看源快照 hash，不从标题、日期等易漂移字段猜测。
  const changeType = classifyDocumentChange(previous?.latest_bytes_sha256 ?? null, input.bytes_sha256);
  const eventId = `SEV-${randomUUID()}`;

  await client.query(
    `INSERT INTO source_items (source_item_id, source_adapter_id, item_key, url, latest_doc_id, latest_bytes_sha256, latest_storage_key, first_seen_at, last_seen_at, last_changed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9)
     ON CONFLICT (source_adapter_id, item_key) DO UPDATE SET
       url = EXCLUDED.url,
       latest_doc_id = EXCLUDED.latest_doc_id,
       latest_bytes_sha256 = EXCLUDED.latest_bytes_sha256,
       latest_storage_key = EXCLUDED.latest_storage_key,
       last_seen_at = EXCLUDED.last_seen_at,
       last_changed_at = COALESCE(EXCLUDED.last_changed_at, source_items.last_changed_at)`,
    [
      sourceItemId,
      input.source_adapter_id,
      itemKey,
      input.source_url,
      input.doc_id,
      input.bytes_sha256,
      input.storage_key,
      observedAt,
      changeType === "DOCUMENT_UNCHANGED" ? null : observedAt
    ]
  );
  await client.query(
    `INSERT INTO document_versions (version_id, source_item_id, doc_id, bytes_sha256, storage_key, observed_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (source_item_id, bytes_sha256) DO NOTHING`,
    [`DVER-${randomUUID()}`, sourceItemId, input.doc_id, input.bytes_sha256, input.storage_key, observedAt]
  );
  await client.query(
    `INSERT INTO source_change_events (event_id, event_type, source_adapter_id, source_item_id, doc_id, check_target_id, before, after, detected_at, caused_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      eventId,
      changeType,
      input.source_adapter_id,
      sourceItemId,
      input.doc_id,
      input.check_target_id ?? null,
      previous === undefined
        ? null
        : {
            doc_id: previous.latest_doc_id,
            bytes_sha256: previous.latest_bytes_sha256,
            storage_key: previous.latest_storage_key
          },
      {
        doc_id: input.doc_id,
        bytes_sha256: input.bytes_sha256,
        storage_key: input.storage_key
      },
      observedAt,
      input.caused_by ?? "source-monitor"
    ]
  );
  if (healthBeforeSuccess.failure_count > 0) {
    await client.query(
      `INSERT INTO source_change_events (event_id, event_type, source_adapter_id, source_item_id, doc_id, check_target_id, before, after, detected_at, caused_by)
       VALUES ($1,'SOURCE_RECOVERED',$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        `SEV-${randomUUID()}`,
        input.source_adapter_id,
        sourceItemId,
        input.doc_id,
        input.check_target_id ?? null,
        {
          failure_count: healthBeforeSuccess.failure_count,
          last_failure_at: healthBeforeSuccess.last_failure_at?.toISOString() ?? null,
          last_error_message: healthBeforeSuccess.last_error_message
        },
        {
          doc_id: input.doc_id,
          bytes_sha256: input.bytes_sha256
        },
        observedAt,
        input.caused_by ?? "source-monitor"
      ]
    );
  }
  await client.query(
    `UPDATE source_health
     SET last_checked_at = $2,
         last_success_at = $2,
         last_change_at = CASE WHEN $3 = 'DOCUMENT_UNCHANGED' THEN last_change_at ELSE $2 END,
         failure_count = 0,
         last_error_message = NULL,
         updated_at = now()
     WHERE source_adapter_id = $1`,
    [input.source_adapter_id, observedAt, changeType]
  );
  if (input.check_target_id !== undefined) {
    await updateSourceCheckTargetNextCheck(client, {
      checkTargetId: input.check_target_id,
      sourceAdapterId: input.source_adapter_id,
      baseTime: observedAt
    });
  } else {
    await updateSourcePolicyNextCheck(client, { sourceAdapterId: input.source_adapter_id, baseTime: observedAt });
  }
  return {
    source_item_id: sourceItemId,
    event_id: eventId,
    change_type: changeType,
    previous_doc_id: previous?.latest_doc_id ?? null,
    previous_bytes_sha256: previous?.latest_bytes_sha256 ?? null
  };
}

export async function recordSourceFailure(client: DbTxClient, input: SourceFailureInput): Promise<{ event_id: string }> {
  const failedAt = input.failed_at ?? new Date().toISOString();
  const healthBeforeFailure = await ensureRegisteredSourceHealth(client, input.source_adapter_id);
  const eventId = `SEV-${randomUUID()}`;
  await client.query(
    `INSERT INTO source_change_events (event_id, event_type, source_adapter_id, check_target_id, before, after, detected_at, caused_by)
     VALUES ($1,'SOURCE_FAILED',$2,$3,$4,$5,$6,$7)`,
    [
      eventId,
      input.source_adapter_id,
      input.check_target_id ?? null,
      {
        failure_count: healthBeforeFailure.failure_count,
        last_failure_at: healthBeforeFailure.last_failure_at?.toISOString() ?? null,
        last_error_message: healthBeforeFailure.last_error_message
      },
      {
        error_message: input.error_message,
        task_id: input.task_id,
        url: input.url
      },
      failedAt,
      input.caused_by ?? "source-monitor"
    ]
  );
  await client.query(
    `UPDATE source_health
     SET last_checked_at = $2,
         last_failure_at = $2,
         failure_count = failure_count + 1,
         last_error_message = $3,
         updated_at = now()
     WHERE source_adapter_id = $1`,
    [input.source_adapter_id, failedAt, input.error_message]
  );
  if (input.check_target_id !== undefined) {
    await updateSourceCheckTargetNextCheck(client, {
      checkTargetId: input.check_target_id,
      sourceAdapterId: input.source_adapter_id,
      baseTime: failedAt
    });
  } else {
    await updateSourcePolicyNextCheck(client, { sourceAdapterId: input.source_adapter_id, baseTime: failedAt });
  }
  return { event_id: eventId };
}

export async function recordSourceDegraded(client: DbTxClient, input: SourceDegradedInput): Promise<{ event_id: string }> {
  const degradedAt = input.degraded_at ?? new Date().toISOString();
  const healthBeforeFailure = await ensureRegisteredSourceHealth(client, input.source_adapter_id);
  const eventId = `SEV-${randomUUID()}`;
  await client.query(
    `INSERT INTO source_change_events (event_id, event_type, source_adapter_id, check_target_id, before, after, detected_at, caused_by)
     VALUES ($1,'SOURCE_DEGRADED',$2,$3,$4,$5,$6,$7)`,
    [
      eventId,
      input.source_adapter_id,
      input.check_target_id ?? null,
      {
        failure_count: healthBeforeFailure.failure_count,
        last_failure_at: healthBeforeFailure.last_failure_at?.toISOString() ?? null,
        last_error_message: healthBeforeFailure.last_error_message
      },
      {
        error_message: input.error_message,
        task_id: input.task_id,
        url: input.url,
        used_cache_fallback: true
      },
      degradedAt,
      input.caused_by ?? "source-monitor"
    ]
  );
  await client.query(
    `UPDATE source_health
     SET last_checked_at = $2,
         last_failure_at = $2,
         failure_count = failure_count + 1,
         last_error_message = $3,
         updated_at = now()
     WHERE source_adapter_id = $1`,
    [input.source_adapter_id, degradedAt, input.error_message]
  );
  if (input.check_target_id !== undefined) {
    await updateSourceCheckTargetNextCheck(client, {
      checkTargetId: input.check_target_id,
      sourceAdapterId: input.source_adapter_id,
      baseTime: degradedAt
    });
  } else {
    await updateSourcePolicyNextCheck(client, { sourceAdapterId: input.source_adapter_id, baseTime: degradedAt });
  }
  return { event_id: eventId };
}

export function classifyDocumentChange(previousSha256: string | null, nextSha256: string): SourceDocumentChangeType {
  if (previousSha256 === null) return "DOCUMENT_NEW";
  if (previousSha256 === nextSha256) return "DOCUMENT_UNCHANGED";
  return "DOCUMENT_CHANGED";
}

function sourceItemIdFor(sourceAdapterId: string, itemKey: string): string {
  return `SRCITEM-${createHash("sha256").update(`${sourceAdapterId}\n${itemKey}`).digest("hex").slice(0, 24)}`;
}

async function lockSourceItemObservation(client: DbTxClient, sourceItemId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [sourceItemId]);
}

async function upsertSourceHealth(client: DbClient, source: SourceRegistryEntry): Promise<void> {
  await client.query(
    `INSERT INTO source_health (source_adapter_id, tier, category, registry_status, automation, tos_url, official_url, requires_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (source_adapter_id) DO UPDATE SET
       tier = EXCLUDED.tier,
       category = EXCLUDED.category,
       registry_status = EXCLUDED.registry_status,
       automation = EXCLUDED.automation,
       tos_url = EXCLUDED.tos_url,
       official_url = EXCLUDED.official_url,
       requires_key = EXCLUDED.requires_key,
       updated_at = now()`,
    [source.id, source.tier, source.category, source.status, source.automation, source.tos_url, source.official_url, source.requires_key]
  );
}

async function ensureRegisteredSourceHealth(client: DbClient, sourceAdapterId: string): Promise<SourceHealthStateRow> {
  const source = listSources().find((entry) => entry.id === sourceAdapterId);
  if (source === undefined) throw new Error(`Unknown source_adapter_id: ${sourceAdapterId}`);
  await upsertSourceHealth(client, source);
  await upsertDefaultSourcePolicy(client, source);
  const result = await client.query<SourceHealthStateRow>(
    `SELECT failure_count, last_failure_at, last_error_message
     FROM source_health
     WHERE source_adapter_id = $1`,
    [sourceAdapterId]
  );
  return result.rows[0] ?? { failure_count: 0, last_failure_at: null, last_error_message: null };
}

async function upsertDefaultSourcePolicy(client: DbClient, source: SourceRegistryEntry): Promise<void> {
  const policy = defaultPolicyForSource(source);
  await client.query(
    `INSERT INTO source_policies (
       source_adapter_id, enabled, check_cadence_minutes, jitter_minutes, priority,
       max_attempts, backoff_base_minutes, backoff_max_minutes, config_source, notes
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'default',$9)
     ON CONFLICT (source_adapter_id) DO NOTHING`,
    [
      policy.source_adapter_id,
      policy.enabled,
      policy.check_cadence_minutes,
      policy.jitter_minutes ?? 0,
      policy.priority ?? 100,
      policy.max_attempts ?? 3,
      policy.backoff_base_minutes ?? 1,
      policy.backoff_max_minutes ?? 60,
      policy.notes ?? null
    ]
  );
}

async function upsertSourcePolicy(client: DbClient, policy: SourcePolicyInput, configSource: string): Promise<void> {
  const hasNextCheckAt = hasOwn(policy, "next_check_at");
  await client.query(
    `INSERT INTO source_policies (
       source_adapter_id, enabled, check_cadence_minutes, jitter_minutes, priority,
       max_attempts, backoff_base_minutes, backoff_max_minutes, config_source, next_check_at, notes, updated_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11,now())
     ON CONFLICT (source_adapter_id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       check_cadence_minutes = EXCLUDED.check_cadence_minutes,
       jitter_minutes = EXCLUDED.jitter_minutes,
       priority = EXCLUDED.priority,
       max_attempts = EXCLUDED.max_attempts,
       backoff_base_minutes = EXCLUDED.backoff_base_minutes,
       backoff_max_minutes = EXCLUDED.backoff_max_minutes,
       config_source = EXCLUDED.config_source,
       next_check_at = CASE WHEN $12::boolean THEN EXCLUDED.next_check_at ELSE source_policies.next_check_at END,
       notes = EXCLUDED.notes,
       updated_at = now()`,
    [
      policy.source_adapter_id,
      policy.enabled,
      policy.check_cadence_minutes,
      policy.jitter_minutes ?? 0,
      policy.priority ?? 100,
      policy.max_attempts ?? 3,
      policy.backoff_base_minutes ?? 1,
      policy.backoff_max_minutes ?? 60,
      configSource,
      policy.next_check_at ?? null,
      policy.notes ?? null,
      hasNextCheckAt
    ]
  );
}

async function upsertSourceCheckTarget(client: DbClient, target: SourceCheckTargetInput, configSource: string): Promise<void> {
  const hasNextCheckAt = hasOwn(target, "next_check_at");
  await client.query(
    `INSERT INTO source_check_targets (
       check_target_id, source_adapter_id, target_kind, subject_entity_id, enabled, priority,
       next_check_at, check_cadence_minutes, jitter_minutes, max_attempts, backoff_base_minutes, backoff_max_minutes,
       target_config, config_source, notes, updated_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,now())
     ON CONFLICT (check_target_id) DO UPDATE SET
       source_adapter_id = EXCLUDED.source_adapter_id,
       target_kind = EXCLUDED.target_kind,
       subject_entity_id = EXCLUDED.subject_entity_id,
       enabled = EXCLUDED.enabled,
       priority = EXCLUDED.priority,
       check_cadence_minutes = EXCLUDED.check_cadence_minutes,
       jitter_minutes = EXCLUDED.jitter_minutes,
       max_attempts = EXCLUDED.max_attempts,
       backoff_base_minutes = EXCLUDED.backoff_base_minutes,
       backoff_max_minutes = EXCLUDED.backoff_max_minutes,
       next_check_at = CASE WHEN $16::boolean THEN EXCLUDED.next_check_at ELSE source_check_targets.next_check_at END,
       target_config = EXCLUDED.target_config,
       config_source = EXCLUDED.config_source,
       notes = EXCLUDED.notes,
       updated_at = now()`,
    [
      target.check_target_id,
      target.source_adapter_id,
      target.target_kind,
      target.subject_entity_id ?? null,
      target.enabled,
      target.priority ?? 100,
      target.next_check_at ?? null,
      target.check_cadence_minutes ?? null,
      target.jitter_minutes ?? null,
      target.max_attempts ?? null,
      target.backoff_base_minutes ?? null,
      target.backoff_max_minutes ?? null,
      JSON.stringify(target.target_config),
      configSource,
      target.notes ?? null,
      hasNextCheckAt
    ]
  );
}

async function updateSourcePolicyNextCheck(client: DbClient, input: { sourceAdapterId: string; baseTime: string }): Promise<void> {
  const policy = await loadNextCheckPolicy(client, input.sourceAdapterId);
  const nextCheckAt = calculateNextCheckAt({
    baseTime: input.baseTime,
    cadenceMinutes: policy.check_cadence_minutes,
    jitterMinutes: policy.jitter_minutes,
    jitterSeed: `policy:${input.sourceAdapterId}`
  });
  await client.query(
    `UPDATE source_policies
     SET next_check_at = $2::timestamptz,
         updated_at = now()
     WHERE source_adapter_id = $1`,
    [input.sourceAdapterId, nextCheckAt]
  );
}

async function updateSourceCheckTargetNextCheck(client: DbClient, input: { checkTargetId: string; sourceAdapterId: string; baseTime: string }): Promise<void> {
  const policy = await loadNextCheckPolicyForTarget(client, { sourceAdapterId: input.sourceAdapterId, checkTargetId: input.checkTargetId });
  const nextCheckAt = calculateNextCheckAt({
    baseTime: input.baseTime,
    cadenceMinutes: policy.check_cadence_minutes,
    jitterMinutes: policy.jitter_minutes,
    jitterSeed: `target:${input.sourceAdapterId}:${input.checkTargetId}`
  });
  await client.query(
    `UPDATE source_check_targets t
     SET next_check_at = $3::timestamptz,
         updated_at = now()
     FROM source_policies p
     WHERE t.check_target_id = $1
       AND t.source_adapter_id = $2
       AND p.source_adapter_id = t.source_adapter_id`,
    [input.checkTargetId, input.sourceAdapterId, nextCheckAt]
  );
}

async function loadNextCheckPolicyForTarget(client: DbClient, input: { sourceAdapterId: string; checkTargetId: string }): Promise<NextCheckPolicyRow> {
  const result = await client.query<NextCheckPolicyRow>(
    `SELECT COALESCE(t.check_cadence_minutes, p.check_cadence_minutes) AS check_cadence_minutes,
            COALESCE(t.jitter_minutes, p.jitter_minutes) AS jitter_minutes
     FROM source_check_targets t
     JOIN source_policies p ON p.source_adapter_id = t.source_adapter_id
     WHERE t.check_target_id = $1
       AND t.source_adapter_id = $2`,
    [input.checkTargetId, input.sourceAdapterId]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Source target policy not found while scheduling next check: ${input.checkTargetId}`);
  return row;
}

async function loadNextCheckPolicy(client: DbClient, sourceAdapterId: string): Promise<NextCheckPolicyRow> {
  const result = await client.query<NextCheckPolicyRow>(
    `SELECT check_cadence_minutes, jitter_minutes
     FROM source_policies
     WHERE source_adapter_id = $1`,
    [sourceAdapterId]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Source policy not found while scheduling next check: ${sourceAdapterId}`);
  return row;
}

function uniqueCheckTargetIds(values: readonly string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function normalizeSourceCheckTargetSelection(input: SourceCheckTargetSelection): { check_target_ids: string[] | null; source_adapter_ids: string[] | null } {
  return {
    check_target_ids: normalizeOptionalTextList(input.check_target_ids),
    source_adapter_ids: normalizeOptionalTextList(input.source_adapter_ids)
  };
}

function normalizeOptionalTextList(values: readonly string[] | undefined): string[] | null {
  if (values === undefined) return null;
  const normalized = uniqueCheckTargetIds(values);
  if (normalized.length === 0) throw new Error("source check target selection cannot be empty when provided");
  return normalized;
}

function normalizeConfigSource(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error("source check target enable config_source must be a non-empty string");
  return normalized;
}

function normalizeLeaseMinutes(value: number | undefined): number {
  if (value === undefined) return DEFAULT_SOURCE_CHECK_JOB_LEASE_MINUTES;
  if (!Number.isInteger(value) || value < 1) throw new Error("source check job lease_minutes must be a positive integer");
  return value;
}

function hasOwn<TObject extends object, TKey extends PropertyKey>(value: TObject, key: TKey): value is TObject & Record<TKey, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function summarizeSourceCheckTargetEnableRows(rows: readonly SourceCheckTargetEnableRow[]): SourceCheckTargetEnableResult {
  const enabled = rows.filter((row) => row.status === "enabled");
  const missing = rows.filter((row) => row.status === "missing");
  const blocked = rows.filter(
    (row) =>
      row.status === "blocked_unregistered" || row.status === "blocked_manual_only" || row.status === "blocked_rejected" || row.status === "blocked_unupdated"
  );
  const credentialRequired = enabled.filter((row) => row.requires_key === true);
  return {
    requested_targets: rows.length,
    updated_targets: enabled.length,
    missing_targets: missing.length,
    blocked_targets: blocked.length,
    credential_required_targets: credentialRequired.length,
    enabled_check_target_ids: enabled.map((row) => row.check_target_id),
    missing_check_target_ids: missing.map((row) => row.check_target_id),
    blocked_check_target_ids: blocked.map((row) => row.check_target_id),
    credential_required_check_target_ids: credentialRequired.map((row) => row.check_target_id)
  };
}

function defaultPolicyForSource(source: SourceRegistryEntry): SourcePolicyInput {
  if (source.automation === "manual_only" || source.status === "rejected") {
    return {
      source_adapter_id: source.id,
      enabled: false,
      check_cadence_minutes: 10_080,
      priority: 900,
      notes: "Manual-only or rejected source; never auto scheduled by default."
    };
  }
  if (source.status === "implemented") {
    return {
      source_adapter_id: source.id,
      enabled: true,
      check_cadence_minutes: 1_440,
      jitter_minutes: 60,
      priority: 20,
      notes: "Implemented P0 source; daily check by default."
    };
  }
  return {
    source_adapter_id: source.id,
    enabled: source.automation === "allowed",
    check_cadence_minutes: 10_080,
    jitter_minutes: 240,
    priority: 100,
    notes: "Preview/scoped source; weekly check by default when automation is allowed."
  };
}
