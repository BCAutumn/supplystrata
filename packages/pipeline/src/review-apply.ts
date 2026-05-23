import { type DatabaseStore } from "@supplystrata/db/write";
import { messageFromUnknown, noopLogger } from "@supplystrata/observability";
import { type ReviewCandidateKind } from "@supplystrata/review-candidates";
import { claimApprovedReviewCandidates, getReviewCandidate, markReviewCandidateBlocked, type ReviewQueueItem } from "@supplystrata/review-store";
import {
  applyClaimConflictReviewStrategy,
  applyOfficialDisclosureSignalReviewStrategy,
  applyOshFacilityReviewStrategy,
  applySemanticChangeReviewStrategy
} from "./review-apply-acknowledgements.js";
import { blockReviewCandidate } from "./review-apply-blocking.js";
import type { ReviewApplyBatchItem, ReviewApplyBatchSummary, ReviewApplyOptions, ReviewApplyResult } from "./review-apply-definitions.js";
import { applyEntityReviewStrategy } from "./review-apply-entity.js";
import { applySupplierListReviewStrategy } from "./review-apply-supplier-list.js";

export type {
  AppliedReviewEdgeResult,
  ReviewApplyBatchItem,
  ReviewApplyBatchSummary,
  ReviewApplyOptions,
  ReviewApplyResult
} from "./review-apply-definitions.js";

type ReviewApplyStrategy = (store: DatabaseStore, item: ReviewQueueItem, reviewer: string, options: Required<ReviewApplyOptions>) => Promise<ReviewApplyResult>;

type ReviewApplyStrategyRegistry = { readonly [K in ReviewCandidateKind]: ReviewApplyStrategy };

const reviewApplyStrategies: ReviewApplyStrategyRegistry = {
  entity_source_candidate: applyEntityReviewStrategy,
  supplier_list_row: applySupplierListReviewStrategy,
  semantic_change: applySemanticChangeReviewStrategy,
  osh_facility_candidate: applyOshFacilityReviewStrategy,
  claim_conflict_review: applyClaimConflictReviewStrategy,
  official_disclosure_signal: applyOfficialDisclosureSignalReviewStrategy
};

export async function applyApprovedReviewCandidate(
  store: DatabaseStore,
  reviewId: string,
  reviewer: string,
  options: ReviewApplyOptions = {}
): Promise<ReviewApplyResult> {
  const logger = options.logger ?? noopLogger;
  const item = await getReviewCandidate(store.read, reviewId);
  if (item === undefined) return { status: "blocked", review_id: reviewId, reason: "review candidate not found" };
  if (!canApplyReviewItem(item))
    return { status: "blocked", review_id: reviewId, reason: `review candidate status is ${item.status}, expected approved or blocked` };
  if (item.kind !== item.candidate.kind) {
    return store.transaction((client) =>
      blockReviewCandidate(client, reviewId, `review candidate kind mismatch: row=${item.kind}, payload=${item.candidate.kind}`)
    );
  }

  return reviewApplyStrategies[item.kind](store, item, reviewer, { logger });
}

function canApplyReviewItem(item: ReviewQueueItem): boolean {
  // blocked 候选允许人工补 seed/entity 后重试；批处理领取 approved 后会转成带 reviewed_at 的 in_review。
  return item.status === "approved" || item.status === "blocked" || (item.status === "in_review" && item.reviewed_at !== undefined);
}

export async function applyApprovedReviewCandidates(
  store: DatabaseStore,
  input: { reviewer: string; limit: number } & ReviewApplyOptions
): Promise<ReviewApplyBatchSummary> {
  const logger = input.logger ?? noopLogger;
  const items = await store.transaction((client) => claimApprovedReviewCandidates(client, { limit: input.limit }));
  const results: ReviewApplyBatchItem[] = [];
  for (const item of items) {
    try {
      results.push(await applyApprovedReviewCandidate(store, item.review_id, input.reviewer, { logger }));
    } catch (error) {
      const reason = messageFromUnknown(error);
      try {
        // 批处理已经把 approved 领取成 in_review；异常时必须显式落到 blocked，避免候选永远卡在领取态。
        await store.transaction((client) => markReviewCandidateBlocked(client, { reviewId: item.review_id, reason }));
      } catch (blockError) {
        results.push({
          status: "error",
          review_id: item.review_id,
          reason: `${reason}; additionally failed to block candidate: ${messageFromUnknown(blockError)}`
        });
        continue;
      }
      results.push({ status: "error", review_id: item.review_id, reason });
    }
  }
  const appliedItems = results.filter((item) => item.status === "applied");
  return {
    requested_limit: input.limit,
    scanned: items.length,
    applied: appliedItems.length,
    applied_edges: appliedItems.reduce((sum, item) => sum + item.apply_results.length, 0),
    entity_applied: results.filter((item) => item.status === "entity_applied").length,
    acknowledged: results.filter((item) => item.status === "acknowledged").length,
    blocked: results.filter((item) => item.status === "blocked").length,
    errors: results.filter((item) => item.status === "error").length,
    results
  };
}
