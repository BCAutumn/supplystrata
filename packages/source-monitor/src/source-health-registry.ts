import type { DbClient } from "@supplystrata/db";
import { listSources, type SourceRegistryEntry } from "@supplystrata/source-registry";
import type { SourceHealthStateRow } from "./db-rows.js";
import type { SourcePolicyInput } from "./types.js";

export async function syncSourceHealthRegistry(client: DbClient): Promise<{ upserted: number }> {
  const sources = listSources();
  for (const source of sources) {
    await upsertSourceHealth(client, source);
    // 默认策略只在首次建源时写入；外部配置同步后不能被默认值覆盖。
    await upsertDefaultSourcePolicy(client, source);
  }
  return { upserted: sources.length };
}

export async function ensureRegisteredSourceHealth(client: DbClient, sourceAdapterId: string): Promise<SourceHealthStateRow> {
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
