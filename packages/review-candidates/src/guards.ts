import { RELATION_TYPES, type RelationType } from "@supplystrata/core";
import type {
  ClaimConflictReviewCandidate,
  ClaimConflictReviewEvidenceRef,
  ClaimConflictReviewFactWritePolicy,
  ClaimConflictReviewRecommendedAction,
  ClaimConflictReviewSeverity,
  ClaimConflictReviewState,
  ClaimConflictReviewStep,
  ClaimConflictReviewUnknownRef,
  EntitySourceReviewCandidate,
  OfficialDisclosureSignalReviewCandidate,
  OshFacilityReviewCandidate,
  ReviewCandidate,
  SemanticChangeReviewCandidate,
  SupplierListReviewCandidate
} from "./definitions.js";

export function isReviewCandidate(value: unknown): value is ReviewCandidate {
  if (!isRecord(value)) return false;
  if (value["kind"] === "supplier_list_row") return isSupplierListReviewCandidatePayload(value);
  if (value["kind"] === "entity_source_candidate") return isEntitySourceReviewCandidatePayload(value);
  if (value["kind"] === "semantic_change") return isSemanticChangeReviewCandidatePayload(value);
  if (value["kind"] === "osh_facility_candidate") return isOshFacilityReviewCandidatePayload(value);
  if (value["kind"] === "claim_conflict_review") return isClaimConflictReviewCandidatePayload(value);
  if (value["kind"] === "official_disclosure_signal") return isOfficialDisclosureSignalReviewCandidatePayload(value);
  return false;
}

export function isSupplierListReviewCandidate(candidate: ReviewCandidate): candidate is SupplierListReviewCandidate {
  return candidate.kind === "supplier_list_row";
}

export function isEntitySourceReviewCandidate(candidate: ReviewCandidate): candidate is EntitySourceReviewCandidate {
  return candidate.kind === "entity_source_candidate";
}

export function isSemanticChangeReviewCandidate(candidate: ReviewCandidate): candidate is SemanticChangeReviewCandidate {
  return candidate.kind === "semantic_change";
}

export function isOshFacilityReviewCandidate(candidate: ReviewCandidate): candidate is OshFacilityReviewCandidate {
  return candidate.kind === "osh_facility_candidate";
}

export function isClaimConflictReviewCandidate(candidate: ReviewCandidate): candidate is ClaimConflictReviewCandidate {
  return candidate.kind === "claim_conflict_review";
}

export function isOfficialDisclosureSignalReviewCandidate(candidate: ReviewCandidate): candidate is OfficialDisclosureSignalReviewCandidate {
  return candidate.kind === "official_disclosure_signal";
}

function isSupplierListReviewCandidatePayload(value: Record<string, unknown>): boolean {
  const payload = value["payload"];
  const evidence = value["evidence"];
  if (!hasCommonReviewFields(value) || !isRecord(payload) || !isReviewEvidenceContext(evidence)) return false;
  return (
    isNonEmptyString(payload["buyer_entity_id"]) &&
    isNonEmptyString(payload["buyer_name"]) &&
    isNonEmptyString(payload["supplier_name"]) &&
    isNonEmptyString(payload["location_text"]) &&
    isNonEmptyString(payload["country_or_region"]) &&
    payload["relation_hint"] === "BUYS_FROM" &&
    payload["facility_relation_hint"] === "MANUFACTURES_AT"
  );
}

function isEntitySourceReviewCandidatePayload(value: Record<string, unknown>): boolean {
  const payload = value["payload"];
  const evidence = value["evidence"];
  if (!hasCommonReviewFields(value) || !isRecord(payload) || !isReviewEvidenceContext(evidence)) return false;
  const proposedAliases = payload["proposed_aliases"];
  const candidate = payload["candidate"];
  return (
    isNonEmptyString(payload["surface"]) &&
    isNonEmptyString(payload["proposed_entity_id"]) &&
    Array.isArray(proposedAliases) &&
    proposedAliases.every(isNonEmptyString) &&
    isRecord(candidate) &&
    isNonEmptyString(candidate["source_adapter_id"]) &&
    isNonEmptyString(candidate["source_url"]) &&
    isNonEmptyString(candidate["external_id"]) &&
    isNonEmptyString(candidate["name"]) &&
    isRecord(candidate["identifiers"]) &&
    isNumber(candidate["confidence"])
  );
}

