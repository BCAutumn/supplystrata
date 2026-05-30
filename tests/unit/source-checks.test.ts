import { afterEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { envSchema } from "@supplystrata/config";
import {
  listRegisteredSourceCheckConnectorCapabilities,
  listSourceCheckConnectorIds,
  runDueSourceChecks,
  runManualSourceCheck
} from "@supplystrata/source-workflows";
import { dbTxClientBrand, type DatabaseStore, type DbTxClient } from "@supplystrata/db/write";

afterEach(() => {
  vi.unstubAllGlobals();
});

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
        "hkex-news/title-search",
        "census-trade/trade-flow-observation",
        "osh/facility-search",
        "worldbank-pink/commodity-price-observation",
        "ofac-sanctions/policy-constraint-observation"
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
        }),
        expect.objectContaining({
          source_adapter_id: "hkex-news",
          target_kind: "title-search",
          key: "hkex-news/title-search"
        }),
        expect.objectContaining({
          source_adapter_id: "ofac-sanctions",
          target_kind: "policy-constraint-observation",
          key: "ofac-sanctions/policy-constraint-observation"
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

  it("runs due source checks through the injected document observation pipeline", async () => {
    const store = new DueSourceCheckDatabaseStore();
    const objectStoreBase = await mkdtemp(join(tmpdir(), "supplystrata-source-check-"));
    vi.stubGlobal("fetch", async (url: string | URL | Request) => {
      const href = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (href.includes("data.sec.gov/submissions")) {
        return new Response(
          JSON.stringify({
            filings: {
              recent: {
                accessionNumber: ["0001318605-26-000001"],
                primaryDocument: ["tsla-20251231.htm"],
                form: ["10-K"],
                filingDate: ["2026-02-01"]
              }
            }
          }),
          { status: 200 }
        );
      }
      return new Response("<html><body>We purchase lithium-ion battery cells from Panasonic for use in our electric vehicles.</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" }
      });
    });

    const result = await runDueSourceChecks(store, {
      env: envSchema.parse({ OBJECT_STORE_FS_BASE: objectStoreBase }),
      limit: 1,
      now: "2026-05-19T00:00:00.000Z",
      documentObservationStore: {
        async persistDocumentObservations(_client, normalized, docId) {
          store.observedDocIds.push(docId);
          store.observedPrimaryEntityIds.push(normalized.primary_entity_id ?? null);
          return {
            change_type: "DOCUMENT_NEW",
            source_item_id: "SRCITEM-PIPELINE",
            event_id: "SEV-PIPELINE",
            stored_observations: 2,
            review_candidates: 3,
            semantic_changes: 4,
            relation_changes: 5
          };
        }
      }
    });

    expect(store.observedPrimaryEntityIds).toEqual(["ENT-TESLA"]);
    expect(store.observedDocIds).toEqual(["DOC-SAVED"]);
    expect(result.items[0]?.summaries[0]).toMatchObject({
      doc_id: "DOC-SAVED",
      observations: 2,
      review_candidates: 3,
      semantic_changes: 4,
      relation_changes: 5
    });
  });

  it("promotes facts for new/changed documents through the injected fact promoter", async () => {
    const store = new DueSourceCheckDatabaseStore();
    const objectStoreBase = await mkdtemp(join(tmpdir(), "supplystrata-source-check-promote-"));
    stubSecFetch();
    const promotedDocIds: string[] = [];

    const result = await runDueSourceChecks(store, {
      env: envSchema.parse({ OBJECT_STORE_FS_BASE: objectStoreBase }),
      limit: 1,
      now: "2026-05-19T00:00:00.000Z",
      documentObservationStore: { persistDocumentObservations: documentObservationStub("DOCUMENT_NEW") },
      factPromoter: {
        async promoteDocumentFacts(input) {
          promotedDocIds.push(input.docId);
          return { candidates: 7, applied_edges: 2, evidence_ids: ["EV-1", "EV-2"] };
        }
      }
    });

    expect(promotedDocIds).toEqual(["DOC-SAVED"]);
    expect(result.items[0]?.summaries[0]).toMatchObject({ doc_id: "DOC-SAVED", fact_candidates: 7, applied_edges: 2 });
  });

  it("skips fact promotion for unchanged documents to avoid evidence churn", async () => {
    const store = new DueSourceCheckDatabaseStore();
    const objectStoreBase = await mkdtemp(join(tmpdir(), "supplystrata-source-check-unchanged-"));
    stubSecFetch();
    const promotedDocIds: string[] = [];

    const result = await runDueSourceChecks(store, {
      env: envSchema.parse({ OBJECT_STORE_FS_BASE: objectStoreBase }),
      limit: 1,
      now: "2026-05-19T00:00:00.000Z",
      documentObservationStore: { persistDocumentObservations: documentObservationStub("DOCUMENT_UNCHANGED") },
      factPromoter: {
        async promoteDocumentFacts(input) {
          promotedDocIds.push(input.docId);
          return { candidates: 0, applied_edges: 0, evidence_ids: [] };
        }
      }
    });

    expect(promotedDocIds).toEqual([]);
    expect(result.items[0]?.summaries[0]?.applied_edges).toBeUndefined();
  });
});

