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
export type {
  DocumentObservationInput,
  DocumentObservationResult,
  DueSourceCheckRow,
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

export async function ensureSourceCheckTarget(
  client: DbTxClient,
  input: { target: SourceCheckTargetInput; configSource: string }
): Promise<{ check_target_id: string }> {
  await ensureRegisteredSourceHealth(client, input.target.source_adapter_id);
  await upsertSourceCheckTarget(client, input.target, input.configSource);
  return { check_target_id: input.target.check_target_id };
}

export async function listDueSourceChecks(client: DbClient, input: { now?: string; limit?: number } = {}): Promise<DueSourceCheckRow[]> {
  const now = input.now ?? new Date().toISOString();
  const limit = input.limit ?? 50;
  const result = await client.query<DueSourceCheckRow>(
    `SELECT t.check_target_id, t.source_adapter_id, t.target_kind, t.subject_entity_id, t.target_config,
            t.enabled AS target_enabled, t.priority AS target_priority, t.config_source AS target_config_source, t.notes AS target_notes,
            p.enabled AS policy_enabled, p.check_cadence_minutes, p.jitter_minutes, p.priority AS policy_priority,
            p.config_source AS policy_config_source, COALESCE(t.next_check_at, p.next_check_at) AS next_check_at,
            p.notes AS policy_notes
     FROM source_check_targets t
     JOIN source_policies p ON p.source_adapter_id = t.source_adapter_id
     WHERE t.enabled = true
       AND p.enabled = true
       AND (COALESCE(t.next_check_at, p.next_check_at) IS NULL OR COALESCE(t.next_check_at, p.next_check_at) <= $1::timestamptz)
     ORDER BY p.priority, t.priority, COALESCE(t.next_check_at, p.next_check_at) NULLS FIRST, t.check_target_id
     LIMIT $2`,
    [now, limit]
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
    `INSERT INTO source_change_events (event_id, event_type, source_adapter_id, source_item_id, doc_id, before, after, detected_at, caused_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      eventId,
      changeType,
      input.source_adapter_id,
      sourceItemId,
      input.doc_id,
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
      `INSERT INTO source_change_events (event_id, event_type, source_adapter_id, source_item_id, doc_id, before, after, detected_at, caused_by)
       VALUES ($1,'SOURCE_RECOVERED',$2,$3,$4,$5,$6,$7,$8)`,
      [
        `SEV-${randomUUID()}`,
        input.source_adapter_id,
        sourceItemId,
        input.doc_id,
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
    `INSERT INTO source_change_events (event_id, event_type, source_adapter_id, before, after, detected_at, caused_by)
     VALUES ($1,'SOURCE_FAILED',$2,$3,$4,$5,$6)`,
    [
      eventId,
      input.source_adapter_id,
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
    `INSERT INTO source_change_events (event_id, event_type, source_adapter_id, before, after, detected_at, caused_by)
     VALUES ($1,'SOURCE_DEGRADED',$2,$3,$4,$5,$6)`,
    [
      eventId,
      input.source_adapter_id,
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
    `INSERT INTO source_policies (source_adapter_id, enabled, check_cadence_minutes, jitter_minutes, priority, config_source, notes)
     VALUES ($1,$2,$3,$4,$5,'default',$6)
     ON CONFLICT (source_adapter_id) DO NOTHING`,
    [policy.source_adapter_id, policy.enabled, policy.check_cadence_minutes, policy.jitter_minutes ?? 0, policy.priority ?? 100, policy.notes ?? null]
  );
}

async function upsertSourcePolicy(client: DbClient, policy: SourcePolicyInput, configSource: string): Promise<void> {
  await client.query(
    `INSERT INTO source_policies (source_adapter_id, enabled, check_cadence_minutes, jitter_minutes, priority, config_source, notes, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now())
     ON CONFLICT (source_adapter_id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       check_cadence_minutes = EXCLUDED.check_cadence_minutes,
       jitter_minutes = EXCLUDED.jitter_minutes,
       priority = EXCLUDED.priority,
       config_source = EXCLUDED.config_source,
       notes = EXCLUDED.notes,
       updated_at = now()`,
    [
      policy.source_adapter_id,
      policy.enabled,
      policy.check_cadence_minutes,
      policy.jitter_minutes ?? 0,
      policy.priority ?? 100,
      configSource,
      policy.notes ?? null
    ]
  );
}

async function upsertSourceCheckTarget(client: DbClient, target: SourceCheckTargetInput, configSource: string): Promise<void> {
  await client.query(
    `INSERT INTO source_check_targets (check_target_id, source_adapter_id, target_kind, subject_entity_id, enabled, priority, target_config, config_source, notes, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,now())
     ON CONFLICT (check_target_id) DO UPDATE SET
       source_adapter_id = EXCLUDED.source_adapter_id,
       target_kind = EXCLUDED.target_kind,
       subject_entity_id = EXCLUDED.subject_entity_id,
       enabled = EXCLUDED.enabled,
       priority = EXCLUDED.priority,
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
      JSON.stringify(target.target_config),
      configSource,
      target.notes ?? null
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
  const policy = await loadNextCheckPolicy(client, input.sourceAdapterId);
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
