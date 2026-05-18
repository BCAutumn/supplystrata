import type pg from "pg";
import { describe, expect, it } from "vitest";
import type { NormalizedDocument } from "@supplystrata/core";
import type { DbClient } from "@supplystrata/db";
import { persistDocumentObservations } from "@supplystrata/pipeline";

interface QueryCall {
  sql: string;
  params: readonly unknown[];
}

class RecordingDbClient implements DbClient {
  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    return {
      command: "MOCK",
      rowCount: 0,
      oid: 0,
      fields: [],
      rows: []
    };
  }
}

describe("pipeline document observations", () => {
  it("records source-monitor state and official observations without creating fact edges", async () => {
    const client = new RecordingDbClient();

    const result = await persistDocumentObservations(client, normalizedDisclosureFixture(), "DOC-DB-1");

    expect(result).toMatchObject({ stored_observations: 1, semantic_changes: 0, relation_changes: 0, change_type: "DOCUMENT_NEW" });
    expect(result.source_item_id).toMatch(/^SRCITEM-/);
    expect(result.event_id).toMatch(/^SEV-/);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO source_change_events"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO observations"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
  });

  it("records deterministic semantic section changes when a watched source document changes", async () => {
    const client = new ChangedDocumentDbClient();

    const result = await persistDocumentObservations(
      client,
      normalizedDisclosureFixture(
        "Customer A accounted for 18% of total revenue during fiscal 2026, and this concentration remained material to demand planning.",
        "fixture-sha-new"
      ),
      "DOC-DB-2"
    );

    expect(result).toMatchObject({
      stored_observations: 1,
      semantic_changes: 1,
      relation_changes: 0,
      change_type: "DOCUMENT_CHANGED",
      previous_doc_id: "DOC-OLD"
    });
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO change_records") && call.params.includes("CUSTOMER_CONCENTRATION_CHANGED"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
  });

  it("records relation-level semantic additions and removals without applying graph edges", async () => {
    const client = new ChangedDocumentDbClient({
      oldText: "We purchase memory from SK hynix and Micron for use in our products.",
      oldSourceUrl: "https://www.sec.gov/Archives/fixture/nvidia-old-10k.htm"
    });

    const result = await persistDocumentObservations(
      client,
      normalizedDisclosureFixture("We purchase memory from SK hynix and Samsung for use in our products.", "fixture-sha-relation-new"),
      "DOC-DB-3"
    );

    expect(result).toMatchObject({ stored_observations: 0, semantic_changes: 0, relation_changes: 2, change_type: "DOCUMENT_CHANGED" });
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO change_records") && call.params.includes("SUPPLIER_RELATION_ADDED"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO change_records") && call.params.includes("SUPPLIER_RELATION_REMOVED"))).toBe(true);
    expect(client.calls.filter((call) => call.sql.includes("INSERT INTO review_candidates"))).toHaveLength(2);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
  });

  it("records purchase-obligation semantic changes separately from generic supplier relations", async () => {
    const client = new ChangedDocumentDbClient({
      oldText: "We have purchase obligations with TSMC for wafer capacity that support our long-term product roadmap.",
      oldSourceUrl: "https://www.sec.gov/Archives/fixture/nvidia-old-10q.htm"
    });

    const result = await persistDocumentObservations(
      client,
      normalizedDisclosureFixture(
        "We have purchase obligations with TSMC for wafer capacity that increased to support our long-term product roadmap.",
        "fixture-sha-purchase-obligation-new"
      ),
      "DOC-DB-4"
    );

    expect(result).toMatchObject({ stored_observations: 1, semantic_changes: 1, relation_changes: 1, change_type: "DOCUMENT_CHANGED" });
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO change_records") && call.params.includes("PURCHASE_OBLIGATION_CHANGED"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO review_candidates") && call.params.includes("semantic_change"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO change_records") && call.params.includes("SUPPLIER_RELATION_CHANGED"))).toBe(false);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
  });
});

function normalizedDisclosureFixture(
  text = "NVIDIA reported that inventories and related supply planning remained important in the annual filing. " +
    "This fixture sentence is long enough to be considered by the observation extractor.",
  bytesSha256 = "fixture-sha"
): NormalizedDocument {
  return {
    doc_id: "DOC-FIXTURE",
    source_adapter_id: "sec-edgar",
    document_type: "10-K",
    primary_entity_id: "ENT-NVIDIA",
    language: "en",
    fetched_at: "2026-03-01T00:00:00.000Z",
    source_date: "2026-02-26",
    source_url: "https://www.sec.gov/Archives/fixture/nvidia-10k.htm",
    storage_key: "sec-edgar/nvidia/fixture.html",
    bytes_sha256: bytesSha256,
    text,
    chunks: [
      {
        chunk_id: "CHUNK-FIXTURE-1",
        locator: "fixture:1",
        text,
        token_count: 12,
        language: "en"
      }
    ],
    metadata: { fixture: true }
  };
}

class ChangedDocumentDbClient extends RecordingDbClient {
  readonly #oldText: string;
  readonly #oldSourceUrl: string;

  constructor(input: { oldText?: string; oldSourceUrl?: string } = {}) {
    super();
    this.#oldText =
      input.oldText ?? "Customer A accounted for 12% of total revenue during fiscal 2025, and this concentration remained material to demand planning.";
    this.#oldSourceUrl = input.oldSourceUrl ?? "https://www.sec.gov/Archives/fixture/nvidia-old-10k.htm";
  }

  override async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    return {
      command: "MOCK",
      rowCount: 0,
      oid: 0,
      fields: [],
      rows: rowsForChangedDocument<T>(sql, { oldText: this.#oldText, oldSourceUrl: this.#oldSourceUrl })
    };
  }
}

function rowsForChangedDocument<T extends pg.QueryResultRow>(sql: string, input: { oldText: string; oldSourceUrl: string }): T[] {
  if (sql.includes("FROM source_items")) {
    return [
      {
        source_item_id: "SRCITEM-OLD",
        latest_doc_id: "DOC-OLD",
        latest_bytes_sha256: "fixture-sha-old",
        latest_storage_key: "sec-edgar/nvidia/old.html"
      }
    ] as unknown as T[];
  }
  if (sql.includes("FROM documents WHERE doc_id")) {
    return [
      {
        doc_id: "DOC-OLD",
        source_adapter_id: "sec-edgar",
        document_type: "10-K",
        primary_entity_id: "ENT-NVIDIA",
        source_url: input.oldSourceUrl,
        source_date: new Date("2025-02-26T00:00:00.000Z"),
        fetched_at: new Date("2025-03-01T00:00:00.000Z"),
        bytes_sha256: "fixture-sha-old",
        storage_key: "sec-edgar/nvidia/old.html",
        language: "en",
        metadata: {}
      }
    ] as unknown as T[];
  }
  if (sql.includes("FROM document_chunks")) {
    return [
      {
        chunk_id: "DOC-OLD-CHK-0001",
        text: input.oldText,
        locator: "fixture:old",
        language: "en",
        token_count: 18
      }
    ] as unknown as T[];
  }
  return [];
}
