import pg from "pg";
import { loadEnv } from "@supplystrata/config";
import { runMigrations } from "./migrations.js";

const { Pool } = pg;

export interface DbClient {
  query<T extends pg.QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<pg.QueryResult<T>>;
}

export function createPool(): pg.Pool {
  return new Pool({ connectionString: loadEnv().POSTGRES_URL });
}

export async function migrate(client: DbClient): Promise<void> {
  await runMigrations(client);
}
