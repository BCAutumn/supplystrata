import type pg from "pg";
import { describe, expect, it } from "vitest";
import { dbTxClientBrand, type DatabaseStore, type DbTxClient } from "@supplystrata/db/write";
import { applyApprovedReviewCandidate } from "@supplystrata/pipeline";
import { buildClaimConflictReviewCandidate } from "@supplystrata/review-candidates";

interface QueryCall {
  sql: string;
  params: readonly unknown[];
}

class ReviewApplyDbStore implements DatabaseStore {
  readonly adapter_id = "unit-test";
  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    return mockResult(rowsForReviewApply<T>(sql, params));
  }

  async transaction<T>(fn: (client: DbTxClient) => Promise<T>): Promise<T> {
    const txClient: DbTxClient = {
      [dbTxClientBrand]: true,
      query: (sql, params = []) => this.query(sql, params)
    };
    return fn(txClient);
  }

  async close(): Promise<void> {}
}

describe("review apply", () => {
  it("acknowledges claim conflict reviews without mutating facts", async () => {
    const store = new ReviewApplyDbStore();

    const result = await applyApprovedReviewCandidate(store, "REV-CLAIM-CONFLICT", "analyst");

    expect(result).toEqual({
      status: "acknowledged",
      review_id: "REV-CLAIM-CONFLICT",
      kind: "claim_conflict_review",
      claim_id: "CLM-ACTIVE-TSMC",
      edge_id: "EDGE-TSMC",
      reason: "acknowledged claim conflict review for CLM-ACTIVE-TSMC; no fact edge or claim status is changed by design"
    });
    expect(store.calls.some((call) => call.sql.includes("INSERT INTO change_records") && call.params.includes("CLAIM_CONFLICT_REVIEW_APPLIED"))).toBe(true);
    expect(store.calls.some((call) => call.sql.includes("UPDATE review_candidates") && call.sql.includes("status = 'applied'"))).toBe(true);
    expect(store.calls.some((call) => call.sql.includes("INSERT INTO edges") || call.sql.includes("UPDATE edges"))).toBe(false);
    expect(store.calls.some((call) => call.sql.includes("UPDATE claims"))).toBe(false);
    expect(store.calls.some((call) => call.sql.includes("UPDATE unknown_items"))).toBe(false);
  });

  it("blocks review rows whose stored kind does not match the candidate payload kind", async () => {
    const store = new ReviewApplyDbStore();

    const result = await applyApprovedReviewCandidate(store, "REV-KIND-MISMATCH", "analyst");

    expect(result).toEqual({
      status: "blocked",
      review_id: "REV-KIND-MISMATCH",
      reason: "review candidate kind mismatch: row=semantic_change, payload=claim_conflict_review"
    });
    expect(store.calls.some((call) => call.sql.includes("UPDATE review_candidates") && call.sql.includes("status = 'blocked'"))).toBe(true);
    expect(store.calls.some((call) => call.sql.includes("INSERT INTO change_records") && call.params.includes("CLAIM_CONFLICT_REVIEW_APPLIED"))).toBe(false);
  });
});

function rowsForReviewApply<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[]): T[] {
  if (sql.includes("FROM review_candidates") || sql.includes("UPDATE review_candidates")) {
    const reviewId = String(params[0] ?? "REV-CLAIM-CONFLICT");
    if (reviewId === "REV-KIND-MISMATCH") return [reviewCandidateKindMismatchRow(reviewId)] as unknown as T[];
    return [reviewCandidateRow(reviewId)] as unknown as T[];
  }
  return [];
}

function reviewCandidateRow(reviewId: string): pg.QueryResultRow {
  const candidate = buildClaimConflictReviewCandidate({
    payload: {
      claim_id: "CLM-ACTIVE-TSMC",
      claim_text: "NVIDIA publicly discloses that it buys wafer from TSMC.",
      edge_id: "EDGE-TSMC",
      conflict_state: "open_conflict",
      severity: "high",
      recommended_action: "review_edge_for_deprecation",
      safe_write_status: "blocked_pending_review",
      edge_review_required: true,
      required_review_steps: ["inspect_supporting_evidence", "inspect_contradicting_evidence", "resolve_conflict_unknown", "review_fact_edge_for_deprecation"],
      evidence_refs: [
        { evidence_id: "EV-PRIMARY", role: "primary" },
        { evidence_id: "EV-CONTRA", role: "contradicting" }
      ],
      unknown_refs: [{ unknown_id: "UNK-CONFLICT", role: "blocking", status: "open" }],
      fact_write_policy: {
        automatic_fact_mutation_allowed: false,
        allowed_edge_mutation: "none",
        requires_human_review: true,
        reason_codes: ["open_conflict_unknown", "contradicting_evidence_linked", "active_fact_claim"]
      }
    }
  });

  return {
    review_id: reviewId,
    candidate_key: candidate.candidate_key,
    kind: candidate.kind,
    status: "approved",
    candidate,
    reviewer: "analyst",
    reviewed_at: new Date("2026-05-20T00:00:00.000Z"),
    decision_reason: "reviewed conflict",
    created_at: new Date("2026-05-20T00:00:00.000Z")
  };
}

function reviewCandidateKindMismatchRow(reviewId: string): pg.QueryResultRow {
  return {
    ...reviewCandidateRow(reviewId),
    kind: "semantic_change"
  };
}

function mockResult<T extends pg.QueryResultRow>(rows: T[]): pg.QueryResult<T> {
  return {
    command: "MOCK",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows
  };
}
