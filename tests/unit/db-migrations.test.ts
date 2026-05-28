import type pg from "pg";
import { describe, expect, it } from "vitest";
import { runMigrations } from "@supplystrata/db/admin";
import type { DbClient } from "@supplystrata/db/read";

describe("db migrations", () => {
  it("applies the squashed baseline on an empty database", async () => {
    const client = new MigrationRecordingDbClient();

    const result = await runMigrations(client);

    expect(result).toEqual({ applied: ["0001_current_schema_baseline"], skipped: [] });
    expect(client.executedSql.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS entity_master"))).toBe(true);
    expect(client.insertedMigrationIds).toEqual(["0001_current_schema_baseline"]);
  });

  it("records the baseline marker when the historical chain is already applied", async () => {
    const client = new MigrationRecordingDbClient({ historicalApplied: true });

    const result = await runMigrations(client);

    expect(result).toEqual({ applied: [], skipped: ["0001_current_schema_baseline"] });
    expect(client.executedSql.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS entity_master"))).toBe(false);
    expect(client.insertedMigrationIds).toEqual(["0001_current_schema_baseline"]);
  });
});

class MigrationRecordingDbClient implements DbClient {
  readonly executedSql: string[] = [];
  readonly insertedMigrationIds: string[] = [];
  private readonly historicalApplied: boolean;

  constructor(input: { historicalApplied?: boolean } = {}) {
    this.historicalApplied = input.historicalApplied ?? false;
  }

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.executedSql.push(sql);
    if (sql.includes("SELECT migration_id FROM schema_migrations WHERE migration_id = $1")) {
      return resultRows<T>([]);
    }
    if (sql.includes("SELECT migration_id FROM schema_migrations WHERE migration_id = ANY($1)")) {
      const ids = stringArrayParam(params[0]);
      return resultRows<T>(this.historicalApplied ? ids.map((migration_id) => ({ migration_id })) : []);
    }
    if (sql.includes("INSERT INTO schema_migrations")) {
      this.insertedMigrationIds.push(stringParam(params[0]));
    }
    return resultRows<T>([]);
  }
}

function stringParam(value: unknown): string {
  if (typeof value !== "string") throw new Error("expected string query param");
  return value;
}

function stringArrayParam(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error("expected string array query param");
  return value;
}

function resultRows<T extends pg.QueryResultRow>(rows: Record<string, unknown>[]): pg.QueryResult<T> {
  return {
    command: "MOCK",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: rows as T[]
  };
}
