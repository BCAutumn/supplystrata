import type { DbClient, DbTxClient } from "@supplystrata/db/write";
import { ensureRegisteredSourceHealth, syncSourceHealthRegistry } from "./source-health-registry.js";
import { uniqueCheckTargetIds } from "./source-check-target-selection.js";
import type { SourceCheckTargetEnableRow, SourceHealthRow } from "./db-rows.js";
import type { SourceCheckTargetEnableInput, SourceCheckTargetEnableResult, SourceCheckTargetInput, SourcePolicyConfig, SourcePolicyInput } from "./types.js";

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
