import type { CandidateRelation, ClaimEvidenceRole, ClaimUnknownRole, RelationType } from "@supplystrata/core";
import type { EntitySourceCandidate } from "@supplystrata/entity-source";

export type ReviewCandidateKind = ReviewCandidate["kind"];
export type ReviewCandidateStatus = "pending" | "in_review" | "approved" | "rejected" | "blocked" | "applied";

export interface ReviewEvidenceContext {
  doc_id?: string;
  source_url: string;
  source_date?: string;
  source_adapter_id: string;
  source_locator: string;
  source_row_text: string;
  normalized_record_text: string;
}

export interface SupplierListReviewPayload {
  buyer_entity_id: string;
  buyer_name: string;
  supplier_name: string;
  location_text: string;
  country_or_region: string;
  relation_hint: Extract<RelationType, "BUYS_FROM">;
  facility_relation_hint: Extract<RelationType, "MANUFACTURES_AT">;
}

export interface SupplierListReviewCandidate {
  review_id: string;
  candidate_key: string;
  kind: "supplier_list_row";
  title: string;
  payload: SupplierListReviewPayload;
  evidence: ReviewEvidenceContext;
  confidence: number;
  needs_review: true;
  review_reason: string;
}

export interface EntitySourceReviewPayload {
  surface: string;
  proposed_entity_id: string;
  proposed_aliases: string[];
  candidate: EntitySourceCandidate;
}

export interface EntitySourceReviewCandidate {
  review_id: string;
  candidate_key: string;
  kind: "entity_source_candidate";
  title: string;
  payload: EntitySourceReviewPayload;
  evidence: ReviewEvidenceContext;
  confidence: number;
  needs_review: true;
  review_reason: string;
}

export interface SemanticChangeReviewPayload {
  change_type: string;
  semantic_relation_kind: string;
  source_item_id: string;
  doc_id: string;
  source_adapter_id: string;
  relation: RelationType;
  subject_surface: string;
  object_surface: string;
  cite_text: string;
  cite_locator: string;
  fingerprint: string;
  extractor_id: string;
  component_id?: string;
  component?: string;
  component_specificity?: CandidateRelation["component_specificity"];
}

export interface SemanticChangeReviewPayloadSnapshot {
  doc_id: string;
  source_adapter_id: string;
  relation: RelationType;
  semantic_relation_kind: string;
  subject_surface: string;
  object_surface: string;
  cite_text: string;
  cite_locator: string;
  fingerprint: string;
  extractor_id: string;
  component_id?: string;
  component?: string;
  component_specificity?: CandidateRelation["component_specificity"];
}

export interface SemanticChangeReviewCandidate {
  review_id: string;
  candidate_key: string;
  kind: "semantic_change";
  title: string;
  payload: SemanticChangeReviewPayload;
  evidence: ReviewEvidenceContext;
  confidence: number;
  needs_review: true;
  review_reason: string;
}

export interface OshFacilityCandidateSnapshot {
  os_id: string;
  name: string;
  address?: string;
  country_code?: string;
  country_name?: string;
  latitude?: number;
  longitude?: number;
  contributors: string[];
  sector?: string;
  product_type?: string;
  source_url: string;
}

export interface OshFacilityReviewPayload {
  source_item_id: string;
  observation_id: string;
  query: string;
  osh_candidate: OshFacilityCandidateSnapshot;
  source_lead_id?: string;
  target_scope_id?: string;
  source_supplier_name?: string;
  source_location_text?: string;
  source_country_or_region?: string;
}

export interface OshFacilityReviewCandidate {
  review_id: string;
  candidate_key: string;
  kind: "osh_facility_candidate";
  title: string;
  payload: OshFacilityReviewPayload;
  evidence: ReviewEvidenceContext;
  confidence: number;
  needs_review: true;
  review_reason: string;
}

export type ClaimConflictReviewState = "open_conflict" | "contradicting_evidence";
export type ClaimConflictReviewSeverity = "medium" | "high";
export type ClaimConflictReviewRecommendedAction = "review_claim" | "review_edge_for_deprecation" | "collect_resolution_evidence";
export type ClaimConflictReviewSafeWriteStatus = "blocked_pending_review";
export type ClaimConflictReviewStep =
  | "inspect_supporting_evidence"
  | "inspect_contradicting_evidence"
  | "resolve_conflict_unknown"
  | "review_claim_scope"
  | "review_fact_edge_for_deprecation";

export interface ClaimConflictReviewEvidenceRef {
  evidence_id: string;
  role: ClaimEvidenceRole;
}

export interface ClaimConflictReviewUnknownRef {
  unknown_id: string;
  role: ClaimUnknownRole;
  status: string;
}

export interface ClaimConflictReviewFactWritePolicy {
  automatic_fact_mutation_allowed: false;
  allowed_edge_mutation: "none";
  requires_human_review: true;
  reason_codes: string[];
}

export interface ClaimConflictReviewPayload {
  claim_id: string;
  claim_text: string;
  edge_id: string | null;
  conflict_state: ClaimConflictReviewState;
  severity: ClaimConflictReviewSeverity;
  recommended_action: ClaimConflictReviewRecommendedAction;
  safe_write_status: ClaimConflictReviewSafeWriteStatus;
  edge_review_required: boolean;
  required_review_steps: ClaimConflictReviewStep[];
  evidence_refs: ClaimConflictReviewEvidenceRef[];
  unknown_refs: ClaimConflictReviewUnknownRef[];
  fact_write_policy: ClaimConflictReviewFactWritePolicy;
}

export interface ClaimConflictReviewCandidate {
  review_id: string;
  candidate_key: string;
  kind: "claim_conflict_review";
  title: string;
  payload: ClaimConflictReviewPayload;
  evidence: ReviewEvidenceContext;
  confidence: number;
  needs_review: true;
  review_reason: string;
}

export interface OfficialDisclosureSignalReviewInput {
  title: string;
  cite_text: string;
  evidence_level: 4 | 5;
  confidence: number;
}

export interface OfficialDisclosureSignalReviewPayload {
  source_item_id: string;
  doc_id: string;
  source_adapter_id: string;
  signal_title: string;
  cite_text: string;
  cite_locator: string;
  evidence_level_hint: OfficialDisclosureSignalReviewInput["evidence_level"];
  fact_write_policy: ClaimConflictReviewFactWritePolicy;
}

export interface OfficialDisclosureSignalReviewCandidate {
  review_id: string;
  candidate_key: string;
  kind: "official_disclosure_signal";
  title: string;
  payload: OfficialDisclosureSignalReviewPayload;
  evidence: ReviewEvidenceContext;
  confidence: number;
  needs_review: true;
  review_reason: string;
}

export type ReviewCandidate =
  | SupplierListReviewCandidate
  | EntitySourceReviewCandidate
  | SemanticChangeReviewCandidate
  | OshFacilityReviewCandidate
  | ClaimConflictReviewCandidate
  | OfficialDisclosureSignalReviewCandidate;
