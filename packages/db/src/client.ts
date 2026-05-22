import pg from "pg";
import { runMigrations } from "./migrations.js";

const { Pool } = pg;

export interface DbClient {
  query<T extends pg.QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<pg.QueryResult<T>>;
}

export const dbTxClientBrand = Symbol("supplystrata.db.tx");

export interface DbTxClient extends DbClient {
  readonly [dbTxClientBrand]: true;
}

export interface DbRow extends pg.QueryResultRow {}

export interface DatabaseStore {
  readonly adapter_id: string;
  readonly read: DbClient;
  transaction<T>(fn: (client: DbTxClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export type PostgresDatabaseStoreOptions = { connectionString: string; pool?: never } | { pool: pg.Pool; connectionString?: never };

export class PostgresDatabaseStore implements DatabaseStore {
  readonly adapter_id = "postgres";
  readonly #pool: pg.Pool;
  readonly #ownsPool: boolean;
  readonly read: DbClient;

  constructor(options: PostgresDatabaseStoreOptions) {
    this.#pool = options.pool ?? new Pool({ connectionString: options.connectionString });
    this.#ownsPool = options.pool === undefined;
    this.read = {
      query: (sql, params) => this.#pool.query(sql, params === undefined ? undefined : [...params])
    };
  }

  async transaction<T>(fn: (client: DbTxClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    const txClient: DbTxClient = {
      [dbTxClientBrand]: true,
      query(sql, params) {
        return client.query(sql, params === undefined ? undefined : [...params]);
      }
    };
    try {
      await client.query("BEGIN");
      const result = await fn(txClient);
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

export function createDatabaseStore(options: PostgresDatabaseStoreOptions): DatabaseStore {
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