function isSemanticChangeReviewCandidatePayload(value: Record<string, unknown>): boolean {
  const payload = value["payload"];
  const evidence = value["evidence"];
  if (!hasCommonReviewFields(value) || !isRecord(payload) || !isReviewEvidenceContext(evidence)) return false;
  return (
    isNonEmptyString(payload["change_type"]) &&
    isNonEmptyString(payload["semantic_relation_kind"]) &&
    isNonEmptyString(payload["source_item_id"]) &&
    isNonEmptyString(payload["doc_id"]) &&
    isNonEmptyString(payload["source_adapter_id"]) &&
    isRelationType(payload["relation"]) &&
    isNonEmptyString(payload["subject_surface"]) &&
    isNonEmptyString(payload["object_surface"]) &&
    isNonEmptyString(payload["cite_text"]) &&
    isNonEmptyString(payload["cite_locator"]) &&
    isNonEmptyString(payload["fingerprint"]) &&
    isNonEmptyString(payload["extractor_id"]) &&
    isOptionalString(payload["component_id"]) &&
    isOptionalString(payload["component"]) &&
    isOptionalComponentSpecificity(payload["component_specificity"])
  );
}

function isOshFacilityReviewCandidatePayload(value: Record<string, unknown>): boolean {
  const payload = value["payload"];
  const evidence = value["evidence"];
  if (!hasCommonReviewFields(value) || !isRecord(payload) || !isReviewEvidenceContext(evidence)) return false;
  const candidate = payload["osh_candidate"];
  return (
    isNonEmptyString(payload["source_item_id"]) &&
    isNonEmptyString(payload["observation_id"]) &&
    isNonEmptyString(payload["query"]) &&
    isOptionalString(payload["source_lead_id"]) &&
    isOptionalString(payload["target_scope_id"]) &&
    isOptionalString(payload["source_supplier_name"]) &&
    isOptionalString(payload["source_location_text"]) &&
    isOptionalString(payload["source_country_or_region"]) &&
    isOshFacilityCandidateRecord(candidate)
  );
}

function isClaimConflictReviewCandidatePayload(value: Record<string, unknown>): boolean {
  const payload = value["payload"];
  const evidence = value["evidence"];
  if (!hasCommonReviewFields(value) || !isRecord(payload) || !isReviewEvidenceContext(evidence)) return false;
  return (
    isNonEmptyString(payload["claim_id"]) &&
    isNonEmptyString(payload["claim_text"]) &&
    (payload["edge_id"] === null || isNonEmptyString(payload["edge_id"])) &&
    isClaimConflictReviewState(payload["conflict_state"]) &&
    isClaimConflictReviewSeverity(payload["severity"]) &&
    isClaimConflictReviewRecommendedAction(payload["recommended_action"]) &&
    payload["safe_write_status"] === "blocked_pending_review" &&
    typeof payload["edge_review_required"] === "boolean" &&
    isClaimConflictReviewStepArray(payload["required_review_steps"]) &&
    isClaimConflictReviewEvidenceRefArray(payload["evidence_refs"]) &&
    isClaimConflictReviewUnknownRefArray(payload["unknown_refs"]) &&
    isClaimConflictReviewFactWritePolicy(payload["fact_write_policy"])
  );
}

function isOfficialDisclosureSignalReviewCandidatePayload(value: Record<string, unknown>): boolean {
  const payload = value["payload"];
  const evidence = value["evidence"];
  if (!hasCommonReviewFields(value) || !isRecord(payload) || !isReviewEvidenceContext(evidence)) return false;
  return (
    isNonEmptyString(payload["source_item_id"]) &&
    isNonEmptyString(payload["doc_id"]) &&
    isNonEmptyString(payload["source_adapter_id"]) &&
    isNonEmptyString(payload["signal_title"]) &&
    isNonEmptyString(payload["cite_text"]) &&
    isNonEmptyString(payload["cite_locator"]) &&
    (payload["evidence_level_hint"] === 4 || payload["evidence_level_hint"] === 5) &&
    isClaimConflictReviewFactWritePolicy(payload["fact_write_policy"])
  );
}

