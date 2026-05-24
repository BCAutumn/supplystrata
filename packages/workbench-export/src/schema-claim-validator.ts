import {
  CLAIM_CONFLICT_ADJUDICATION_SEVERITIES,
  CLAIM_CONFLICT_ADJUDICATION_STATES,
  CLAIM_CONFLICT_RECOMMENDED_ACTIONS,
  CLAIM_CONFLICT_REVIEW_QUEUE_KINDS,
  CLAIM_CONFLICT_REVIEW_STEPS,
  CLAIM_CONFLICT_SAFE_WRITE_STATUSES
} from "@supplystrata/claim-builder";
import { CLAIM_EVIDENCE_ROLES, CLAIM_STATUSES, CLAIM_TYPES, CLAIM_UNKNOWN_ROLES, EDGE_VALIDITIES } from "@supplystrata/core";
import {
  expectBoolean,
  expectEnum,
  expectEnumArray,
  expectEvidenceLevel,
  expectLiteral,
  expectNullableEnum,
  expectNullableString,
  expectNumber,
  expectString,
  expectStringArray,
  isRecordAt,
  validateArrayField
} from "./schema-validation-primitives.js";

export function validateClaim(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectString(value, "claim_id", path, errors);
  expectEnum(value, "claim_type", CLAIM_TYPES, path, errors);
  expectString(value, "claim_text", path, errors);
  expectNullableString(value, "subject_id", path, errors);
  expectNullableString(value, "object_id", path, errors);
  expectNullableString(value, "component_id", path, errors);
  expectNullableString(value, "edge_id", path, errors);
  expectNullableEnum(value, "edge_validity", EDGE_VALIDITIES, path, errors);
  expectNullableString(value, "edge_deprecated_reason", path, errors);
  expectNullableString(value, "edge_superseded_by_edge_id", path, errors);
  expectNullableString(value, "review_id", path, errors);
  expectEnum(value, "status", CLAIM_STATUSES, path, errors);
  expectEvidenceLevel(value, "evidence_level", path, errors);
  expectNumber(value, "confidence", path, errors);
  expectBoolean(value, "is_inferred", path, errors);
  expectString(value, "generated_by", path, errors);
  expectString(value, "last_verified_at", path, errors);
  expectString(value, "created_at", path, errors);
  expectString(value, "updated_at", path, errors);
  validateArrayField(value, "evidence_refs", path, errors, validateClaimEvidenceRef);
  validateArrayField(value, "unknown_refs", path, errors, validateClaimUnknownRef);
  expectEnum(value, "conflict_state", CLAIM_CONFLICT_ADJUDICATION_STATES, path, errors);
  validateClaimConflictAdjudication(value["conflict_adjudication"], `${path}.conflict_adjudication`, errors);
  validateClaimConflictReview(value["conflict_review"], `${path}.conflict_review`, errors);
  validateArrayField(value, "lifecycle_warnings", path, errors, validateClaimLifecycleWarning);
}

function validateClaimLifecycleWarning(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectLiteral(value, "code", "active_claim_on_inactive_edge", path, errors);
  expectLiteral(value, "severity", "warn", path, errors);
  expectString(value, "message", path, errors);
}

function validateClaimEvidenceRef(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectString(value, "evidence_id", path, errors);
  expectEnum(value, "role", CLAIM_EVIDENCE_ROLES, path, errors);
}

function validateClaimUnknownRef(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectString(value, "unknown_id", path, errors);
  expectEnum(value, "role", CLAIM_UNKNOWN_ROLES, path, errors);
  expectString(value, "status", path, errors);
}

function validateClaimConflictAdjudication(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectEnum(value, "state", CLAIM_CONFLICT_ADJUDICATION_STATES, path, errors);
  expectEnum(value, "severity", CLAIM_CONFLICT_ADJUDICATION_SEVERITIES, path, errors);
  expectEnum(value, "recommended_action", CLAIM_CONFLICT_RECOMMENDED_ACTIONS, path, errors);
  expectBoolean(value, "edge_review_required", path, errors);
  expectLiteral(value, "allowed_edge_mutation", "none", path, errors);
  expectStringArray(value, "reason_codes", path, errors);
}

function validateClaimConflictReview(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectString(value, "claim_id", path, errors);
  expectString(value, "claim_text", path, errors);
  expectEnum(value, "conflict_state", CLAIM_CONFLICT_ADJUDICATION_STATES, path, errors);
  expectEnum(value, "severity", CLAIM_CONFLICT_ADJUDICATION_SEVERITIES, path, errors);
  expectEnum(value, "recommended_action", CLAIM_CONFLICT_RECOMMENDED_ACTIONS, path, errors);
  expectEnum(value, "review_queue_kind", CLAIM_CONFLICT_REVIEW_QUEUE_KINDS, path, errors);
  expectEnum(value, "safe_write_status", CLAIM_CONFLICT_SAFE_WRITE_STATUSES, path, errors);
  expectBoolean(value, "edge_review_required", path, errors);
  expectEnumArray(value, "required_review_steps", CLAIM_CONFLICT_REVIEW_STEPS, path, errors);
  validateArrayField(value, "evidence_refs", path, errors, validateClaimEvidenceRef);
  validateArrayField(value, "unknown_refs", path, errors, validateClaimUnknownRef);
  validateClaimConflictFactWritePolicy(value["fact_write_policy"], `${path}.fact_write_policy`, errors);
}

function validateClaimConflictFactWritePolicy(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  if (value["automatic_fact_mutation_allowed"] !== false) errors.push(`${path}.automatic_fact_mutation_allowed must equal false`);
  expectLiteral(value, "allowed_edge_mutation", "none", path, errors);
  expectBoolean(value, "requires_human_review", path, errors);
  expectStringArray(value, "reason_codes", path, errors);
}
