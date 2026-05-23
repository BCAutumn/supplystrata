import { WORKBENCH_ATTENTION_KINDS, WORKBENCH_ATTENTION_PRIORITIES, WORKBENCH_ATTENTION_STATUSES, type WorkbenchModel } from "./definitions.js";
import {
  CLAIM_EVIDENCE_ROLES,
  CLAIM_STATUSES,
  CLAIM_TYPES,
  CLAIM_UNKNOWN_ROLES,
  EDGE_FRESHNESS_DECAY_MODELS,
  EDGE_STRENGTH_KINDS,
  EDGE_VALIDITIES,
  SEMANTIC_LAYERS
} from "@supplystrata/core";
import { PLANNED_OUTPUT_LAYERS, SOURCE_RELATION_POLICIES } from "@supplystrata/source-plan";
import { normalizeWorkbenchModelJson } from "./schema-normalize.js";

export function parseWorkbenchModel(text: string): WorkbenchModel {
  const parsed: unknown = JSON.parse(text);
  const normalized = normalizeWorkbenchModelJson(parsed);
  assertWorkbenchModel(normalized);
  return normalized;
}

const CLAIM_CONFLICT_STATES = ["none", "open_conflict", "contradicting_evidence", "resolved_conflict"] as const;
const CLAIM_CONFLICT_SEVERITIES = ["none", "low", "medium", "high"] as const;
const CLAIM_CONFLICT_RECOMMENDED_ACTIONS = [
  "none",
  "review_claim",
  "review_edge_for_deprecation",
  "collect_resolution_evidence",
  "keep_resolved_context"
] as const;
const CLAIM_CONFLICT_REVIEW_QUEUE_KINDS = ["none", "claim_conflict_review"] as const;
const CLAIM_CONFLICT_SAFE_WRITE_STATUSES = ["none", "blocked_pending_review", "resolved_context_only"] as const;
const CLAIM_CONFLICT_REVIEW_STEPS = [
  "inspect_supporting_evidence",
  "inspect_contradicting_evidence",
  "resolve_conflict_unknown",
  "review_claim_scope",
  "review_fact_edge_for_deprecation",
  "record_resolution_context"
] as const;
const REVIEW_CANDIDATE_STATUSES = ["pending", "in_review", "approved", "rejected", "blocked", "applied"] as const;
const OFFICIAL_SIGNAL_DISPOSITION_DECISIONS = [
  "supports_existing_edge",
  "needs_more_evidence",
  "not_relevant",
  "record_single_source_unknown",
  "create_counterparty_source_target"
] as const;

function assertWorkbenchModel(value: unknown): asserts value is WorkbenchModel {
  const errors: string[] = [];
  validateWorkbenchModel(value, "$", errors);
  if (errors.length > 0) {
    throw new Error(`JSON is not a SupplyStrata WorkbenchModel export: ${errors.slice(0, 8).join("; ")}`);
  }
}

function validateWorkbenchModel(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectLiteral(value, "schema_version", "1.0.0", path, errors);
  expectString(value, "generated_at", path, errors);
  expectString(value, "selected_company_id", path, errors);
  validateArrayField(value, "companies", path, errors, validateCompany);
  validateChain(value["chain"], `${path}.chain`, errors);
  validateArrayField(value, "chain_segments", path, errors, validateSegment);
  validateArrayField(value, "edges", path, errors, validateEdge);
  validateArrayField(value, "upstream_edges", path, errors, validateEdge);
  validateArrayField(value, "downstream_edges", path, errors, validateEdge);
  validateArrayField(value, "claims", path, errors, validateClaim);
  validateArrayField(value, "draft_claims", path, errors, validateClaim);
  validateArrayField(value, "evidences", path, errors, validateEvidence);
  validateArrayField(value, "unknown_items", path, errors, validateUnknownItem);
  validateArrayField(value, "sources", path, errors, validateSourceHealth);
  validateArrayField(value, "source_plan", path, errors, validateSourcePlanItem);
  validateArrayField(value, "changes", path, errors, validateChange);
  validateArrayField(value, "attention_queue", path, errors, validateAttentionItem);
  validateArrayField(value, "review_queue", path, errors, validateReviewCandidate);
  validateIntelligenceContext(value["intelligence"], `${path}.intelligence`, errors);
}

