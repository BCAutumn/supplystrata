export type ClaimConflictAdjudicationState = "none" | "open_conflict" | "contradicting_evidence" | "resolved_conflict";
export type ClaimConflictAdjudicationSeverity = "none" | "low" | "medium" | "high";
export type ClaimConflictRecommendedAction = "none" | "review_claim" | "review_edge_for_deprecation" | "collect_resolution_evidence" | "keep_resolved_context";

export interface ClaimConflictAdjudicationEvidenceRef {
  evidence_id: string;
  role: "primary" | "supporting" | "contradicting" | "context";
}

export interface ClaimConflictAdjudicationUnknownRef {
  unknown_id: string;
  role: "boundary" | "blocking" | "context";
  status: string;
}

export interface ClaimConflictAdjudicationInput {
  claim_status: "draft" | "active" | "superseded" | "rejected";
  edge_id: string | null;
  evidence_refs: readonly ClaimConflictAdjudicationEvidenceRef[];
  unknown_refs: readonly ClaimConflictAdjudicationUnknownRef[];
}

export interface ClaimConflictAdjudication {
  state: ClaimConflictAdjudicationState;
  severity: ClaimConflictAdjudicationSeverity;
  recommended_action: ClaimConflictRecommendedAction;
  edge_review_required: boolean;
  allowed_edge_mutation: "none";
  reason_codes: string[];
}

export type ClaimConflictReviewQueueKind = "none" | "claim_conflict_review";
export type ClaimConflictSafeWriteStatus = "none" | "blocked_pending_review" | "resolved_context_only";
export type ClaimConflictReviewStep =
  | "inspect_supporting_evidence"
  | "inspect_contradicting_evidence"
  | "resolve_conflict_unknown"
  | "review_claim_scope"
  | "review_fact_edge_for_deprecation"
  | "record_resolution_context";

export interface ClaimConflictFactWritePolicy {
  automatic_fact_mutation_allowed: false;
  allowed_edge_mutation: "none";
  requires_human_review: boolean;
  reason_codes: string[];
}

export interface ClaimConflictReviewPacketInput extends ClaimConflictAdjudicationInput {
  claim_id: string;
  claim_text: string;
}

export interface ClaimConflictReviewPacket {
  claim_id: string;
  claim_text: string;
  conflict_state: ClaimConflictAdjudicationState;
  severity: ClaimConflictAdjudicationSeverity;
  recommended_action: ClaimConflictRecommendedAction;
  review_queue_kind: ClaimConflictReviewQueueKind;
  safe_write_status: ClaimConflictSafeWriteStatus;
  edge_review_required: boolean;
  required_review_steps: ClaimConflictReviewStep[];
  evidence_refs: ClaimConflictAdjudicationEvidenceRef[];
  unknown_refs: ClaimConflictAdjudicationUnknownRef[];
  fact_write_policy: ClaimConflictFactWritePolicy;
}

export interface ClaimConflictContext {
  conflict_state: ClaimConflictAdjudicationState;
  adjudication: ClaimConflictAdjudication;
  review_packet: ClaimConflictReviewPacket;
}

export function adjudicateClaimConflict(input: ClaimConflictAdjudicationInput): ClaimConflictAdjudication {
  const hasContradictingEvidence = input.evidence_refs.some((ref) => ref.role === "contradicting");
  const hasOpenBlockingUnknown = input.unknown_refs.some((ref) => ref.status === "open" && (ref.role === "blocking" || ref.role === "boundary"));
  const hasResolvedConflictUnknown = input.unknown_refs.some((ref) => ref.status === "resolved" && (ref.role === "blocking" || ref.role === "boundary"));
  const isActiveFactClaim = input.claim_status === "active" && input.edge_id !== null;

  if (input.claim_status === "rejected" || input.claim_status === "superseded") {
    return conflictAdjudication({
      state: hasContradictingEvidence || hasOpenBlockingUnknown || hasResolvedConflictUnknown ? "resolved_conflict" : "none",
      severity: "none",
      recommended_action: "keep_resolved_context",
      edge_review_required: false,
      reason_codes: ["claim_inactive"]
    });
  }

  if (hasOpenBlockingUnknown) {
    return conflictAdjudication({
      state: "open_conflict",
      severity: isActiveFactClaim && hasContradictingEvidence ? "high" : "medium",
      recommended_action: isActiveFactClaim && hasContradictingEvidence ? "review_edge_for_deprecation" : "collect_resolution_evidence",
      edge_review_required: isActiveFactClaim && hasContradictingEvidence,
      reason_codes: [
        "open_conflict_unknown",
        ...(hasContradictingEvidence ? ["contradicting_evidence_linked"] : []),
        ...(isActiveFactClaim ? ["active_fact_claim"] : ["draft_or_non_edge_claim"])
      ]
    });
  }

  if (hasContradictingEvidence) {
    return conflictAdjudication({
      state: hasResolvedConflictUnknown ? "resolved_conflict" : "contradicting_evidence",
      severity: hasResolvedConflictUnknown ? "low" : isActiveFactClaim ? "high" : "medium",
      recommended_action: hasResolvedConflictUnknown ? "keep_resolved_context" : isActiveFactClaim ? "review_edge_for_deprecation" : "review_claim",
      edge_review_required: !hasResolvedConflictUnknown && isActiveFactClaim,
      reason_codes: [
        "contradicting_evidence_linked",
        ...(hasResolvedConflictUnknown ? ["conflict_unknown_resolved"] : []),
        ...(isActiveFactClaim ? ["active_fact_claim"] : ["draft_or_non_edge_claim"])
      ]
    });
  }

  if (hasResolvedConflictUnknown) {
    return conflictAdjudication({
      state: "resolved_conflict",
      severity: "low",
      recommended_action: "keep_resolved_context",
      edge_review_required: false,
      reason_codes: ["conflict_unknown_resolved"]
    });
  }

  return conflictAdjudication({
    state: "none",
    severity: "none",
    recommended_action: "none",
    edge_review_required: false,
    reason_codes: []
  });
}