function stubSecFetch(): void {
  vi.stubGlobal("fetch", async (url: string | URL | Request) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    if (href.includes("data.sec.gov/submissions")) {
      return new Response(
        JSON.stringify({
          filings: {
            recent: {
              accessionNumber: ["0001318605-26-000001"],
              primaryDocument: ["tsla-20251231.htm"],
              form: ["10-K"],
              filingDate: ["2026-02-01"]
            }
          }
        }),
        { status: 200 }
      );
    }
    return new Response("<html><body>We purchase lithium-ion battery cells from Panasonic for use in our electric vehicles.</body></html>", {
      status: 200,
      headers: { "Content-Type": "text/html" }
    });
  });
}

function documentObservationStub(changeType: "DOCUMENT_NEW" | "DOCUMENT_UNCHANGED" | "DOCUMENT_CHANGED") {
  return async () => ({
    change_type: changeType,
    source_item_id: "SRCITEM-PIPELINE",
    event_id: "SEV-PIPELINE",
    stored_observations: 2,
    review_candidates: 3,
    semantic_changes: 4,
    relation_changes: 5
  });
}

class NoopDatabaseStore implements DatabaseStore {
  readonly adapter_id = "noop";
  transactionCount = 0;
  readonly read = {
    query: <T extends pg.QueryResultRow>() => this.query<T>()
  };

  async query<T extends pg.QueryResultRow>(_sql = "", _params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
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

  async query<T extends pg.QueryResultRow>(_sql = "", _params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    return { command: "NOOP", rowCount: 0, oid: 0, fields: [], rows: [] };
  }
}

class DueSourceCheckDatabaseStore implements DatabaseStore {
  readonly adapter_id = "due-source-check-fixture";
  readonly observedDocIds: string[] = [];
  readonly observedPrimaryEntityIds: Array<string | null> = [];
  readonly read = {
    query: <T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []) => this.query<T>(sql, params)
  };

  async query<T extends pg.QueryResultRow>(_sql = "", _params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    return { command: "NOOP", rowCount: 0, oid: 0, fields: [], rows: [] };
  }

  async transaction<T>(fn: (client: DbTxClient) => Promise<T>): Promise<T> {
    return fn(new DueSourceCheckTxClient());
  }

  async close(): Promise<void> {}
}

class DueSourceCheckTxClient implements DbTxClient {
  readonly [dbTxClientBrand] = true;

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    const rows = dueSourceCheckRows<T>(sql, params);
    return {
      command: "MOCK",
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows
    };
  }
}

function dueSourceCheckRows<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[]): T[] {
  if (sql.includes("FROM source_check_targets") && sql.includes("FOR UPDATE SKIP LOCKED") && !sql.includes("WITH due AS")) {
    return [dueSourceTargetRow()] as unknown as T[];
  }
  if (sql.includes("INSERT INTO source_check_jobs")) {
    return [{}] as T[];
  }
  if (sql.includes("FROM source_check_jobs") && sql.includes("RETURNING jobs.job_id")) {
    return [{ ...dueSourceTargetRow(), job_id: "SCJ-TESLA", job_status: "in_progress", attempts: 0, max_attempts: 3 }] as unknown as T[];
  }
  if (sql.includes("INSERT INTO documents")) {
    return [{ doc_id: "DOC-SAVED" }] as unknown as T[];
  }
  if (sql.includes("INSERT INTO document_chunks")) {
    return [{}] as T[];
  }
  if (sql.includes("UPDATE source_check_jobs") && params[0] === "SCJ-TESLA") {
    return [{}] as T[];
  }
  return [];
}

function dueSourceTargetRow(): Record<string, unknown> {
  return {
    check_target_id: "research:test:sec-edgar:sec-company-filings:ent-tesla",
    source_adapter_id: "sec-edgar",
    target_kind: "sec-company-filings",
    subject_entity_id: "ENT-TESLA",
    target_config: {
      cik: "0001318605",
      entity_id: "ENT-TESLA",
      form_types: ["10-K"],
      limit: 1
    },
    target_enabled: true,
    target_priority: 10,
    target_config_source: "test",
    target_notes: null,
    policy_enabled: true,
    check_cadence_minutes: 1440,
    jitter_minutes: 0,
    effective_check_cadence_minutes: 1440,
    effective_jitter_minutes: 0,
    effective_max_attempts: 3,
    effective_backoff_base_minutes: 1,
    effective_backoff_max_minutes: 30,
    policy_priority: 10,
    policy_config_source: "test",
    next_check_at: new Date("2026-05-19T00:00:00.000Z"),
    policy_notes: null
  };
}