function validateCompany(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectString(value, "entity_id", path, errors);
  expectString(value, "name", path, errors);
  expectEnum(value, "role", ["root", "counterparty"], path, errors);
}

function validateChain(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectLiteral(value, "schema_version", "1.0.0", path, errors);
  expectLiteral(value, "view_type", "company_chain", path, errors);
  validateEndpoint(value["root"], `${path}.root`, errors);
  expectNumber(value, "max_depth", path, errors);
  expectString(value, "generated_by", path, errors);
  validateArrayField(value, "segments", path, errors, validateSegment);
  validateStats(value["stats"], `${path}.stats`, errors);
}

function validateEndpoint(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectString(value, "kind", path, errors);
  expectString(value, "id", path, errors);
  expectString(value, "name", path, errors);
}

function validateSegment(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectNumber(value, "sequence_index", path, errors);
  expectNumber(value, "depth", path, errors);
  expectEnum(value, "semantic_layer", SEMANTIC_LAYERS, path, errors);
  validateEndpoint(value["from"], `${path}.from`, errors);
  validateEndpoint(value["to"], `${path}.to`, errors);
  expectString(value, "relation", path, errors);
  expectNullableString(value, "component", path, errors);
  expectNullableString(value, "component_id", path, errors);
  expectStringArray(value, "evidence_ids", path, errors);
  expectNumber(value, "confidence", path, errors);
  expectString(value, "label", path, errors);

  if (value["semantic_layer"] === "edge") {
    expectString(value, "edge_id", path, errors);
    expectEvidenceLevel(value, "evidence_level", path, errors);
  }
  if (value["source_hints"] !== undefined) {
    validateArrayField(value, "source_hints", path, errors, validateSourceHint);
  }
}

function validateSourceHint(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectString(value, "source_id", path, errors);
  expectString(value, "source_name", path, errors);
  expectEnum(value, "expected_output_layer", PLANNED_OUTPUT_LAYERS, path, errors);
  expectEnum(value, "relation_policy", SOURCE_RELATION_POLICIES, path, errors);
  expectBoolean(value, "requires_key", path, errors);
  expectString(value, "status", path, errors);
  expectStringArray(value, "reasons", path, errors);
}

function validateStats(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectNumber(value, "fact_edges", path, errors);
  expectNumber(value, "claims", path, errors);
  expectNumber(value, "observations", path, errors);
  expectNumber(value, "leads", path, errors);
  expectNumber(value, "unknowns", path, errors);
}

function validateEdge(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectString(value, "edge_id", path, errors);
  expectString(value, "from_id", path, errors);
  expectString(value, "from_name", path, errors);
  expectString(value, "to_id", path, errors);
  expectString(value, "to_name", path, errors);
  expectString(value, "relation", path, errors);
  expectNullableString(value, "component", path, errors);
  expectNullableString(value, "component_id", path, errors);
  expectEvidenceLevel(value, "evidence_level", path, errors);
  expectNumber(value, "confidence", path, errors);
  expectStringArray(value, "evidence_ids", path, errors);
}

function validateClaim(value: unknown, path: string, errors: string[]): void {
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
  expectEnum(value, "conflict_state", CLAIM_CONFLICT_STATES, path, errors);
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
  expectEnum(value, "state", CLAIM_CONFLICT_STATES, path, errors);
  expectEnum(value, "severity", CLAIM_CONFLICT_SEVERITIES, path, errors);
  expectEnum(value, "recommended_action", CLAIM_CONFLICT_RECOMMENDED_ACTIONS, path, errors);
  expectBoolean(value, "edge_review_required", path, errors);
  expectLiteral(value, "allowed_edge_mutation", "none", path, errors);
  expectStringArray(value, "reason_codes", path, errors);
}

