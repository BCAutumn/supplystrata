import type { EdgeFreshnessRecord, EdgeStrengthEstimateRecord } from "@supplystrata/core";
import type { EvidenceDtoSource, SourceHealthDtoSource, UnknownDtoSource } from "./dto-source-records.js";
import type { WorkbenchEdgeFreshness, WorkbenchEdgeStrength, WorkbenchEvidence, WorkbenchSourceHealth, WorkbenchUnknownItem } from "./definitions.js";

export function evidenceToDto(row: EvidenceDtoSource): WorkbenchEvidence {
  return {
    evidence_id: row.evidence_id,
    edge_id: row.edge_id,
    superseded_by: row.superseded_by,
    cite_text: row.cite_text,
    cite_locator: row.cite_locator,
    cite_start_char: row.cite_start_char,
    cite_end_char: row.cite_end_char,
    cite_text_sha256: row.cite_text_sha256,
    normalized_cite_text_sha256: row.normalized_cite_text_sha256,
    source_snapshot_sha256: row.source_snapshot_sha256,
    parser_version: row.parser_version,
    extractor_version: row.extractor_version,
    relation_candidate_hash: row.relation_candidate_hash,
    evidence_level: row.evidence_level,
    confidence: row.confidence,
    is_inferred: row.is_inferred,
    extraction_method: row.extraction_method,
    source_url: row.source_url,
    source_date: row.source_date === null ? null : toDateOnly(row.source_date),
    fetched_at: toIsoString(row.fetched_at),
    source_adapter_id: row.source_adapter_id,
    document_type: row.document_type,
    subject_name: row.subject_name,
    object_name: row.object_name,
    relation: row.relation
  };
}

export function unknownItemToDto(row: UnknownDtoSource): WorkbenchUnknownItem {
  return {
    unknown_id: row.unknown_id,
    scope_kind: row.scope_kind,
    scope_id: row.scope_id,
    question: row.question,
    why_unknown: row.why_unknown,
    blocking_data_sources: row.blocking_data_sources,
    proxies: row.proxies,
    status: row.status
  };
}

export function sourceHealthToDto(row: SourceHealthDtoSource): WorkbenchSourceHealth {
  return {
    source_adapter_id: row.source_adapter_id,
    tier: row.tier,
    category: row.category,
    registry_status: row.registry_status,
    automation: row.automation,
    tos_url: row.tos_url,
    official_url: row.official_url,
    requires_key: row.requires_key,
    last_checked_at: toNullableIsoString(row.last_checked_at),
    last_success_at: toNullableIsoString(row.last_success_at),
    last_failure_at: toNullableIsoString(row.last_failure_at),
    failure_count: row.failure_count,
    last_change_at: toNullableIsoString(row.last_change_at),
    last_error_message: row.last_error_message,
    policy_enabled: row.policy_enabled,
    check_cadence_minutes: row.check_cadence_minutes,
    jitter_minutes: row.jitter_minutes,
    priority: row.priority,
    next_check_at: toNullableIsoString(row.next_check_at),
    policy_config_source: row.policy_config_source,
    policy_notes: row.policy_notes
  };
}

export function edgeStrengthToDto(row: EdgeStrengthEstimateRecord): WorkbenchEdgeStrength {
  return {
    strength_id: row.strength_id,
    edge_id: row.edge_id,
    strength_kind: row.strength_kind,
    value: row.value ?? null,
    lower_bound: row.lower_bound ?? null,
    upper_bound: row.upper_bound ?? null,
    unit: row.unit ?? null,
    evidence_id: row.evidence_id ?? null,
    method: row.method,
    valid_from: row.valid_from ?? null,
    valid_to: row.valid_to ?? null
  };
}

export function edgeFreshnessToDto(row: EdgeFreshnessRecord): WorkbenchEdgeFreshness {
  return {
    edge_id: row.edge_id,
    last_verified_at: row.last_verified_at,
    decay_model: row.decay_model,
    age_days: row.age_days,
    freshness_score: row.freshness_score,
    computed_at: row.computed_at,
    source_evidence_id: row.source_evidence_id ?? null
  };
}

export function compareWorkbenchEvidence(left: WorkbenchEvidence, right: WorkbenchEvidence): number {
  const leftEdge = left.edge_id ?? "";
  const rightEdge = right.edge_id ?? "";
  const edgeOrder = leftEdge.localeCompare(rightEdge);
  if (edgeOrder !== 0) return edgeOrder;
  const activeOrder = Number(left.superseded_by !== null) - Number(right.superseded_by !== null);
  if (activeOrder !== 0) return activeOrder;
  return right.evidence_level - left.evidence_level || right.confidence - left.confidence || left.evidence_id.localeCompare(right.evidence_id);
}

function toNullableIsoString(value: Date | string | null): string | null {
  return value === null ? null : toIsoString(value);
}

export function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toDateOnly(value: Date | string): string {
  return toIsoString(value).slice(0, 10);
}
