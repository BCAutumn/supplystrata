import type { DbClient } from "./client.js";
import { sql as currentSchemaBaselineSql } from "./migration-sql/0001_current_schema_baseline.js";

export interface Migration {
  readonly id: string;
  readonly description: string;
  readonly sql: string;
  readonly supersedes?: readonly string[];
}

const HISTORICAL_MIGRATION_IDS = [
  "0001_entity_core",
  "0002_documents_graph",
  "0003_source_monitoring",
  "0004_review_quality",
  "0005_remove_legacy_review_queue",
  "0006_claims_observations_chain_views",
  "0007_source_check_targets",
  "0008_claim_drafts",
  "0009_review_queue_hardening",
  "0010_graph_projection_jobs",
  "0011_graph_projection_in_progress",
  "0012_observation_type_contract",
  "0013_edge_intelligence_context",
  "0014_risk_views",
  "0015_alert_candidates",
  "0016_source_check_jobs",
  "0017_source_monitoring_controls",
  "0018_edge_calibration",
  "0019_risk_metric_kind_contract",
  "0020_weighted_node_knockout_metric",
  "0021_financial_metric_observation_type",
  "0022_financial_peer_metric_kind",
  "0023_source_event_check_target",
  "0024_source_event_check_target_loose_ref",
  "0025_source_check_job_lease",
  "0026_claim_human_edit_guard",
  "0027_observation_calibration",
  "0028_ranking_calibration",
  "0029_policy_constraint_alert_kind",
  "0030_ai_analysis_runs",
  "0031_research_runs"
] as const;

const MIGRATIONS: readonly Migration[] = [
  {
    id: "0001_current_schema_baseline",
    description: "Create the current SupplyStrata runtime ledger schema.",
    sql: currentSchemaBaselineSql,
    supersedes: HISTORICAL_MIGRATION_IDS
  }
];

interface MigrationRow {
  migration_id: string;
}

export async function runMigrations(client: DbClient): Promise<{ applied: string[]; skipped: string[] }> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('supplystrata:migrate', 0))");
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       migration_id TEXT PRIMARY KEY,
       description TEXT NOT NULL,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  );

  const applied: string[] = [];
  const skipped: string[] = [];
  for (const migration of MIGRATIONS) {
    const existing = await client.query<MigrationRow>("SELECT migration_id FROM schema_migrations WHERE migration_id = $1", [migration.id]);
    if (existing.rows[0] !== undefined) {
      skipped.push(migration.id);
      continue;
    }
    if (await recordSquashedMigrationIfAlreadyApplied(client, migration)) {
      skipped.push(migration.id);
      continue;
    }
    await client.query(migration.sql);
    await recordAppliedMigration(client, migration);
    applied.push(migration.id);
  }
  return { applied, skipped };
}

async function recordSquashedMigrationIfAlreadyApplied(client: DbClient, migration: Migration): Promise<boolean> {
  if (migration.supersedes === undefined || migration.supersedes.length === 0) return false;
  const result = await client.query<MigrationRow>("SELECT migration_id FROM schema_migrations WHERE migration_id = ANY($1)", [[...migration.supersedes]]);
  if (result.rows.length === 0) return false;
  if (result.rows.length !== migration.supersedes.length) {
    throw new Error(
      `Database has a partial historical migration chain (${result.rows.length}/${migration.supersedes.length}); reset the local database before applying ${migration.id}.`
    );
  }
  // 迁移历史已经被 squash；给已有本地库补记 baseline，避免重复执行 CREATE/ALTER。
  await recordAppliedMigration(client, migration);
  return true;
}

async function recordAppliedMigration(client: DbClient, migration: Migration): Promise<void> {
  await client.query("INSERT INTO schema_migrations (migration_id, description) VALUES ($1,$2)", [migration.id, migration.description]);
}