function validateClaimConflictReview(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectString(value, "claim_id", path, errors);
  expectString(value, "claim_text", path, errors);
  expectEnum(value, "conflict_state", CLAIM_CONFLICT_STATES, path, errors);
  expectEnum(value, "severity", CLAIM_CONFLICT_SEVERITIES, path, errors);
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

function validateEvidence(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectString(value, "evidence_id", path, errors);
  expectNullableString(value, "edge_id", path, errors);
  expectNullableString(value, "superseded_by", path, errors);
  expectString(value, "cite_text", path, errors);
  expectNullableString(value, "cite_locator", path, errors);
  expectNullableNumber(value, "cite_start_char", path, errors);
  expectNullableNumber(value, "cite_end_char", path, errors);
  expectNullableString(value, "cite_text_sha256", path, errors);
  expectNullableString(value, "normalized_cite_text_sha256", path, errors);
  expectNullableString(value, "source_snapshot_sha256", path, errors);
  expectNullableString(value, "parser_version", path, errors);
  expectNullableString(value, "extractor_version", path, errors);
  expectNullableString(value, "relation_candidate_hash", path, errors);
  expectEvidenceLevel(value, "evidence_level", path, errors);
  expectNumber(value, "confidence", path, errors);
  expectBoolean(value, "is_inferred", path, errors);
  expectString(value, "extraction_method", path, errors);
  expectString(value, "source_url", path, errors);
  expectNullableString(value, "source_date", path, errors);
  expectString(value, "fetched_at", path, errors);
  expectString(value, "source_adapter_id", path, errors);
  expectString(value, "document_type", path, errors);
  expectNullableString(value, "subject_name", path, errors);
  expectNullableString(value, "object_name", path, errors);
  expectNullableString(value, "relation", path, errors);
}

function validateUnknownItem(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectString(value, "unknown_id", path, errors);
  expectString(value, "scope_kind", path, errors);
  expectString(value, "scope_id", path, errors);
  expectString(value, "question", path, errors);
  expectString(value, "why_unknown", path, errors);
  expectStringArray(value, "blocking_data_sources", path, errors);
  expectStringArray(value, "proxies", path, errors);
  expectString(value, "status", path, errors);
}

function validateSourceHealth(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  for (const key of ["source_adapter_id", "tier", "category", "registry_status", "automation", "tos_url", "official_url"] as const) {
    expectString(value, key, path, errors);
  }
  expectBoolean(value, "requires_key", path, errors);
  for (const key of [
    "last_checked_at",
    "last_success_at",
    "last_failure_at",
    "last_change_at",
    "last_error_message",
    "policy_config_source",
    "policy_notes"
  ] as const) {
    expectNullableString(value, key, path, errors);
  }
  expectNumber(value, "failure_count", path, errors);
  expectNullableBoolean(value, "policy_enabled", path, errors);
  for (const key of ["check_cadence_minutes", "jitter_minutes", "priority"] as const) {
    expectNullableNumber(value, key, path, errors);
  }
  expectNullableString(value, "next_check_at", path, errors);
}

function validateSourcePlanItem(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectString(value, "source_id", path, errors);
  expectString(value, "source_name", path, errors);
  expectString(value, "purpose", path, errors);
  expectString(value, "priority", path, errors);
  expectString(value, "status", path, errors);
  expectString(value, "automation", path, errors);
  expectBoolean(value, "requires_key", path, errors);
  expectEnum(value, "expected_output_layer", PLANNED_OUTPUT_LAYERS, path, errors);
  expectEnum(value, "relation_policy", SOURCE_RELATION_POLICIES, path, errors);
  expectStringArray(value, "parent_component_ids", path, errors);
  expectStringArray(value, "target_ids", path, errors);
  expectStringArray(value, "trigger_dependency_ids", path, errors);
  expectStringArray(value, "reasons", path, errors);
}

function validateChange(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectString(value, "event_id", path, errors);
  expectString(value, "event_family", path, errors);
  expectString(value, "event_type", path, errors);
  expectString(value, "occurred_at", path, errors);
  expectString(value, "caused_by", path, errors);
  expectBoolean(value, "requires_attention", path, errors);
}

function validateAttentionItem(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectString(value, "attention_id", path, errors);
  expectEnum(value, "kind", WORKBENCH_ATTENTION_KINDS, path, errors);
  expectEnum(value, "priority", WORKBENCH_ATTENTION_PRIORITIES, path, errors);
  expectEnum(value, "status", WORKBENCH_ATTENTION_STATUSES, path, errors);
  expectString(value, "title", path, errors);
  expectString(value, "summary", path, errors);
  expectString(value, "action", path, errors);
  expectString(value, "scope_kind", path, errors);
  expectString(value, "scope_id", path, errors);
  expectStringArray(value, "refs", path, errors);
  expectNullableString(value, "detected_at", path, errors);
}

function validateReviewCandidate(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectString(value, "review_id", path, errors);
  expectString(value, "kind", path, errors);
  expectEnum(value, "status", REVIEW_CANDIDATE_STATUSES, path, errors);
  expectString(value, "title", path, errors);
  expectNumber(value, "confidence", path, errors);
  expectString(value, "source_adapter_id", path, errors);
  expectNullableString(value, "doc_id", path, errors);
  expectString(value, "source_url", path, errors);
  expectString(value, "source_locator", path, errors);
  expectString(value, "source_row_text", path, errors);
  expectString(value, "created_at", path, errors);
  expectNullableString(value, "reviewed_at", path, errors);
  expectNullableString(value, "decision_reason", path, errors);
  validateArrayField(value, "dispositions", path, errors, validateOfficialSignalDisposition);
  const signal = value["signal"];
  if (signal !== null) validateReviewCandidateSignal(signal, `${path}.signal`, errors);
}

function validateReviewCandidateSignal(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectString(value, "signal_title", path, errors);
  expectNumber(value, "evidence_level_hint", path, errors);
  expectBoolean(value, "automatic_fact_mutation_allowed", path, errors);
}

function validateOfficialSignalDisposition(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectString(value, "change_id", path, errors);
  expectString(value, "review_id", path, errors);
  expectString(value, "edge_id", path, errors);
  expectEnum(value, "decision", OFFICIAL_SIGNAL_DISPOSITION_DECISIONS, path, errors);
  expectString(value, "reviewer", path, errors);
  expectString(value, "reason", path, errors);
  expectString(value, "source_adapter_id", path, errors);
  expectNullableString(value, "doc_id", path, errors);
  expectString(value, "signal_title", path, errors);
  expectNullableString(value, "evidence_id", path, errors);
  expectNullableString(value, "unknown_id", path, errors);
  expectNullableString(value, "check_target_id", path, errors);
  expectString(value, "recorded_at", path, errors);
  const policy = value["fact_write_policy"];
  if (!isRecordAt(policy, `${path}.fact_write_policy`, errors)) return;
  expectLiteral(policy, "automatic_fact_mutation_allowed", false, `${path}.fact_write_policy`, errors);
  expectLiteral(policy, "allowed_edge_mutation", "none", `${path}.fact_write_policy`, errors);
  expectLiteral(policy, "requires_human_review", true, `${path}.fact_write_policy`, errors);
}

function validateIntelligenceContext(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  validateArrayField(value, "edge_strengths", path, errors, validateEdgeStrength);
  validateArrayField(value, "edge_freshness", path, errors, validateEdgeFreshness);
}

function validateEdgeStrength(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectString(value, "strength_id", path, errors);
  expectString(value, "edge_id", path, errors);
  expectEnum(value, "strength_kind", EDGE_STRENGTH_KINDS, path, errors);
  expectNullableString(value, "value", path, errors);
  expectNullableString(value, "lower_bound", path, errors);
  expectNullableString(value, "upper_bound", path, errors);
  expectNullableString(value, "unit", path, errors);
  expectNullableString(value, "evidence_id", path, errors);
  expectString(value, "method", path, errors);
  expectNullableString(value, "valid_from", path, errors);
  expectNullableString(value, "valid_to", path, errors);
}

function validateEdgeFreshness(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  expectString(value, "edge_id", path, errors);
  expectString(value, "last_verified_at", path, errors);
  expectEnum(value, "decay_model", EDGE_FRESHNESS_DECAY_MODELS, path, errors);
  expectNumber(value, "age_days", path, errors);
  expectNumber(value, "freshness_score", path, errors);
  expectString(value, "computed_at", path, errors);
  expectNullableString(value, "source_evidence_id", path, errors);
}

function validateArrayField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[],
  validateItem: (value: unknown, path: string, errors: string[]) => void
): void {
  const value = record[key];
  if (!Array.isArray(value)) {
    errors.push(`${path}.${key} must be an array`);
    return;
  }
  value.forEach((item, index) => validateItem(item, `${path}.${key}[${index}]`, errors));
}

