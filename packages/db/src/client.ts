import pg from "pg";
import { loadEnv } from "@supplystrata/config";
import { runMigrations } from "./migrations.js";

const { Pool } = pg;

export interface DbClient {
  query<T extends pg.QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<pg.QueryResult<T>>;
}

interface DbConnection extends DbClient {
  release(): void;
}

export interface DatabaseStore extends DbClient {
  readonly adapter_id: string;
  transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface PostgresDatabaseStoreOptions {
  connectionString?: string;
  pool?: pg.Pool;
}

export class PostgresDatabaseStore implements DatabaseStore {
  readonly adapter_id = "postgres";
  readonly #pool: pg.Pool;
  readonly #ownsPool: boolean;

  constructor(options: PostgresDatabaseStoreOptions = {}) {
    this.#pool = options.pool ?? new Pool({ connectionString: options.connectionString ?? loadEnv().POSTGRES_URL });
    this.#ownsPool = options.pool === undefined;
  }

  async query<T extends pg.QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<pg.QueryResult<T>> {
    return this.#pool.query<T>(sql, params === undefined ? undefined : [...params]);
  }

  async transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (!this.#ownsPool) return;
    await this.#pool.end();
  }
}

export function createDatabaseStore(options: PostgresDatabaseStoreOptions = {}): DatabaseStore {
  return new PostgresDatabaseStore(options);
}

export async function migrate(store: DatabaseStore): Promise<void> {
  await store.transaction(async (client) => {
    await runMigrations(client);
  });
}

async function rollbackQuietly(client: DbClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // 回滚失败不能覆盖原始错误；调用方更需要看到真正导致事务失败的原因。
  }
}
