import { type DatabaseStore } from "@supplystrata/db/write";
import { applyEntitySourceReviewCandidate } from "@supplystrata/entity-import";
import { markReviewCandidateApplied, type ReviewQueueItem } from "@supplystrata/review-store";
import { assertReviewItemKind, blockReviewCandidate } from "./review-apply-blocking.js";
import type { ReviewApplyResult, ReviewItemByKind } from "./review-apply-definitions.js";

export async function applyEntityReviewStrategy(store: DatabaseStore, item: ReviewQueueItem, reviewer: string): Promise<ReviewApplyResult> {
  assertReviewItemKind(item, "entity_source_candidate");
  return applyEntityReviewCandidate(store, item, reviewer);
}

async function applyEntityReviewCandidate(
  store: DatabaseStore,
  item: ReviewItemByKind<"entity_source_candidate">,
  reviewer: string
): Promise<ReviewApplyResult> {
  const candidate = item.candidate;
  return store.transaction(async (client) => {
    const importResult = await applyEntitySourceReviewCandidate(client, candidate, reviewer);
    if (importResult.status === "blocked") return blockReviewCandidate(client, item.review_id, importResult.reason);
    await markReviewCandidateApplied(client, { reviewId: item.review_id, reason: `imported entity ${importResult.entity_id}` });
    return { status: "entity_applied", review_id: item.review_id, import_result: importResult };
  });
}