function expectLiteral(record: Record<string, unknown>, key: string, expected: string | boolean, path: string, errors: string[]): void {
  if (record[key] !== expected) errors.push(`${path}.${key} must equal ${expected}`);
}

function expectEnum(record: Record<string, unknown>, key: string, values: readonly string[], path: string, errors: string[]): void {
  const value = record[key];
  if (typeof value !== "string" || !values.includes(value)) errors.push(`${path}.${key} must be one of ${values.join(", ")}`);
}

function expectNullableEnum(record: Record<string, unknown>, key: string, values: readonly string[], path: string, errors: string[]): void {
  const value = record[key];
  if (value !== null && (typeof value !== "string" || !values.includes(value))) errors.push(`${path}.${key} must be one of ${values.join(", ")} or null`);
}

function expectString(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  if (typeof record[key] !== "string") errors.push(`${path}.${key} must be a string`);
}

function expectNullableString(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  const value = record[key];
  if (value !== null && typeof value !== "string") errors.push(`${path}.${key} must be a string or null`);
}

function expectStringArray(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) errors.push(`${path}.${key} must be a string array`);
}

function expectEnumArray(record: Record<string, unknown>, key: string, values: readonly string[], path: string, errors: string[]): void {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && values.includes(item))) {
    errors.push(`${path}.${key} must only include ${values.join(", ")}`);
  }
}

function expectNumber(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  if (typeof record[key] !== "number" || !Number.isFinite(record[key])) errors.push(`${path}.${key} must be a finite number`);
}

function expectNullableNumber(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  const value = record[key];
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) errors.push(`${path}.${key} must be a finite number or null`);
}

function expectEvidenceLevel(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  const value = record[key];
  if (value !== 1 && value !== 2 && value !== 3 && value !== 4 && value !== 5) errors.push(`${path}.${key} must be an evidence level from 1 to 5`);
}

function expectBoolean(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  if (typeof record[key] !== "boolean") errors.push(`${path}.${key} must be a boolean`);
}

function expectNullableBoolean(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  const value = record[key];
  if (value !== null && typeof value !== "boolean") errors.push(`${path}.${key} must be a boolean or null`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordAt(value: unknown, path: string, errors: string[]): value is Record<string, unknown> {
  if (isRecord(value)) return true;
  errors.push(`${path} must be an object`);
  return false;
}

function stringField(record: Record<string, unknown>, key: string, fallback: string): string {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
}

function booleanField(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
