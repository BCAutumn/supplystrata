import type { DbClient } from "./client.js";
import { migrationSql } from "./schema.js";

interface Migration {
  readonly id: string;
  readonly description: string;
  readonly sql: string;
}

const MIGRATIONS: readonly Migration[] = [
  {
    id: "0001_baseline_schema",
    description: "Create SupplyStrata baseline Postgres schema.",
    sql: migrationSql
  },
  {
    id: "0002_drop_extraction_review_queue",
    description: "Remove obsolete extraction_review_queue after review_candidates became the single review store.",
    sql: "DROP TABLE IF EXISTS extraction_review_queue"
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
