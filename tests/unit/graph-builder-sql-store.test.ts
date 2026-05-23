import type pg from "pg";
import { describe, expect, it } from "vitest";
import type { ApprovedCandidate } from "@supplystrata/core";
import { dbTxClientBrand, type DbTxClient } from "@supplystrata/db/write";
import { applyApprovedCandidateToSql } from "../../packages/graph-builder/src/sql-store.js";

interface QueryCall {
  sql: string;
  params: readonly unknown[];
}

class GraphBuilderSqlDbClient implements DbTxClient {
  readonly [dbTxClientBrand] = true;
  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    if (sql.includes("FROM components")) return queryResult([]);
    if (sql.includes("FROM documents")) return queryResult([{ bytes_sha256: "fixture-sha", metadata: { parser_version: "unit-test" } }] as unknown as T[]);
    if (sql.includes("FROM document_chunks")) {
      return queryResult([{ text: "Unit Buyer purchases components from Unit Supplier." }] as unknown as T[]);
    }
    if (sql.includes("INSERT INTO edges") && sql.includes("ON CONFLICT")) {
      return queryResult([
        {
          edge_id: "EDGE-EXISTING",
          evidence_level: 4,
          confidence: 0.91,
          validity: "current",
          inserted: false
        }
      ] as unknown as T[]);
    }
    return queryResult([]);
  }
}

describe("graph-builder SQL store", () => {
  it("upserts reviewed fact edges atomically instead of selecting then inserting", async () => {
    const client = new GraphBuilderSqlDbClient();

    const result = await applyApprovedCandidateToSql(client, {
      approved: approvedCandidate(),
      subject_id: "ENT-BUYER",
      object_id: "ENT-SUPPLIER"
    });

    expect(result).toMatchObject({ edge_id: "EDGE-EXISTING", is_new_edge: false });
    const edgeWrite = client.calls.find((call) => call.sql.includes("INSERT INTO edges"));
    expect(edgeWrite?.sql).toContain("ON CONFLICT");
    expect(edgeWrite?.sql).toContain("WHERE edges.validity = 'current'");
    expect(client.calls.some((call) => call.sql.includes("pg_advisory_xact_lock"))).toBe(false);
    expect(client.calls.some((call) => call.sql.includes("SELECT edge_id, evidence_level, confidence, validity") && call.sql.includes("FROM edges"))).toBe(
      false
    );
  });
});

function approvedCandidate(): ApprovedCandidate {
  return {
    candidate: {
      subject_resolve: { surface: "Unit Buyer" },
      object_resolve: { surface: "Unit Supplier" },
      relation: "BUYS_FROM",
      component: "components",
      cite_text: "Unit Buyer purchases components from Unit Supplier.",
      cite_locator: "unit fixture",
      extractor_id: "review.unit",
      raw_evidence_level_hint: 4,
      raw_confidence_hint: 0.91
    },
    scoring: {
      evidence_level: 4,
      confidence: 0.91,
      is_inferred: false,
      needs_review: false,
      rationale: "unit fixture",
      confidence_breakdown: { base: 0.91, factors: [], cap: 0.97, final: 0.91 }
    },
    approved_by: { reviewer: "unit-test", reviewed_at: "2026-05-23T00:00:00.000Z" },
    doc_id: "DOC-UNIT",
    chunk_id: "CHK-UNIT"
  };
}

function queryResult<T extends pg.QueryResultRow>(rows: T[]): pg.QueryResult<T> {
  return {
    command: "MOCK",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows
  };
}
