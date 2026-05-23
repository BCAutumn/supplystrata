import { createHash } from "node:crypto";
import type { ClaimType, EvidenceLevel, RelationType } from "@supplystrata/core";
import type { SemanticChangeReviewCandidate } from "@supplystrata/review-candidates";

export interface ClaimableFactEdge {
  edge_id: string;
  subject_id: string;
  object_id: string;
  relation: RelationType;
  component: string | null;
  component_id: string | null;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  primary_evidence_id: string;
  last_verified_at: Date | string;
  subject_name: string;
  object_name: string;
}

export interface EdgeClaimDraft {
  claim_id: string;
  claim_type: ClaimType;
  claim_text: string;
  subject_id: string;
  object_id: string;
  component_id?: string;
  edge_id: string;
  evidence_id: string;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: false;
  generated_by: string;
  last_verified_at: string;
}

export interface SemanticChangeClaimDraft {
  claim_id: string;
  claim_type: ClaimType;
  claim_text: string;
  review_id: string;
  status: "draft";
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: true;
  generated_by: string;
  last_verified_at: string;
}

interface ClaimTextParts {
  componentObject: string;
  componentContext: string;
}

type ClaimTextTemplate = (edge: ClaimableFactEdge, parts: ClaimTextParts) => string;

const CLAIM_TYPE_BY_RELATION: Record<RelationType, ClaimType> = {
  BUYS_FROM: "SUPPLY_RELATION_CLAIM",
  SUPPLIES_TO: "SUPPLY_RELATION_CLAIM",
  USES_FOUNDRY: "SUPPLY_RELATION_CLAIM",
  USES_COMPONENT: "COMPONENT_EXPOSURE_CLAIM",
  MANUFACTURES_AT: "FACILITY_RELATION_CLAIM",
  OWNS_SUBSIDIARY: "ENTITY_FACT_CLAIM",
  OWNS_BUSINESS_UNIT: "ENTITY_FACT_CLAIM",
  IS_A: "ENTITY_FACT_CLAIM",
  OPERATES_FACILITY: "FACILITY_RELATION_CLAIM"
};

const CLAIM_TEXT_TEMPLATES: Record<RelationType, ClaimTextTemplate> = {
  BUYS_FROM: (edge, parts) => `${edge.subject_name} publicly discloses that it buys${parts.componentObject} from ${edge.object_name}.`,
  SUPPLIES_TO: (edge, parts) => `${edge.subject_name} publicly discloses that it supplies${parts.componentObject} to ${edge.object_name}.`,
  USES_FOUNDRY: (edge, parts) => `${edge.subject_name} publicly discloses that it uses ${edge.object_name} as a foundry${parts.componentContext}.`,
  USES_COMPONENT: (edge, parts) => `${edge.subject_name} publicly discloses exposure to${parts.componentObject} through ${edge.object_name}.`,
  MANUFACTURES_AT: (edge, parts) => `${edge.subject_name} publicly discloses manufacturing activity at ${edge.object_name}${parts.componentContext}.`,
  OWNS_SUBSIDIARY: (edge) => `${edge.subject_name} publicly discloses ownership of subsidiary ${edge.object_name}.`,
  OWNS_BUSINESS_UNIT: (edge) => `${edge.subject_name} publicly discloses ownership of business unit ${edge.object_name}.`,
  IS_A: (edge) => `${edge.subject_name} publicly discloses that ${edge.object_name} is part of its entity structure.`,
  OPERATES_FACILITY: (edge, parts) => `${edge.subject_name} publicly discloses that it operates ${edge.object_name}${parts.componentContext}.`
};

export function claimTypeForRelation(relation: RelationType): ClaimType {
  return CLAIM_TYPE_BY_RELATION[relation];
}

export function deterministicClaimIdForEdge(edgeId: string): string {
  const digest = createHash("sha256").update(`edge:${edgeId}`).digest("hex").slice(0, 24).toUpperCase();
  return `CLM-EDGE-${digest}`;
}

export function deterministicClaimIdForSemanticReview(reviewId: string): string {
  const digest = createHash("sha256").update(`semantic-review:${reviewId}`).digest("hex").slice(0, 24).toUpperCase();
  return `CLM-REVIEW-${digest}`;
}

export function deterministicConflictUnknownIdForSemanticReview(reviewId: string): string {
  const digest = createHash("sha256").update(`semantic-conflict:${reviewId}`).digest("hex").slice(0, 24).toUpperCase();
  return `UNK-CONFLICT-${digest}`;
}

