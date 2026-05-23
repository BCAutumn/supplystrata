import { upsertSemanticChangeClaimDraft } from "@supplystrata/claim-builder";
import { markLeadObservationPromoted, recordSemanticChange, type DatabaseStore } from "@supplystrata/db/write";
import { markReviewCandidateApplied, type ReviewQueueItem } from "@supplystrata/review-store";
import { assertReviewItemKind, blockReviewCandidate } from "./review-apply-blocking.js";
import type { ReviewApplyResult } from "./review-apply-definitions.js";

export async function applySemanticChangeReviewStrategy(store: DatabaseStore, item: ReviewQueueItem, reviewer: string): Promise<ReviewApplyResult> {
  assertReviewItemKind(item, "semantic_change");
  if (item.reviewed_at === undefined) {
    const reason = "semantic change review candidate cannot be applied without reviewed_at";
    return store.transaction((client) => blockReviewCandidate(client, item.review_id, reason));
  }
  const reviewedAt = item.reviewed_at;
  const candidate = item.candidate;
  return store.transaction(async (client) => {
    const draft = await upsertSemanticChangeClaimDraft(client, candidate, {
      reviewed_at: reviewedAt,
      caused_by: reviewer
    });
    const reason = `acknowledged semantic change review candidate and created draft claim ${draft.claim_id}; no graph edge is applied by design`;
    await markReviewCandidateApplied(client, { reviewId: item.review_id, reason });
    return { status: "acknowledged", review_id: item.review_id, kind: "semantic_change", claim_id: draft.claim_id, reason };
  });
}

export async function applyOshFacilityReviewStrategy(store: DatabaseStore, item: ReviewQueueItem): Promise<ReviewApplyResult> {
  assertReviewItemKind(item, "osh_facility_candidate");
  const candidate = item.candidate;
  return store.transaction(async (client) => {
    const sourceLeadId = candidate.payload.source_lead_id;
    if (sourceLeadId !== undefined) {
      await markLeadObservationPromoted(client, {
        leadId: sourceLeadId,
        reviewId: item.review_id,
        attrsPatch: {
          promoted_review_id: item.review_id,
          promoted_observation_id: candidate.payload.observation_id,
          promoted_osh_facility_id: candidate.payload.osh_candidate.os_id
        }
      });
    }
    const reason = `acknowledged OSH facility candidate ${candidate.payload.osh_candidate.os_id}; no graph edge is applied by design`;
    await markReviewCandidateApplied(client, { reviewId: item.review_id, reason });
    return {
      status: "acknowledged",
      review_id: item.review_id,
      kind: "osh_facility_candidate",
      reason,
      ...(sourceLeadId === undefined ? {} : { lead_id: sourceLeadId })
    };
  });
}

export async function applyClaimConflictReviewStrategy(store: DatabaseStore, item: ReviewQueueItem, reviewer: string): Promise<ReviewApplyResult> {
  assertReviewItemKind(item, "claim_conflict_review");
  const candidate = item.candidate;
  return store.transaction(async (client) => {
    const reason = `acknowledged claim conflict review for ${candidate.payload.claim_id}; no fact edge or claim status is changed by design`;
    await recordSemanticChange(client, {
      scope_kind: "claim",
      scope_id: candidate.payload.claim_id,
      change_type: "CLAIM_CONFLICT_REVIEW_APPLIED",
      after: {
        review_id: item.review_id,
        edge_id: candidate.payload.edge_id,
        conflict_state: candidate.payload.conflict_state,
        severity: candidate.payload.severity,
        recommended_action: candidate.payload.recommended_action,
        safe_write_status: candidate.payload.safe_write_status,
        edge_review_required: candidate.payload.edge_review_required,
        required_review_steps: candidate.payload.required_review_steps,
        fact_write_policy: candidate.payload.fact_write_policy
      },
      evidence_ids: candidate.payload.evidence_refs.map((ref) => ref.evidence_id),
      caused_by: reviewer
    });
    await markReviewCandidateApplied(client, { reviewId: item.review_id, reason });
    return {
      status: "acknowledged",
      review_id: item.review_id,
      kind: "claim_conflict_review",
      claim_id: candidate.payload.claim_id,
      edge_id: candidate.payload.edge_id,
      reason
    };
  });
}

export async function applyOfficialDisclosureSignalReviewStrategy(store: DatabaseStore, item: ReviewQueueItem, reviewer: string): Promise<ReviewApplyResult> {
  assertReviewItemKind(item, "official_disclosure_signal");
  const candidate = item.candidate;
  return store.transaction(async (client) => {
    const reason = `acknowledged official disclosure signal ${candidate.payload.signal_title}; no fact edge is applied by design`;
    await recordSemanticChange(client, {
      scope_kind: "source",
      scope_id: candidate.payload.source_adapter_id,
      change_type: "OFFICIAL_DISCLOSURE_SIGNAL_REVIEW_APPLIED",
      after: {
        review_id: item.review_id,
        source_item_id: candidate.payload.source_item_id,
        doc_id: candidate.payload.doc_id,
        signal_title: candidate.payload.signal_title,
        evidence_level_hint: candidate.payload.evidence_level_hint,
        cite_locator: candidate.payload.cite_locator,
        fact_write_policy: candidate.payload.fact_write_policy
      },
      caused_by: reviewer
    });
    await markReviewCandidateApplied(client, { reviewId: item.review_id, reason });
    return {
      status: "acknowledged",
      review_id: item.review_id,
      kind: "official_disclosure_signal",
      signal_title: candidate.payload.signal_title,
      reason
    };
  });
}
