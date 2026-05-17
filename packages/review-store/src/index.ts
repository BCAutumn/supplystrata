import type pg from "pg";
import type { DbClient } from "@supplystrata/db";
import { isReviewCandidate, type ReviewCandidate, type ReviewCandidateKind, type ReviewCandidateStatus } from "@supplystrata/review-candidates";

export interface ReviewQueueItem {
  review_id: string;
  candidate_key: string;
  kind: ReviewCandidateKind;
  status: ReviewCandidateStatus;
  candidate: ReviewCandidate;
  reviewer?: string;
  reviewed_at?: string;
  decision_reason?: string;
  created_at: string;
}

export interface ReviewStats {
  pending: number;
  approved: number;
  rejected: number;
  blocked: number;
  applied: number;
  total: number;
}

interface ReviewCandidateRow extends pg.QueryResultRow {
  review_id: string;
  candidate_key: string | null;
  kind: ReviewCandidateKind;
  status: ReviewCandidateStatus;
  candidate: unknown;
  reviewer: string | null;
  reviewed_at: Date | null;
  decision_reason: string | null;
  created_at: Date;
}

interface ReviewStatsRow extends pg.QueryResultRow {
  status: ReviewCandidateStatus;
  count: string;
}

export async function enqueueReviewCandidates(client: DbClient, candidates: readonly ReviewCandidate[]): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    const result = await client.query(
      `INSERT INTO review_candidates (review_id, candidate_key, kind, status, candidate, doc_id, source_adapter_id)
       VALUES ($1,$2,$3,'pending',$4,$5,$6)
       ON CONFLICT (candidate_key) WHERE candidate_key IS NOT NULL DO NOTHING`,
      [candidate.review_id, candidate.candidate_key, candidate.kind, candidate, candidate.evidence.doc_id ?? null, candidate.evidence.source_adapter_id]
    );
    if (result.rowCount === 1) inserted += 1;
    else skipped += 1;
  }
  return { inserted, skipped };
}

export async function reviewStats(client: DbClient): Promise<ReviewStats> {
  const result = await client.query<ReviewStatsRow>("SELECT status, count(*)::text AS count FROM review_candidates GROUP BY status");
  const stats: ReviewStats = { pending: 0, approved: 0, rejected: 0, blocked: 0, applied: 0, total: 0 };
  for (const row of result.rows) {
    const count = Number.parseInt(row.count, 10);
    if (row.status === "pending") stats.pending = count;
    if (row.status === "approved") stats.approved = count;
    if (row.status === "rejected") stats.rejected = count;
    if (row.status === "blocked") stats.blocked = count;
    if (row.status === "applied") stats.applied = count;
    stats.total += count;
  }
  return stats;
}

export async function nextReviewCandidate(client: DbClient): Promise<ReviewQueueItem | undefined> {
  const result = await client.query<ReviewCandidateRow>(
    `SELECT review_id, candidate_key, kind, status, candidate, reviewer, reviewed_at, decision_reason, created_at
     FROM review_candidates
     WHERE status = 'pending'
     ORDER BY created_at, review_id
     LIMIT 1`
  );
  return rowToReviewItem(result.rows[0]);
}

export async function listApprovedReviewCandidates(client: DbClient, input: { limit: number }): Promise<ReviewQueueItem[]> {
  const result = await client.query<ReviewCandidateRow>(
    `SELECT review_id, candidate_key, kind, status, candidate, reviewer, reviewed_at, decision_reason, created_at
     FROM review_candidates
     WHERE status = 'approved'
     ORDER BY reviewed_at NULLS LAST, created_at, review_id
     LIMIT $1`,
    [input.limit]
  );
  return result.rows.map((row) => {
    const item = rowToReviewItem(row);
    if (item === undefined) throw new Error(`Invalid approved review candidate row: ${row.review_id}`);
    return item;
  });
}

export async function getReviewCandidate(client: DbClient, reviewId: string): Promise<ReviewQueueItem | undefined> {
  const result = await client.query<ReviewCandidateRow>(
    `SELECT review_id, candidate_key, kind, status, candidate, reviewer, reviewed_at, decision_reason, created_at
     FROM review_candidates
     WHERE review_id = $1`,
    [reviewId]
  );
  return rowToReviewItem(result.rows[0]);
}

export async function decideReviewCandidate(
  client: DbClient,
  input: {
    reviewId: string;
    decision: Extract<ReviewCandidateStatus, "approved" | "rejected">;
    reviewer: string;
    reason?: string;
  }
): Promise<ReviewQueueItem> {
  const result = await client.query<ReviewCandidateRow>(
    `UPDATE review_candidates
     SET status = $2, reviewer = $3, reviewed_at = now(), decision_reason = $4
     WHERE review_id = $1
     RETURNING review_id, candidate_key, kind, status, candidate, reviewer, reviewed_at, decision_reason, created_at`,
    [input.reviewId, input.decision, input.reviewer, input.reason ?? null]
  );
  const item = rowToReviewItem(result.rows[0]);
  if (item === undefined) throw new Error(`Review candidate not found: ${input.reviewId}`);
  return item;
}

export async function markReviewCandidateApplied(client: DbClient, input: { reviewId: string; reason: string }): Promise<void> {
  await client.query(
    `UPDATE review_candidates
     SET status = 'applied', decision_reason = $2, updated_at = now()
     WHERE review_id = $1`,
    [input.reviewId, input.reason]
  );
}

export async function markReviewCandidateBlocked(client: DbClient, input: { reviewId: string; reason: string }): Promise<void> {
  await client.query(
    `UPDATE review_candidates
     SET status = 'blocked', decision_reason = $2, updated_at = now()
     WHERE review_id = $1`,
    [input.reviewId, input.reason]
  );
}

function rowToReviewItem(row: ReviewCandidateRow | undefined): ReviewQueueItem | undefined {
  if (row === undefined) return undefined;
  if (!isReviewCandidate(row.candidate)) throw new Error(`Invalid review candidate payload: ${row.review_id}`);
  return {
    review_id: row.review_id,
    candidate_key: row.candidate_key ?? row.candidate.candidate_key,
    kind: row.kind,
    status: row.status,
    candidate: row.candidate,
    created_at: row.created_at.toISOString(),
    ...(row.reviewer === null ? {} : { reviewer: row.reviewer }),
    ...(row.reviewed_at === null ? {} : { reviewed_at: row.reviewed_at.toISOString() }),
    ...(row.decision_reason === null ? {} : { decision_reason: row.decision_reason })
  };
}