function isClaimConflictReviewState(value: unknown): value is ClaimConflictReviewState {
  return value === "open_conflict" || value === "contradicting_evidence";
}

function isClaimConflictReviewSeverity(value: unknown): value is ClaimConflictReviewSeverity {
  return value === "medium" || value === "high";
}

function isClaimConflictReviewRecommendedAction(value: unknown): value is ClaimConflictReviewRecommendedAction {
  return value === "review_claim" || value === "review_edge_for_deprecation" || value === "collect_resolution_evidence";
}

function isClaimConflictReviewStepArray(value: unknown): value is ClaimConflictReviewStep[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (item) =>
      item === "inspect_supporting_evidence" ||
      item === "inspect_contradicting_evidence" ||
      item === "resolve_conflict_unknown" ||
      item === "review_claim_scope" ||
      item === "review_fact_edge_for_deprecation"
  );
}

function isClaimConflictReviewEvidenceRefArray(value: unknown): value is ClaimConflictReviewEvidenceRef[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (!isRecord(item)) return false;
    return (
      isNonEmptyString(item["evidence_id"]) &&
      (item["role"] === "primary" || item["role"] === "supporting" || item["role"] === "contradicting" || item["role"] === "context")
    );
  });
}

function isClaimConflictReviewUnknownRefArray(value: unknown): value is ClaimConflictReviewUnknownRef[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (!isRecord(item)) return false;
    return (
      isNonEmptyString(item["unknown_id"]) &&
      (item["role"] === "boundary" || item["role"] === "blocking" || item["role"] === "context") &&
      isNonEmptyString(item["status"])
    );
  });
}

function isClaimConflictReviewFactWritePolicy(value: unknown): value is ClaimConflictReviewFactWritePolicy {
  if (!isRecord(value)) return false;
  return (
    value["automatic_fact_mutation_allowed"] === false &&
    value["allowed_edge_mutation"] === "none" &&
    value["requires_human_review"] === true &&
    isStringArray(value["reason_codes"])
  );
}

function isOshFacilityCandidateRecord(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const contributors = value["contributors"];
  return (
    isNonEmptyString(value["os_id"]) &&
    isNonEmptyString(value["name"]) &&
    isOptionalString(value["address"]) &&
    isOptionalString(value["country_code"]) &&
    isOptionalString(value["country_name"]) &&
    isOptionalNumber(value["latitude"]) &&
    isOptionalNumber(value["longitude"]) &&
    Array.isArray(contributors) &&
    contributors.every(isNonEmptyString) &&
    isOptionalString(value["sector"]) &&
    isOptionalString(value["product_type"]) &&
    isNonEmptyString(value["source_url"])
  );
}

function hasCommonReviewFields(value: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(value["review_id"]) &&
    isNonEmptyString(value["candidate_key"]) &&
    isNonEmptyString(value["title"]) &&
    isNumber(value["confidence"]) &&
    value["needs_review"] === true &&
    isNonEmptyString(value["review_reason"])
  );
}

function isReviewEvidenceContext(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isOptionalString(value["doc_id"]) &&
    isNonEmptyString(value["source_url"]) &&
    isOptionalString(value["source_date"]) &&
    isNonEmptyString(value["source_adapter_id"]) &&
    isNonEmptyString(value["source_locator"]) &&
    isNonEmptyString(value["source_row_text"]) &&
    isNonEmptyString(value["normalized_record_text"])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || isNumber(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRelationType(value: unknown): value is RelationType {
  return typeof value === "string" && (RELATION_TYPES as readonly string[]).includes(value);
}

function isOptionalComponentSpecificity(value: unknown): boolean {
  return value === undefined || value === "explicit" || value === "inferred" || value === "unspecified";
}