export function deterministicConflictUnknownIdForClaimEvidence(claimId: string, evidenceId: string): string {
  const digest = createHash("sha256").update(`claim-evidence-conflict:${claimId}:${evidenceId}`).digest("hex").slice(0, 24).toUpperCase();
  return `UNK-CONFLICT-${digest}`;
}

export function isConflictingSemanticChange(changeType: string): boolean {
  return changeType.endsWith("_REMOVED");
}

export function buildClaimDraftFromEdge(edge: ClaimableFactEdge, input: { generated_by?: string } = {}): EdgeClaimDraft {
  if (edge.is_inferred) {
    throw new Error(`Cannot build active fact claim from inferred edge ${edge.edge_id}`);
  }
  const draftWithoutComponent: Omit<EdgeClaimDraft, "component_id"> = {
    claim_id: deterministicClaimIdForEdge(edge.edge_id),
    claim_type: claimTypeForRelation(edge.relation),
    claim_text: claimTextForEdge(edge),
    subject_id: edge.subject_id,
    object_id: edge.object_id,
    edge_id: edge.edge_id,
    evidence_id: edge.primary_evidence_id,
    evidence_level: edge.evidence_level,
    confidence: edge.confidence,
    is_inferred: false,
    generated_by: input.generated_by ?? "claim-builder.edge-fact.v1",
    last_verified_at: normalizeTimestamp(edge.last_verified_at)
  };
  if (edge.component_id === null) return draftWithoutComponent;
  return { ...draftWithoutComponent, component_id: edge.component_id };
}

export function buildClaimDraftFromSemanticChangeReview(
  candidate: SemanticChangeReviewCandidate,
  input: { generated_by?: string; reviewed_at: string }
): SemanticChangeClaimDraft {
  return {
    claim_id: deterministicClaimIdForSemanticReview(candidate.review_id),
    claim_type: claimTypeForSemanticChange(candidate),
    claim_text: claimTextForSemanticChange(candidate),
    review_id: candidate.review_id,
    status: "draft",
    evidence_level: 3,
    confidence: candidate.confidence,
    is_inferred: true,
    generated_by: input.generated_by ?? "claim-builder.semantic-change-draft.v1",
    last_verified_at: input.reviewed_at
  };
}

function claimTextForEdge(edge: ClaimableFactEdge): string {
  return CLAIM_TEXT_TEMPLATES[edge.relation](edge, {
    componentObject: componentObjectText(edge.component),
    componentContext: componentContextText(edge.component)
  });
}

function claimTypeForSemanticChange(candidate: SemanticChangeReviewCandidate): ClaimType {
  const changeType = candidate.payload.change_type;
  if (changeType.includes("CUSTOMER")) return "DEMAND_SIGNAL_CLAIM";
  if (changeType.includes("PURCHASE_OBLIGATION") || changeType.includes("CAPACITY_RESERVATION") || changeType.includes("SINGLE_SOURCE_RISK"))
    return "RISK_SIGNAL_CLAIM";
  return "SUPPLY_RELATION_CLAIM";
}

function claimTextForSemanticChange(candidate: SemanticChangeReviewCandidate): string {
  const payload = candidate.payload;
  const component = payload.component ?? payload.component_id;
  const componentText = component === undefined ? "" : ` (${component})`;
  const direction = semanticChangeDirection(payload.change_type);
  return [
    "Reviewed official-disclosure monitoring",
    direction,
    `${payload.semantic_relation_kind}:`,
    `${payload.subject_surface} -${payload.relation}-> ${payload.object_surface}${componentText}.`,
    "This is a draft signal and is not an active fact edge."
  ].join(" ");
}

function semanticChangeDirection(changeType: string): string {
  if (changeType.endsWith("_ADDED")) return "flagged a newly observed candidate";
  if (changeType.endsWith("_REMOVED")) return "flagged a no-longer-observed candidate";
  if (changeType.endsWith("_CHANGED")) return "flagged changed wording for a monitored candidate";
  return "flagged a monitored candidate change";
}

function componentObjectText(component: string | null): string {
  const value = component?.trim();
  if (value === undefined || value.length === 0) return "";
  return ` ${value}`;
}

function componentContextText(component: string | null): string {
  const value = component?.trim();
  if (value === undefined || value.length === 0) return "";
  return ` for ${value}`;
}

function normalizeTimestamp(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}
