import type pg from "pg";
import { describe, expect, it } from "vitest";
import { envSchema } from "@supplystrata/config";
import { dbTxClientBrand, type DatabaseStore, type DbTxClient } from "@supplystrata/db";
import type { SupplyStrataLogger } from "@supplystrata/observability";
import { parseSourceCheckWorkerOptions, shouldShowSourceCheckWorkerHelp } from "../../apps/worker/src/options.js";
import { runSourceCheckWorkerCycle } from "../../apps/worker/src/source-check-worker.js";

describe("source check worker", () => {
  it("parses worker options from CLI args before environment defaults", () => {
    const options = parseSourceCheckWorkerOptions(["--once", "--interval-ms", "5000", "--limit=7"], {
      SUPPLYSTRATA_WORKER_INTERVAL_MS: "60000",
      SUPPLYSTRATA_WORKER_LIMIT: "3"
    });

    expect(options).toEqual({ once: true, interval_ms: 5000, limit: 7 });
    expect(shouldShowSourceCheckWorkerHelp(["--help"])).toBe(true);
  });

  it("runs a source-check worker cycle through the shared run-due use-case", async () => {
    const store = new NoopDatabaseStore();

    const result = await runSourceCheckWorkerCycle({ store, env: envSchema.parse({}), limit: 5, logger: noopLogger });

    expect(result).toMatchObject({
      due_targets: 0,
      enqueued_jobs: 0,
      claimed_jobs: 0,
      checked_targets: 0,
      failed_targets: 0,
      dead_jobs: 0
    });
    expect(store.txClient.calls.some((sql) => sql.includes("source_check_jobs"))).toBe(true);
  });
});

const noopLogger: SupplyStrataLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {}
};

class NoopDatabaseStore implements DatabaseStore {
  readonly adapter_id = "noop";
  readonly txClient = new NoopTxClient();

  async query<T extends pg.QueryResultRow>(): Promise<pg.QueryResult<T>> {
    return { command: "NOOP", rowCount: 0, oid: 0, fields: [], rows: [] };
  }

  async transaction<T>(fn: (client: DbTxClient) => Promise<T>): Promise<T> {
    return fn(this.txClient);
  }

  async close(): Promise<void> {}
}

class NoopTxClient implements DbTxClient {
  readonly [dbTxClientBrand]: true = true;
  readonly calls: string[] = [];

  async query<T extends pg.QueryResultRow>(sql: string): Promise<pg.QueryResult<T>> {
    this.calls.push(sql);
    return { command: "NOOP", rowCount: 0, oid: 0, fields: [], rows: [] };
  }
}
