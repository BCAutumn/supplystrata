import type { ClaimEvidenceRole, ClaimStatus, ClaimUnknownRole } from "@supplystrata/core";

export const CLAIM_CONFLICT_ADJUDICATION_STATES = ["none", "open_conflict", "contradicting_evidence", "resolved_conflict"] as const;
export const CLAIM_CONFLICT_ADJUDICATION_SEVERITIES = ["none", "low", "medium", "high"] as const;
export const CLAIM_CONFLICT_RECOMMENDED_ACTIONS = [
  "none",
  "review_claim",
  "review_edge_for_deprecation",
  "collect_resolution_evidence",
  "keep_resolved_context"
] as const;

export type ClaimConflictAdjudicationState = (typeof CLAIM_CONFLICT_ADJUDICATION_STATES)[number];
export type ClaimConflictAdjudicationSeverity = (typeof CLAIM_CONFLICT_ADJUDICATION_SEVERITIES)[number];
export type ClaimConflictRecommendedAction = (typeof CLAIM_CONFLICT_RECOMMENDED_ACTIONS)[number];

export interface ClaimConflictAdjudicationEvidenceRef {
  evidence_id: string;
  role: ClaimEvidenceRole;
}

export interface ClaimConflictAdjudicationUnknownRef {
  unknown_id: string;
  role: ClaimUnknownRole;
  status: string;
}

export interface ClaimConflictAdjudicationInput {
  claim_status: ClaimStatus;
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

export const CLAIM_CONFLICT_REVIEW_QUEUE_KINDS = ["none", "claim_conflict_review"] as const;
export const CLAIM_CONFLICT_SAFE_WRITE_STATUSES = ["none", "blocked_pending_review", "resolved_context_only"] as const;
export const CLAIM_CONFLICT_REVIEW_STEPS = [
  "inspect_supporting_evidence",
  "inspect_contradicting_evidence",
  "resolve_conflict_unknown",
  "review_claim_scope",
  "review_fact_edge_for_deprecation",
  "record_resolution_context"
] as const;

export type ClaimConflictReviewQueueKind = (typeof CLAIM_CONFLICT_REVIEW_QUEUE_KINDS)[number];
export type ClaimConflictSafeWriteStatus = (typeof CLAIM_CONFLICT_SAFE_WRITE_STATUSES)[number];
export type ClaimConflictReviewStep = (typeof CLAIM_CONFLICT_REVIEW_STEPS)[number];

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

interface ClaimConflictFacts {
  claim_is_inactive: boolean;
  has_conflict_context: boolean;
  has_contradicting_evidence: boolean;
  has_open_blocking_unknown: boolean;
  has_resolved_conflict_unknown: boolean;
  is_active_fact_claim: boolean;
}

interface ClaimConflictAdjudicationRule {
  matches(facts: ClaimConflictFacts): boolean;
  adjudicate(facts: ClaimConflictFacts): ClaimConflictAdjudication;
}

const CLAIM_CONFLICT_ADJUDICATION_RULES: readonly ClaimConflictAdjudicationRule[] = [
  {
    matches: (facts) => facts.claim_is_inactive,
    adjudicate: (facts) =>
      conflictAdjudication({
        state: facts.has_conflict_context ? "resolved_conflict" : "none",
        severity: "none",
        recommended_action: "keep_resolved_context",
        edge_review_required: false,
        reason_codes: ["claim_inactive"]
      })
  },
  {
    matches: (facts) => facts.has_open_blocking_unknown,
    adjudicate: (facts) =>
      conflictAdjudication({
        state: "open_conflict",
        severity: facts.is_active_fact_claim && facts.has_contradicting_evidence ? "high" : "medium",
        recommended_action: facts.is_active_fact_claim && facts.has_contradicting_evidence ? "review_edge_for_deprecation" : "collect_resolution_evidence",
        edge_review_required: facts.is_active_fact_claim && facts.has_contradicting_evidence,
        reason_codes: claimConflictReasonCodes("open_conflict_unknown", facts)
      })
  },
  {
    matches: (facts) => facts.has_contradicting_evidence,
    adjudicate: (facts) =>
      conflictAdjudication({
        state: facts.has_resolved_conflict_unknown ? "resolved_conflict" : "contradicting_evidence",
        severity: facts.has_resolved_conflict_unknown ? "low" : facts.is_active_fact_claim ? "high" : "medium",
        recommended_action: facts.has_resolved_conflict_unknown
          ? "keep_resolved_context"
          : facts.is_active_fact_claim
            ? "review_edge_for_deprecation"
            : "review_claim",
        edge_review_required: !facts.has_resolved_conflict_unknown && facts.is_active_fact_claim,
        reason_codes: claimConflictReasonCodes("contradicting_evidence_linked", facts)
      })
  },
  {
    matches: (facts) => facts.has_resolved_conflict_unknown,
    adjudicate: () =>
      conflictAdjudication({
        state: "resolved_conflict",
        severity: "low",
        recommended_action: "keep_resolved_context",
        edge_review_required: false,
        reason_codes: ["conflict_unknown_resolved"]
      })
  },
  {
    matches: () => true,
    adjudicate: () =>
      conflictAdjudication({
        state: "none",
        severity: "none",
        recommended_action: "none",
        edge_review_required: false,
        reason_codes: []
      })
  }
];

export function adjudicateClaimConflict(input: ClaimConflictAdjudicationInput): ClaimConflictAdjudication {
  const facts = claimConflictFacts(input);
  const rule = CLAIM_CONFLICT_ADJUDICATION_RULES.find((candidate) => candidate.matches(facts));
  if (rule === undefined) throw new Error("Claim conflict adjudication rules must include a fallback rule");
  return rule.adjudicate(facts);
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

function claimConflictFacts(input: ClaimConflictAdjudicationInput): ClaimConflictFacts {
  const hasContradictingEvidence = input.evidence_refs.some((ref) => ref.role === "contradicting");
  const hasOpenBlockingUnknown = input.unknown_refs.some((ref) => ref.status === "open" && isConflictUnknownRole(ref.role));
  const hasResolvedConflictUnknown = input.unknown_refs.some((ref) => ref.status === "resolved" && isConflictUnknownRole(ref.role));
  return {
    claim_is_inactive: input.claim_status === "rejected" || input.claim_status === "superseded",
    has_conflict_context: hasContradictingEvidence || hasOpenBlockingUnknown || hasResolvedConflictUnknown,
    has_contradicting_evidence: hasContradictingEvidence,
    has_open_blocking_unknown: hasOpenBlockingUnknown,
    has_resolved_conflict_unknown: hasResolvedConflictUnknown,
    is_active_fact_claim: input.claim_status === "active" && input.edge_id !== null
  };
}

function isConflictUnknownRole(role: ClaimConflictAdjudicationUnknownRef["role"]): boolean {
  return role === "blocking" || role === "boundary";
}

function claimConflictReasonCodes(primaryReason: string, facts: ClaimConflictFacts): string[] {
  if (primaryReason === "open_conflict_unknown") {
    return [
      primaryReason,
      ...(facts.has_contradicting_evidence ? ["contradicting_evidence_linked"] : []),
      facts.is_active_fact_claim ? "active_fact_claim" : "draft_or_non_edge_claim"
    ];
  }
  return [
    primaryReason,
    ...(facts.has_resolved_conflict_unknown ? ["conflict_unknown_resolved"] : []),
    facts.is_active_fact_claim ? "active_fact_claim" : "draft_or_non_edge_claim"
  ];
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
