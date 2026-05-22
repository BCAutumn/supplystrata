import { createHash, randomUUID } from "node:crypto";
import type { DbClient, DbTxClient } from "@supplystrata/db";
import { parseSourcePolicyConfig } from "./policy-config.js";
import { calculateNextCheckAt } from "./scheduling.js";
import { ensureRegisteredSourceHealth, syncSourceHealthRegistry } from "./source-health-registry.js";
import { normalizeSourceCheckTargetSelection, uniqueCheckTargetIds } from "./source-check-target-selection.js";
import type { DueSourceCheckRow, NextCheckPolicyRow, SourceCheckTargetEnableRow, SourceHealthRow, SourceItemRow, SourcePolicyRow } from "./db-rows.js";
import type {
  DocumentObservationInput,
  DocumentObservationResult,
  SourceCheckTargetEnableInput,
  SourceCheckTargetEnableResult,
  SourceCheckTargetSelection,
  SourceCheckTargetInput,
  SourceDegradedInput,
  SourceDocumentChangeType,
  SourceFailureInput,
  SourcePolicyConfig,
  SourcePolicyInput
} from "./types.js";

export { parseSourcePolicyConfig } from "./policy-config.js";
export { calculateNextCheckAt } from "./scheduling.js";
export { listSourceTargetCoverage } from "./coverage.js";
export { syncSourceHealthRegistry } from "./source-health-registry.js";
export {
  claimDueSourceCheckJobs,
  enqueueAndClaimDueSourceCheckJobs,
  enqueueDueSourceCheckJobs,
  markSourceCheckJobFailed,
  markSourceCheckJobSucceeded
} from "./source-check-jobs.js";
export type {
  SourceTargetCoverageInput,
  SourceTargetCoverageItem,
  SourceTargetCoverageJob,
  SourceTargetCoverageMatchKind,
  SourceTargetCoverageState,
  SourceTargetCoverageEvent
} from "./coverage.js";
export type { DueSourceCheckRow, SourceCheckJobRow, SourceCheckJobStateRow, SourceHealthRow, SourcePolicyRow } from "./db-rows.js";
export type {
  DocumentObservationInput,
  DocumentObservationResult,
  SourceCheckJobStatus,
  SourceCheckTargetEnableInput,
  SourceCheckTargetEnableResult,
  SourceCheckTargetSelection,
  SourceCheckTargetInput,
  SourceDegradedInput,
  SourceDocumentChangeType,
  SourceFailureInput,
  SourcePolicyConfig,
  SourcePolicyInput
} from "./types.js";

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

function normalizeConfigSource(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error("source check target enable config_source must be a non-empty string");
  return normalized;
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
