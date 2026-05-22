import type pg from "pg";
import type { ClaimType, EdgeValidity, EvidenceLevel, ExtractionMethod, RelationType } from "@supplystrata/core";
import type { WorkbenchClaimStatus } from "./definitions.js";

export interface ClaimDbRow extends pg.QueryResultRow {
  claim_id: string;
  claim_type: ClaimType;
  claim_text: string;
  subject_id: string | null;
  object_id: string | null;
  component_id: string | null;
  edge_id: string | null;
  edge_validity: EdgeValidity | null;
  edge_deprecated_reason: string | null;
  edge_superseded_by_edge_id: string | null;
  review_id: string | null;
  status: WorkbenchClaimStatus;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  generated_by: string;
  last_verified_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface EvidenceDbRow extends pg.QueryResultRow {
  evidence_id: string;
  edge_id: string | null;
  superseded_by: string | null;
  cite_text: string;
  cite_locator: string | null;
  cite_start_char: number | null;
  cite_end_char: number | null;
  cite_text_sha256: string | null;
  normalized_cite_text_sha256: string | null;
  source_snapshot_sha256: string | null;
  parser_version: string | null;
  extractor_version: string | null;
  relation_candidate_hash: string | null;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  extraction_method: ExtractionMethod;
  source_url: string;
  source_date: Date | string | null;
  fetched_at: Date | string;
  source_adapter_id: string;
  document_type: string;
  subject_name: string | null;
  object_name: string | null;
  relation: RelationType | null;
}

export interface UnknownDbRow extends pg.QueryResultRow {
  unknown_id: string;
  scope_kind: string;
  scope_id: string;
  question: string;
  why_unknown: string;
  blocking_data_sources: string[];
  proxies: string[];
  status: string;
}

export interface SourceHealthDbRow extends pg.QueryResultRow {
  source_adapter_id: string;
  tier: string;
  category: string;
  registry_status: string;
  automation: string;
  tos_url: string;
  official_url: string;
  requires_key: boolean;
  last_checked_at: Date | string | null;
  last_success_at: Date | string | null;
  last_failure_at: Date | string | null;
  failure_count: number;
  last_change_at: Date | string | null;
  last_error_message: string | null;
  policy_enabled: boolean | null;
  check_cadence_minutes: number | null;
  jitter_minutes: number | null;
  priority: number | null;
  next_check_at: Date | string | null;
  policy_config_source: string | null;
  policy_notes: string | null;
}
