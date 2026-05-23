import { describe, expect, it } from "vitest";
import type pg from "pg";
import { envSchema } from "@supplystrata/config";
import {
  listRegisteredSourceCheckConnectorCapabilities,
  listSourceCheckConnectorIds,
  runDueSourceChecks,
  runManualSourceCheck
} from "@supplystrata/source-workflows";
import { dbTxClientBrand, type DatabaseStore, type DbTxClient } from "@supplystrata/db/write";

describe("source check registry", () => {
  it("publishes registered source check connector ids", () => {
    expect(listSourceCheckConnectorIds()).toEqual(
      expect.arrayContaining([
        "sec-edgar/sec-company-filings",
        "sec-edgar/sec-company-facts",
        "apple-suppliers/supplier-list-review",
        "company-ir/official-html-disclosure",
        "dart-kr/company-filings",
        "edinet/daily-filings",
        "micron-ir/official-html-disclosure",
        "twse-mops/electronic-documents",
        "census-trade/trade-flow-observation",
        "osh/facility-search",
        "worldbank-pink/commodity-price-observation"
      ])
    );
    expect(listRegisteredSourceCheckConnectorCapabilities()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_adapter_id: "sec-edgar",
          target_kind: "sec-company-filings",
          key: "sec-edgar/sec-company-filings"
        }),
        expect.objectContaining({
          source_adapter_id: "sec-edgar",
          target_kind: "sec-company-facts",
          key: "sec-edgar/sec-company-facts"
        }),
        expect.objectContaining({
          source_adapter_id: "apple-suppliers",
          target_kind: "supplier-list-review",
          key: "apple-suppliers/supplier-list-review"
        }),
        expect.objectContaining({
          source_adapter_id: "company-ir",
          target_kind: "official-html-disclosure",
          key: "company-ir/official-html-disclosure"
        }),
        expect.objectContaining({
          source_adapter_id: "dart-kr",
          target_kind: "company-filings",
          key: "dart-kr/company-filings"
        }),
        expect.objectContaining({
          source_adapter_id: "edinet",
          target_kind: "daily-filings",
          key: "edinet/daily-filings"
        }),
        expect.objectContaining({
          source_adapter_id: "micron-ir",
          target_kind: "official-html-disclosure",
          key: "micron-ir/official-html-disclosure"
        }),
        expect.objectContaining({
          source_adapter_id: "twse-mops",
          target_kind: "electronic-documents",
          key: "twse-mops/electronic-documents"
        })
      ])
    );
  });

  it("fails manual source checks through the connector registry instead of CLI branches", async () => {
    await expect(
      runManualSourceCheck(
        new NoopDatabaseStore(),
        {
          source_adapter_id: "unknown-source",
          target_config: {}
        },
        { env: envSchema.parse({}), checkedAt: "2026-05-19T00:00:00.000Z" }
      )
    ).rejects.toThrow("Unsupported due source target: unknown-source/(unspecified)");
  });

  it("enqueues and claims due source checks in one transaction before running jobs", async () => {
    const store = new NoopDatabaseStore();

    const result = await runDueSourceChecks(store, { env: envSchema.parse({}), limit: 5, now: "2026-05-19T00:00:00.000Z" });

    expect(result).toMatchObject({
      due_targets: 0,
      enqueued_jobs: 0,
      skipped_active_jobs: 0,
      claimed_jobs: 0,
      checked_targets: 0,
      failed_targets: 0,
      dead_jobs: 0,
      items: []
    });
    expect(store.transactionCount).toBe(1);
  });
});

class NoopDatabaseStore implements DatabaseStore {
  readonly adapter_id = "noop";
  transactionCount = 0;
  readonly read = {
    query: <T extends pg.QueryResultRow>() => this.query<T>()
  };

  async query<T extends pg.QueryResultRow>(): Promise<pg.QueryResult<T>> {
    return { command: "NOOP", rowCount: 0, oid: 0, fields: [], rows: [] };
  }

  async transaction<T>(fn: (client: DbTxClient) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
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
