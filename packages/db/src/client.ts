import pg from "pg";
import { loadEnv } from "@supplystrata/config";
import { migrationSql } from "./schema.js";

const { Pool } = pg;

export interface DbClient {
  query<T extends pg.QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<pg.QueryResult<T>>;
}

export function createPool(): pg.Pool {
  return new Pool({ connectionString: loadEnv().POSTGRES_URL });
}

export async function migrate(client: DbClient): Promise<void> {
  // 多个 integration test worker 可能同时启动迁移；事务级 advisory lock 避免并发 CREATE TABLE 竞态。
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('supplystrata:migrate', 0));\n${migrationSql}`);
}