export function buildClaimConflictContext(input: ClaimConflictReviewPacketInput): ClaimConflictContext {
  const adjudication = adjudicateClaimConflict(input);
  return {
    conflict_state: adjudication.state,
    adjudication,
    review_packet: buildClaimConflictReviewPacketFromAdjudication(input, adjudication)
  };
}

export function buildClaimConflictReviewPacket(input: ClaimConflictReviewPacketInput): ClaimConflictReviewPacket {
  const adjudication = adjudicateClaimConflict(input);
  return buildClaimConflictReviewPacketFromAdjudication(input, adjudication);
}

function buildClaimConflictReviewPacketFromAdjudication(
  input: ClaimConflictReviewPacketInput,
  adjudication: ClaimConflictAdjudication
): ClaimConflictReviewPacket {
  const requiresHumanReview = adjudication.state === "open_conflict" || adjudication.state === "contradicting_evidence";

  return {
    claim_id: input.claim_id,
    claim_text: input.claim_text,
    conflict_state: adjudication.state,
    severity: adjudication.severity,
    recommended_action: adjudication.recommended_action,
    review_queue_kind: requiresHumanReview ? "claim_conflict_review" : "none",
    safe_write_status: safeWriteStatusForAdjudication(adjudication),
    edge_review_required: adjudication.edge_review_required,
    required_review_steps: claimConflictReviewSteps(input, adjudication),
    evidence_refs: [...input.evidence_refs],
    unknown_refs: [...input.unknown_refs],
    fact_write_policy: {
      automatic_fact_mutation_allowed: false,
      allowed_edge_mutation: adjudication.allowed_edge_mutation,
      requires_human_review: requiresHumanReview,
      reason_codes: [...adjudication.reason_codes]
    }
  };
}

function conflictAdjudication(input: Omit<ClaimConflictAdjudication, "allowed_edge_mutation">): ClaimConflictAdjudication {
  return { ...input, allowed_edge_mutation: "none" };
}

function safeWriteStatusForAdjudication(adjudication: ClaimConflictAdjudication): ClaimConflictSafeWriteStatus {
  if (adjudication.state === "open_conflict" || adjudication.state === "contradicting_evidence") return "blocked_pending_review";
  if (adjudication.state === "resolved_conflict") return "resolved_context_only";
  return "none";
}

function claimConflictReviewSteps(input: ClaimConflictAdjudicationInput, adjudication: ClaimConflictAdjudication): ClaimConflictReviewStep[] {
  if (adjudication.state === "none") return [];

  const steps = new Set<ClaimConflictReviewStep>();
  const hasSupportingEvidence = input.evidence_refs.some((ref) => ref.role === "primary" || ref.role === "supporting");
  const hasContradictingEvidence = input.evidence_refs.some((ref) => ref.role === "contradicting");
  const hasOpenConflictUnknown = input.unknown_refs.some((ref) => ref.status === "open" && (ref.role === "blocking" || ref.role === "boundary"));

  if (hasSupportingEvidence) steps.add("inspect_supporting_evidence");
  if (hasContradictingEvidence) steps.add("inspect_contradicting_evidence");
  if (hasOpenConflictUnknown) steps.add("resolve_conflict_unknown");
  if (adjudication.recommended_action === "review_claim") steps.add("review_claim_scope");
  if (adjudication.edge_review_required) steps.add("review_fact_edge_for_deprecation");
  if (adjudication.state === "resolved_conflict") steps.add("record_resolution_context");

  return [...steps];
}
