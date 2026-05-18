import type { DbClient } from "./client.js";
import { migration0001EntityCoreSql } from "./migration-sql/0001_entity_core.js";
import { migration0002DocumentsGraphSql } from "./migration-sql/0002_documents_graph.js";
import { migration0003SourceMonitoringSql } from "./migration-sql/0003_source_monitoring.js";
import { migration0004ReviewQualitySql } from "./migration-sql/0004_review_quality.js";
import { migration0005RemoveLegacyReviewQueueSql } from "./migration-sql/0005_remove_legacy_review_queue.js";
import { migration0006ClaimsObservationsChainViewsSql } from "./migration-sql/0006_claims_observations_chain_views.js";
import { migration0007SourceCheckTargetsSql } from "./migration-sql/0007_source_check_targets.js";
import { migration0008ClaimDraftsSql } from "./migration-sql/0008_claim_drafts.js";

interface Migration {
  readonly id: string;
  readonly description: string;
  readonly sql: string;
}

const MIGRATIONS: readonly Migration[] = [
  {
    id: "0001_entity_core",
    description: "Create entity, alias, and component taxonomy tables.",
    sql: migration0001EntityCoreSql
  },
  {
    id: "0002_documents_graph",
    description: "Create document, evidence, edge, and change-record tables.",
    sql: migration0002DocumentsGraphSql
  },
  {
    id: "0003_source_monitoring",
    description: "Create source health, fetch-run, version, and change-event tables.",
    sql: migration0003SourceMonitoringSql
  },
  {
    id: "0004_review_quality",
    description: "Create unknown-map, review-candidate, rejection, and pending-entity tables.",
    sql: migration0004ReviewQualitySql
  },
  {
    id: "0005_remove_legacy_review_queue",
    description: "Remove obsolete extraction_review_queue after review_candidates became the single review store.",
    sql: migration0005RemoveLegacyReviewQueueSql
  },
  {
    id: "0006_claims_observations_chain_views",
    description: "Create claim, observation, lead, and chain-view contract tables.",
    sql: migration0006ClaimsObservationsChainViewsSql
  },
  {
    id: "0007_source_check_targets",
    description: "Create configurable source check targets for scheduled monitoring.",
    sql: migration0007SourceCheckTargetsSql
  },
  {
    id: "0008_claim_drafts",
    description: "Allow reviewed semantic changes to create non-active claim drafts.",
    sql: migration0008ClaimDraftsSql
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
    await client.query(migration.sql);
    await client.query("INSERT INTO schema_migrations (migration_id, description) VALUES ($1,$2)", [migration.id, migration.description]);
    applied.push(migration.id);
  }
  return { applied, skipped };
}
