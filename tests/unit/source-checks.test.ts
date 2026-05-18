import { describe, expect, it } from "vitest";
import type pg from "pg";
import { listSourceCheckConnectorIds, runManualSourceCheck } from "@supplystrata/source-workflows";
import { dbTxClientBrand, type DatabaseStore, type DbTxClient } from "@supplystrata/db";

describe("source check registry", () => {
  it("publishes registered source check connector ids", () => {
    expect(listSourceCheckConnectorIds()).toEqual(
      expect.arrayContaining(["sec-edgar/sec-company-filings", "census-trade/trade-flow-observation", "osh/facility-search"])
    );
  });

  it("fails manual source checks through the connector registry instead of CLI branches", async () => {
    await expect(
      runManualSourceCheck(new NoopDatabaseStore(), {
        source_adapter_id: "unknown-source",
        target_config: {}
      })
    ).rejects.toThrow("Unsupported due source target: unknown-source/(unspecified)");
  });
});

class NoopDatabaseStore implements DatabaseStore {
  readonly adapter_id = "noop";

  async query<T extends pg.QueryResultRow>(): Promise<pg.QueryResult<T>> {
    return { command: "NOOP", rowCount: 0, oid: 0, fields: [], rows: [] };
  }

  async transaction<T>(fn: (client: DbTxClient) => Promise<T>): Promise<T> {
    return fn(new NoopTxClient());
  }

  async close(): Promise<void> {}
}

class NoopTxClient implements DbTxClient {
  readonly [dbTxClientBrand] = true;

  async query<T extends pg.QueryResultRow>(): Promise<pg.QueryResult<T>> {
    return { command: "NOOP", rowCount: 0, oid: 0, fields: [], rows: [] };
  }
}
