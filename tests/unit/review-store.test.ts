import type pg from "pg";
import { describe, expect, it } from "vitest";
import type { DbClient } from "@supplystrata/db";
import { decideReviewCandidate, markReviewCandidateApplied, markReviewCandidateBlocked } from "@supplystrata/review-store";

interface QueryCall {
  sql: string;
  params: readonly unknown[];
}

class ReviewChangeDbClient implements DbClient {
  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    return {
      command: "MOCK",
      rowCount: sql.includes("UPDATE review_candidates") ? 1 : 0,
      oid: 0,
      fields: [],
      rows: sql.includes("RETURNING review_id") ? ([reviewRow(String(params[0] ?? "REV-TEST"), statusFromSql(sql, params))] as T[]) : []
    };
  }
}

describe("review-store semantic changes", () => {
  it("records approve and reject decisions as review-scoped semantic changes", async () => {
    const client = new ReviewChangeDbClient();

    await decideReviewCandidate(client, { reviewId: "REV-APPROVE", decision: "approved", reviewer: "unit-test", reason: "source row checked" });
    await decideReviewCandidate(client, { reviewId: "REV-REJECT", decision: "rejected", reviewer: "unit-test", reason: "duplicate row" });

    expect(client.calls.filter((call) => call.sql.includes("UPDATE review_candidates"))).toHaveLength(2);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO change_records") && call.params.includes("REVIEW_APPROVED"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO change_records") && call.params.includes("REVIEW_REJECTED"))).toBe(true);
  });

  it("records apply and block outcomes without touching fact edges", async () => {
    const client = new ReviewChangeDbClient();

    await markReviewCandidateApplied(client, { reviewId: "REV-APPLY", reason: "applied edges EDGE-1" });
    await markReviewCandidateBlocked(client, { reviewId: "REV-BLOCK", reason: "cannot resolve supplier" });

    expect(client.calls.some((call) => call.sql.includes("INSERT INTO change_records") && call.params.includes("REVIEW_APPLIED"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO change_records") && call.params.includes("REVIEW_BLOCKED"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
  });
});

function statusFromSql(sql: string, params: readonly unknown[]): string {
  if (sql.includes("status = 'applied'")) return "applied";
  if (sql.includes("status = 'blocked'")) return "blocked";
  return String(params[1] ?? "approved");
}

function reviewRow(reviewId: string, status: string): pg.QueryResultRow {
  return {
    review_id: reviewId,
    candidate_key: `${reviewId}-key`,
    kind: "supplier_list_row",
    status,
    candidate: {
      review_id: reviewId,
      candidate_key: `${reviewId}-key`,
      kind: "supplier_list_row",
      title: "Buyer -> Supplier",
      payload: {
        buyer_entity_id: "ENT-BUYER",
        buyer_name: "Buyer",
        supplier_name: "Supplier",
        location_text: "Penang",
        country_or_region: "Malaysia",
        relation_hint: "BUYS_FROM",
        facility_relation_hint: "MANUFACTURES_AT"
      },
      evidence: {
        doc_id: "DOC-TEST",
        source_url: "fixture://supplier-list.pdf",
        source_adapter_id: "supplier-list-fixture",
        source_locator: "line 1",
        source_row_text: "Supplier Penang Malaysia",
        normalized_record_text: "Buyer | Supplier | Penang | Malaysia"
      },
      confidence: 0.82,
      needs_review: true,
      review_reason: "fixture review"
    },
    reviewer: "unit-test",
    reviewed_at: new Date("2026-05-17T00:00:00.000Z"),
    decision_reason: "fixture decision",
    created_at: new Date("2026-05-17T00:00:00.000Z")
  };
}
