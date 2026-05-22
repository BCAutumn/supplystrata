import type pg from "pg";
import { describe, expect, it } from "vitest";
import type { DbClient } from "@supplystrata/db";
import {
  claimApprovedReviewCandidates,
  decideReviewCandidate,
  listOfficialDisclosureSignalDispositions,
  markReviewCandidateApplied,
  markReviewCandidateBlocked,
  nextReviewCandidate,
  recordOfficialDisclosureSignalDisposition
} from "@supplystrata/review-store";

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

class OfficialSignalDispositionDbClient implements DbClient {
  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    return {
      command: "MOCK",
      rowCount: sql.includes("INSERT INTO change_records") ? 1 : 0,
      oid: 0,
      fields: [],
      rows: officialSignalRows<T>(sql, params)
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

  it("claims the next review candidate with row locking", async () => {
    const client = new ReviewChangeDbClient();

    const item = await nextReviewCandidate(client);

    expect(item?.status).toBe("in_review");
    expect(client.calls[0]?.sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(client.calls[0]?.sql).toContain("SET status = 'in_review'");
  });

  it("claims approved review candidates before batch apply", async () => {
    const client = new ReviewChangeDbClient();

    const items = await claimApprovedReviewCandidates(client, { limit: 3 });

    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe("in_review");
    expect(items[0]?.reviewed_at).toBeDefined();
    expect(client.calls[0]?.sql).toContain("WHERE status = 'approved'");
    expect(client.calls[0]?.sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(client.calls[0]?.sql).toContain("SET status = 'in_review'");
  });

  it("records official disclosure signal dispositions without authorizing fact mutation", async () => {
    const client = new OfficialSignalDispositionDbClient();

    const record = await recordOfficialDisclosureSignalDisposition(client, {
      reviewId: "REV-OFFICIAL-SIGNAL-1",
      edgeId: "EDGE-NVIDIA-TSMC",
      decision: "supports_existing_edge",
      reviewer: "unit-test",
      reason: "Reviewed counterparty disclosure supports using this signal as evidence context.",
      evidenceId: "EV-TSMC-IR"
    });

    expect(record).toEqual(
      expect.objectContaining({
        review_id: "REV-OFFICIAL-SIGNAL-1",
        edge_id: "EDGE-NVIDIA-TSMC",
        decision: "supports_existing_edge",
        evidence_id: "EV-TSMC-IR",
        fact_write_policy: {
          automatic_fact_mutation_allowed: false,
          allowed_edge_mutation: "none",
          requires_human_review: true
        }
      })
    );
    expect(
      client.calls.some((call) => call.sql.includes("INSERT INTO change_records") && call.params.includes("OFFICIAL_DISCLOSURE_SIGNAL_DISPOSITION_RECORDED"))
    ).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges") || call.sql.includes("UPDATE edges"))).toBe(false);
  });

  it("lists official disclosure signal dispositions from review-scoped change records", async () => {
    const client = new OfficialSignalDispositionDbClient();

    const records = await listOfficialDisclosureSignalDispositions(client, {
      reviewIds: ["REV-OFFICIAL-SIGNAL-1"],
      edgeIds: ["EDGE-NVIDIA-TSMC"],
      limit: 10
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(
      expect.objectContaining({
        review_id: "REV-OFFICIAL-SIGNAL-1",
        edge_id: "EDGE-NVIDIA-TSMC",
        decision: "supports_existing_edge"
      })
    );
    expect(client.calls[0]?.sql).toContain("scope_id = ANY");
    expect(client.calls[0]?.sql).toContain("after->>'edge_id' = ANY");
  });
});

function statusFromSql(sql: string, params: readonly unknown[]): string {
  if (sql.includes("status = 'in_review'")) return "in_review";
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

function officialSignalRows<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[]): T[] {
  if (sql.includes("FROM review_candidates")) return [officialSignalReviewRow(String(params[0] ?? "REV-OFFICIAL-SIGNAL-1"))] as T[];
  if (sql.includes("FROM change_records")) return [officialSignalDispositionRow()] as T[];
  return [];
}

function officialSignalReviewRow(reviewId: string): pg.QueryResultRow {
  return {
    review_id: reviewId,
    candidate_key: `${reviewId}-key`,
    kind: "official_disclosure_signal",
    status: "approved",
    candidate: {
      review_id: reviewId,
      candidate_key: `${reviewId}-key`,
      kind: "official_disclosure_signal",
      title: "Official disclosure signal: TSMC links demand to AI and HPC",
      payload: {
        source_item_id: "SRC-ITEM-TSMC",
        doc_id: "DOC-TSMC-IR",
        source_adapter_id: "tsmc-ir",
        signal_title: "TSMC links demand to AI and HPC",
        cite_text: "TSMC observed AI and HPC demand across customer products.",
        cite_locator: "page 4",
        evidence_level_hint: 4,
        fact_write_policy: {
          automatic_fact_mutation_allowed: false,
          allowed_edge_mutation: "none",
          requires_human_review: true,
          reason_codes: ["review_only_official_signal"]
        }
      },
      evidence: {
        doc_id: "DOC-TSMC-IR",
        source_url: "https://investor.tsmc.com/fixture",
        source_adapter_id: "tsmc-ir",
        source_locator: "page 4",
        source_row_text: "TSMC observed AI and HPC demand across customer products.",
        normalized_record_text: "TSMC links demand to AI and HPC | evidence_level=4 | TSMC observed AI and HPC demand across customer products."
      },
      confidence: 0.84,
      needs_review: true,
      review_reason: "fixture official signal"
    },
    reviewer: "unit-test",
    reviewed_at: new Date("2026-05-21T00:00:00.000Z"),
    decision_reason: "fixture decision",
    created_at: new Date("2026-05-21T00:00:00.000Z")
  };
}

function officialSignalDispositionRow(): pg.QueryResultRow {
  return {
    change_id: "CHG-OFFICIAL-SIGNAL-DISPOSITION-1",
    review_id: "REV-OFFICIAL-SIGNAL-1",
    after: {
      review_id: "REV-OFFICIAL-SIGNAL-1",
      edge_id: "EDGE-NVIDIA-TSMC",
      decision: "supports_existing_edge",
      reviewer: "unit-test",
      reason: "Reviewed counterparty disclosure supports using this signal as evidence context.",
      source_adapter_id: "tsmc-ir",
      doc_id: "DOC-TSMC-IR",
      signal_title: "TSMC links demand to AI and HPC",
      evidence_id: "EV-TSMC-IR",
      unknown_id: null,
      check_target_id: null,
      recorded_at: "2026-05-22T00:00:00.000Z",
      fact_write_policy: {
        automatic_fact_mutation_allowed: false,
        allowed_edge_mutation: "none",
        requires_human_review: true
      }
    },
    caused_by: "unit-test",
    detected_at: new Date("2026-05-22T00:00:00.000Z")
  };
}
