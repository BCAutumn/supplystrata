import type pg from "pg";
import { describe, expect, it } from "vitest";
import { listCurrentEdges, loadDocument, type DbClient } from "@supplystrata/db/read";
import { dbTxClientBrand, insertChainSegments, replaceRiskView, type DbTxClient } from "@supplystrata/db/write";

describe("db read contracts", () => {
  it("loads documents through explicit column projections", async () => {
    const client = new ContractReadClient();

    const document = await loadDocument(client, "DOC-1");

    expect(document).toMatchObject({
      doc_id: "DOC-1",
      source_adapter_id: "sec-edgar",
      document_type: "10-K",
      primary_entity_id: "ENT-NVIDIA",
      source_url: "https://example.com/doc",
      source_date: "2026-02-25",
      text: "First chunk\n\nSecond chunk"
    });
    expect(document.chunks).toEqual([
      {
        chunk_id: "DOC-1-CHK-0001",
        text: "First chunk",
        locator: "part-1",
        language: "en",
        token_count: 2
      },
      {
        chunk_id: "DOC-1-CHK-0002",
        text: "Second chunk",
        locator: "unknown",
        language: "en"
      }
    ]);
    expect(client.statements.every((statement) => !/\bSELECT\s+(?:\*|[a-z]+\.\*)\b/i.test(statement))).toBe(true);
  });

  it("lists current edges without selecting the whole edge row", async () => {
    const client = new ContractReadClient();

    const edges = await listCurrentEdges(client);

    expect(edges[0]).toMatchObject({
      edge_id: "EDGE-1",
      subject_id: "ENT-NVIDIA",
      object_id: "ENT-TSMC",
      relation: "USES_FOUNDRY",
      subject_name: "NVIDIA",
      object_name: "TSMC"
    });
    expect(client.statements.every((statement) => !/\bSELECT\s+(?:\*|[a-z]+\.\*)\b/i.test(statement))).toBe(true);
  });

  it("writes bulk risk metrics through explicit jsonb record projections", async () => {
    const client = new ContractWriteClient();

    await replaceRiskView(client, {
      risk_view_id: "RSK-1",
      scope_kind: "component",
      scope_id: "COMP-HBM",
      generated_at: "2026-05-23T00:00:00.000Z",
      model_version: "unit-test",
      inputs_fingerprint: "fingerprint",
      summary: {},
      metrics: [
        {
          metric_id: "RKM-1",
          metric_kind: "single_source_exposure",
          subject_kind: "component",
          subject_id: "COMP-HBM",
          confidence: 1,
          provenance: {},
          attrs: {}
        }
      ]
    });

    const bulkInsert = client.statements.find((statement) => statement.includes("jsonb_to_recordset($2::jsonb)"));
    expect(bulkInsert).toBeDefined();
    expect(bulkInsert).toContain("value numeric");
    expect(bulkInsert).not.toMatch(/\bSELECT\s+\*/i);
  });

  it("writes bulk chain segments through explicit jsonb record projections", async () => {
    const client = new ContractWriteClient();

    await insertChainSegments(client, [
      {
        segment_id: "SEG-1",
        chain_id: "CHAIN-1",
        sequence_index: 0,
        from_kind: "entity",
        from_id: "ENT-NVIDIA",
        to_kind: "entity",
        to_id: "ENT-TSMC",
        semantic_layer: "edge",
        edge_id: "EDGE-1"
      }
    ]);

    const bulkInsert = client.statements.find((statement) => statement.includes("jsonb_to_recordset($1::jsonb)"));
    expect(bulkInsert).toBeDefined();
    expect(bulkInsert).not.toMatch(/\bSELECT\s+\*/i);
  });
});

class ContractReadClient implements DbClient {
  readonly statements: string[] = [];

  async query<T extends pg.QueryResultRow>(sql: string): Promise<pg.QueryResult<T>> {
    this.statements.push(sql);
    if (sql.includes("FROM documents")) return queryResult<T>([documentRow()]);
    if (sql.includes("FROM document_chunks"))
      return queryResult<T>([chunkRow("DOC-1-CHK-0001", "First chunk", "part-1", 2), chunkRow("DOC-1-CHK-0002", "Second chunk", null, null)]);
    if (sql.includes("FROM edges e")) return queryResult<T>([edgeRow()]);
    return queryResult<T>([]);
  }
}

class ContractWriteClient implements DbTxClient {
  readonly [dbTxClientBrand] = true;
  readonly statements: string[] = [];

  async query<T extends pg.QueryResultRow>(sql: string): Promise<pg.QueryResult<T>> {
    this.statements.push(sql);
    if (sql.includes("RETURNING risk_view_id")) return queryResult<T>([{ risk_view_id: "RSK-1" }]);
    return queryResult<T>([]);
  }
}

function documentRow(): pg.QueryResultRow {
  return {
    doc_id: "DOC-1",
    source_adapter_id: "sec-edgar",
    document_type: "10-K",
    primary_entity_id: "ENT-NVIDIA",
    source_url: "https://example.com/doc",
    source_date: new Date("2026-02-25T00:00:00.000Z"),
    fetched_at: new Date("2026-05-23T00:00:00.000Z"),
    bytes_sha256: "sha",
    storage_key: "documents/doc-1.html",
    language: "en",
    metadata: { fixture: true }
  };
}

function chunkRow(chunkId: string, text: string, locator: string | null, tokenCount: number | null): pg.QueryResultRow {
  return {
    chunk_id: chunkId,
    text,
    locator,
    language: null,
    token_count: tokenCount
  };
}

function edgeRow(): pg.QueryResultRow {
  return {
    edge_id: "EDGE-1",
    subject_id: "ENT-NVIDIA",
    object_id: "ENT-TSMC",
    relation: "USES_FOUNDRY",
    component: "wafer",
    component_id: "COMP-WAFER",
    component_specificity: "explicit",
    evidence_level: 5,
    confidence: 0.95,
    is_inferred: false,
    validity: "current",
    primary_evidence_id: "EV-1",
    last_verified_at: new Date("2026-02-25T00:00:00.000Z"),
    subject_name: "NVIDIA",
    object_name: "TSMC"
  };
}

function queryResult<T extends pg.QueryResultRow>(rows: pg.QueryResultRow[]): pg.QueryResult<T> {
  return {
    command: "SELECT",
    oid: 0,
    fields: [],
    rowCount: rows.length,
    rows: rows as T[]
  };
}
