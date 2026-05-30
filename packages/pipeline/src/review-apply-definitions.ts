import type { ApplyResult, RelationType } from "@supplystrata/core";
import type { EntityImportResult, FacilityImportResult } from "@supplystrata/entity-import";
import type { SupplyStrataLogger } from "@supplystrata/observability";
import type { ReviewCandidate, ReviewCandidateKind, SupplierListReviewCandidate } from "@supplystrata/review-candidates";
import type { ReviewQueueItem } from "@supplystrata/review-store";

export interface AppliedReviewEdgeResult extends ApplyResult {
  role: "supplier_relation" | "facility_relation";
  relation: RelationType;
}

export type ReviewApplyResult =
  | {
      status: "applied";
      review_id: string;
      apply_results: AppliedReviewEdgeResult[];
      pending_entities_resolved: number;
      facility_import: Extract<FacilityImportResult, { status: "applied" }>;
    }
  | { status: "entity_applied"; review_id: string; import_result: Extract<EntityImportResult, { status: "applied" }> }
  | { status: "acknowledged"; review_id: string; kind: "semantic_change"; claim_id: string; reason: string }
  | { status: "acknowledged"; review_id: string; kind: "osh_facility_candidate"; reason: string; lead_id?: string }
  | { status: "acknowledged"; review_id: string; kind: "claim_conflict_review"; claim_id: string; edge_id: string | null; reason: string }
  | { status: "acknowledged"; review_id: string; kind: "official_disclosure_signal"; signal_title: string; reason: string }
  | { status: "blocked"; review_id: string; reason: string; pending_id?: string };

export type ReviewApplyBatchItem = ReviewApplyResult | { status: "error"; review_id: string; reason: string };

export interface ReviewApplyBatchSummary {
  requested_limit: number;
  scanned: number;
  applied: number;
  applied_edges: number;
  entity_applied: number;
  acknowledged: number;
  blocked: number;
  errors: number;
  results: ReviewApplyBatchItem[];
}

export type SupplierListReviewItem = ReviewQueueItem & { candidate: SupplierListReviewCandidate };
export type ReviewItemByKind<K extends ReviewCandidateKind> = ReviewQueueItem & { kind: K; candidate: Extract<ReviewCandidate, { kind: K }> };

export interface ReviewApplyOptions {
  logger?: SupplyStrataLogger;
}

// 候选可被 apply 的状态判定。放在 definitions 里让 review-apply 编排和各 strategy 共享，
// 同时避免 strategy 反向 import review-apply.ts 造成循环依赖。
// blocked 允许人工补 seed/entity 后重试；批处理领取 approved 后会转成带 reviewed_at 的 in_review。
export function isReviewItemApplicable(item: ReviewQueueItem): boolean {
  return item.status === "approved" || item.status === "blocked" || (item.status === "in_review" && item.reviewed_at !== undefined);
}
