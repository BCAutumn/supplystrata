import { markReviewCandidateBlocked, type ReviewQueueItem } from "@supplystrata/review-store";
import type { DbTxClient } from "@supplystrata/db/write";
import type { ReviewApplyResult, ReviewItemByKind } from "./review-apply-definitions.js";
import type { ReviewCandidateKind } from "@supplystrata/review-candidates";

export async function blockReviewCandidate(
  client: DbTxClient,
  reviewId: string,
  reason: string,
  pendingId?: string
): Promise<Extract<ReviewApplyResult, { status: "blocked" }>> {
  await markReviewCandidateBlocked(client, { reviewId, reason });
  return { status: "blocked", review_id: reviewId, reason, ...(pendingId === undefined ? {} : { pending_id: pendingId }) };
}

export function assertReviewItemKind<K extends ReviewCandidateKind>(item: ReviewQueueItem, kind: K): asserts item is ReviewItemByKind<K> {
  if (item.kind === kind && item.candidate.kind === kind) return;
  throw new Error(`Review apply strategy received ${item.kind}/${item.candidate.kind}, expected ${kind}`);
}
