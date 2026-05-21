import type { WorkbenchModel } from "./index.js";
import { EDGE_FRESHNESS_DECAY_MODELS, EDGE_STRENGTH_KINDS } from "@supplystrata/core";

export function parseWorkbenchModel(text: string): WorkbenchModel {
  const parsed: unknown = JSON.parse(text);
  normalizeWorkbenchModelJson(parsed);
  assertWorkbenchModel(parsed);
  return parsed;
}

const SEMANTIC_LAYERS = ["edge", "claim", "observation", "lead", "unknown"] as const;
const EDGE_VALIDITIES = ["current", "historical", "deprecated"] as const;
const CLAIM_STATUSES = ["draft", "active", "superseded", "rejected"] as const;
const CLAIM_EVIDENCE_ROLES = ["primary", "supporting", "contradicting", "context"] as const;
const CLAIM_UNKNOWN_ROLES = ["boundary", "blocking", "context"] as const;
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
const CLAIM_TYPES = [
  "SUPPLY_RELATION_CLAIM",
  "FACILITY_RELATION_CLAIM",
  "ENTITY_FACT_CLAIM",
  "COMPONENT_EXPOSURE_CLAIM",
  "DEMAND_SIGNAL_CLAIM",
  "RISK_SIGNAL_CLAIM",
  "UNKNOWN_BOUNDARY_CLAIM"
] as const;
const SOURCE_PLAN_LAYERS = ["edge", "observation", "lead", "entity"] as const;
const SOURCE_RELATION_POLICIES = ["can_create_fact_edge", "observation_only", "lead_only", "entity_only"] as const;
const ATTENTION_KINDS = ["claim_conflict", "claim_lifecycle", "alert", "source_degraded", "change_requires_attention"] as const;
const ATTENTION_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
const ATTENTION_STATUSES = ["open", "acknowledged", "resolved", "suppressed"] as const;

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
  validateIntelligenceContext(value["intelligence"], `${path}.intelligence`, errors);
}

function normalizeWorkbenchModelJson(value: unknown): void {
  if (!isRecord(value)) return;
  // 旧版 Workbench 在 claim draft 落地前没有 draft_claims；契约层统一补为空数组。
  if (value["draft_claims"] === undefined) value["draft_claims"] = [];
  // 旧版 Workbench 没有统一 attention queue；读取端统一补空数组以保持静态 snapshot 可重放。
  if (value["attention_queue"] === undefined) value["attention_queue"] = [];
  // 旧版 Workbench 没有关系强度和新鲜度上下文；前端用空对象维持稳定读取路径。
  if (value["intelligence"] === undefined) value["intelligence"] = { edge_strengths: [], edge_freshness: [] };
  normalizeUnknownArray(value["unknown_items"]);
  normalizeClaimArray(value["claims"]);
  normalizeClaimArray(value["draft_claims"]);
}

function normalizeUnknownArray(value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!isRecord(item)) continue;
    // 旧版静态 Workbench 没有 unknown scope；用 legacy scope 保持快照可重放，新导出必须给出真实 scope。
    if (item["scope_kind"] === undefined) item["scope_kind"] = "legacy";
    if (item["scope_id"] === undefined) item["scope_id"] = stringField(item, "unknown_id", "");
  }
}

function normalizeClaimArray(value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!isRecord(item)) continue;
    // 旧版 Workbench 导出对非 review claim 会省略 review_id；契约层统一补成 null。
    if (item["review_id"] === undefined) item["review_id"] = null;
    if (item["evidence_refs"] === undefined) item["evidence_refs"] = [];
    if (item["unknown_refs"] === undefined) item["unknown_refs"] = [];
    if (item["edge_validity"] === undefined) item["edge_validity"] = null;
    if (item["edge_deprecated_reason"] === undefined) item["edge_deprecated_reason"] = null;
    if (item["edge_superseded_by_edge_id"] === undefined) item["edge_superseded_by_edge_id"] = null;
    if (item["lifecycle_warnings"] === undefined) item["lifecycle_warnings"] = [];
    if (item["conflict_state"] === undefined) item["conflict_state"] = "none";
    if (item["conflict_adjudication"] === undefined) {
      item["conflict_adjudication"] = {
        state: item["conflict_state"],
        severity: "none",
        recommended_action: "none",
        edge_review_required: false,
        allowed_edge_mutation: "none",
        reason_codes: []
      };
    }
    if (item["conflict_review"] === undefined) {
      item["conflict_review"] = legacyClaimConflictReviewPacket(item);
    }
  }
}

function legacyClaimConflictReviewPacket(claim: Record<string, unknown>): Record<string, unknown> {
  const adjudication = isRecord(claim["conflict_adjudication"]) ? claim["conflict_adjudication"] : {};
  const conflictState = stringField(adjudication, "state", stringField(claim, "conflict_state", "none"));
  const severity = stringField(adjudication, "severity", "none");
  const recommendedAction = stringField(adjudication, "recommended_action", "none");
  const edgeReviewRequired = booleanField(adjudication, "edge_review_required", false);
  const reasonCodes = stringArrayField(adjudication, "reason_codes");
  const requiresHumanReview = conflictState === "open_conflict" || conflictState === "contradicting_evidence";

  return {
    claim_id: stringField(claim, "claim_id", ""),
    claim_text: stringField(claim, "claim_text", ""),
    conflict_state: conflictState,
    severity,
    recommended_action: recommendedAction,
    review_queue_kind: requiresHumanReview ? "claim_conflict_review" : "none",
    safe_write_status: legacySafeWriteStatus(conflictState),
    edge_review_required: edgeReviewRequired,
    required_review_steps: [],
    evidence_refs: Array.isArray(claim["evidence_refs"]) ? claim["evidence_refs"] : [],
    unknown_refs: Array.isArray(claim["unknown_refs"]) ? claim["unknown_refs"] : [],
    fact_write_policy: {
      automatic_fact_mutation_allowed: false,
      allowed_edge_mutation: "none",
      requires_human_review: requiresHumanReview,
      reason_codes: reasonCodes
    }
  };
}

function legacySafeWriteStatus(conflictState: string): string {
  if (conflictState === "open_conflict" || conflictState === "contradicting_evidence") return "blocked_pending_review";
  if (conflictState === "resolved_conflict") return "resolved_context_only";
  return "none";
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
  expectEnum(value, "expected_output_layer", SOURCE_PLAN_LAYERS, path, errors);
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
  expectEnum(value, "expected_output_layer", SOURCE_PLAN_LAYERS, path, errors);
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
  expectEnum(value, "kind", ATTENTION_KINDS, path, errors);
  expectEnum(value, "priority", ATTENTION_PRIORITIES, path, errors);
  expectEnum(value, "status", ATTENTION_STATUSES, path, errors);
  expectString(value, "title", path, errors);
  expectString(value, "summary", path, errors);
  expectString(value, "action", path, errors);
  expectString(value, "scope_kind", path, errors);
  expectString(value, "scope_id", path, errors);
  expectStringArray(value, "refs", path, errors);
  expectNullableString(value, "detected_at", path, errors);
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

function expectLiteral(record: Record<string, unknown>, key: string, expected: string, path: string, errors: string[]): void {
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
