import type {
  ClaimConflictAdjudication,
  ClaimConflictReviewPacket,
  ClaimConflictAdjudicationState,
  ClaimConflictRecommendedAction
} from "@supplystrata/claim-builder";
import type { ChainViewModel, ChainViewSegmentModel } from "@supplystrata/chain-view";
import type {
  ClaimEvidenceRole,
  ClaimStatus,
  ClaimType,
  ClaimUnknownRole,
  EdgeValidity,
  EdgeFreshnessDecayModel,
  EdgeStrengthKind,
  EvidenceLevel,
  ExtractionMethod,
  RelationType
} from "@supplystrata/core";
import type { SourcePlanItem } from "@supplystrata/source-plan";

export interface WorkbenchExportInput {
  company: string;
  depth?: number;
  generatedAt: string;
  since?: string;
  changeLimit?: number;
  sourceLimit?: number;
  draftClaimLimit?: number;
  lifecycleClaimLimit?: number;
  reviewCandidateLimit?: number;
  alertLimit?: number;
  attentionLimit?: number;
}

export interface WorkbenchCompanyNode {
  entity_id: string;
  name: string;
  role: "root" | "counterparty";
}

export interface WorkbenchEdge {
  edge_id: string;
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  relation: RelationType;
  component: string | null;
  component_id: string | null;
  evidence_level: EvidenceLevel;
  confidence: number;
  evidence_ids: string[];
}

export type WorkbenchClaimStatus = ClaimStatus;
export type WorkbenchClaimConflictState = ClaimConflictAdjudicationState;
export type WorkbenchClaimConflictRecommendedAction = ClaimConflictRecommendedAction;

export interface WorkbenchClaimEvidenceRef {
  evidence_id: string;
  role: ClaimEvidenceRole;
}

export interface WorkbenchClaimUnknownRef {
  unknown_id: string;
  role: ClaimUnknownRole;
  status: string;
}

export interface WorkbenchClaim {
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
  last_verified_at: string;
  created_at: string;
  updated_at: string;
  evidence_refs: WorkbenchClaimEvidenceRef[];
  unknown_refs: WorkbenchClaimUnknownRef[];
  conflict_state: WorkbenchClaimConflictState;
  conflict_adjudication: ClaimConflictAdjudication;
  conflict_review: ClaimConflictReviewPacket;
  lifecycle_warnings: WorkbenchClaimLifecycleWarning[];
}

export interface WorkbenchClaimLifecycleWarning {
  code: "active_claim_on_inactive_edge";
  severity: "warn";
  message: string;
}

export interface WorkbenchEvidence {
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
  source_date: string | null;
  fetched_at: string;
  source_adapter_id: string;
  document_type: string;
  subject_name: string | null;
  object_name: string | null;
  relation: RelationType | null;
}

export interface WorkbenchUnknownItem {
  unknown_id: string;
  scope_kind: string;
  scope_id: string;
  question: string;
  why_unknown: string;
  blocking_data_sources: string[];
  proxies: string[];
  status: string;
}

export interface WorkbenchSourceHealth {
  source_adapter_id: string;
  tier: string;
  category: string;
  registry_status: string;
  automation: string;
  tos_url: string;
  official_url: string;
  requires_key: boolean;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  failure_count: number;
  last_change_at: string | null;
  last_error_message: string | null;
  policy_enabled: boolean | null;
  check_cadence_minutes: number | null;
  jitter_minutes: number | null;
  priority: number | null;
  next_check_at: string | null;
  policy_config_source: string | null;
  policy_notes: string | null;
}

export const WORKBENCH_ATTENTION_KINDS = ["claim_conflict", "claim_lifecycle", "alert", "source_degraded", "change_requires_attention"] as const;
export const WORKBENCH_ATTENTION_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export const WORKBENCH_ATTENTION_STATUSES = ["open", "acknowledged", "resolved", "suppressed"] as const;

export type WorkbenchAttentionKind = (typeof WORKBENCH_ATTENTION_KINDS)[number];
export type WorkbenchAttentionPriority = (typeof WORKBENCH_ATTENTION_PRIORITIES)[number];
export type WorkbenchAttentionStatus = (typeof WORKBENCH_ATTENTION_STATUSES)[number];

export interface WorkbenchAttentionItem {
  attention_id: string;
  kind: WorkbenchAttentionKind;
  priority: WorkbenchAttentionPriority;
  status: WorkbenchAttentionStatus;
  title: string;
  summary: string;
  action: string;
  scope_kind: string;
  scope_id: string;
  refs: string[];
  detected_at: string | null;
}

export interface WorkbenchEdgeStrength {
  strength_id: string;
  edge_id: string;
  strength_kind: EdgeStrengthKind;
  value: string | null;
  lower_bound: string | null;
  upper_bound: string | null;
  unit: string | null;
  evidence_id: string | null;
  method: string;
  valid_from: string | null;
  valid_to: string | null;
}

export interface WorkbenchEdgeFreshness {
  edge_id: string;
  last_verified_at: string;
  decay_model: EdgeFreshnessDecayModel;
  age_days: number;
  freshness_score: number;
  computed_at: string;
  source_evidence_id: string | null;
}

export interface WorkbenchIntelligenceContext {
  edge_strengths: WorkbenchEdgeStrength[];
  edge_freshness: WorkbenchEdgeFreshness[];
}

export type WorkbenchReviewCandidateStatus = "pending" | "in_review" | "approved" | "rejected" | "blocked" | "applied";

export interface WorkbenchReviewCandidateSignal {
  signal_title: string;
  evidence_level_hint: number;
  automatic_fact_mutation_allowed: boolean;
}

export type WorkbenchOfficialDisclosureSignalDispositionDecision =
  | "supports_existing_edge"
  | "needs_more_evidence"
  | "not_relevant"
  | "record_single_source_unknown"
  | "create_counterparty_source_target";

export interface WorkbenchOfficialDisclosureSignalDisposition {
  change_id: string;
  review_id: string;
  edge_id: string;
  decision: WorkbenchOfficialDisclosureSignalDispositionDecision;
  reviewer: string;
  reason: string;
  source_adapter_id: string;
  doc_id: string | null;
  signal_title: string;
  evidence_id: string | null;
  unknown_id: string | null;
  check_target_id: string | null;
  recorded_at: string;
  fact_write_policy: {
    automatic_fact_mutation_allowed: false;
    allowed_edge_mutation: "none";
    requires_human_review: true;
  };
}

export interface WorkbenchReviewCandidate {
  review_id: string;
  kind: string;
  status: WorkbenchReviewCandidateStatus;
  title: string;
  confidence: number;
  source_adapter_id: string;
  doc_id: string | null;
  source_url: string;
  source_locator: string;
  source_row_text: string;
  created_at: string;
  reviewed_at: string | null;
  decision_reason: string | null;
  signal: WorkbenchReviewCandidateSignal | null;
  dispositions: WorkbenchOfficialDisclosureSignalDisposition[];
}

export interface WorkbenchChangeTimelineItem {
  event_id: string;
  event_family: "graph" | "source" | "semantic" | "risk";
  event_type: string;
  occurred_at: string;
  caused_by: string;
  requires_attention: boolean;
  scope_kind?: string;
  scope_id?: string;
  source_adapter_id?: string;
  source_item_id?: string;
  doc_id?: string;
  previous_doc_id?: string;
  next_doc_id?: string;
  edge_id?: string;
  evidence_id?: string;
  evidence_level?: EvidenceLevel;
  superseded_evidence_ids?: string[];
  superseded_by_evidence_id?: string;
  subject_id?: string;
  subject_name?: string;
  object_id?: string;
  object_name?: string;
  relation?: RelationType;
  component?: string;
  semantic_relation_kind?: string;
  relation_subject_surface?: string;
  relation_object_surface?: string;
  relation_fingerprint?: string;
  observation_scope_kind?: string;
  observation_scope_id?: string;
  metric_name?: string;
  metric_value?: string;
  metric_unit?: string;
  baseline_method?: string;
  baseline_value?: string;
  change_percent?: number;
  anomaly_severity?: string;
  anomaly_direction?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface WorkbenchModel {
  schema_version: "1.0.0";
  generated_at: string;
  selected_company_id: string;
  companies: WorkbenchCompanyNode[];
  chain: ChainViewModel;
  chain_segments: ChainViewSegmentModel[];
  edges: WorkbenchEdge[];
  upstream_edges: WorkbenchEdge[];
  downstream_edges: WorkbenchEdge[];
  claims: WorkbenchClaim[];
  draft_claims: WorkbenchClaim[];
  evidences: WorkbenchEvidence[];
  unknown_items: WorkbenchUnknownItem[];
  sources: WorkbenchSourceHealth[];
  source_plan: SourcePlanItem[];
  changes: WorkbenchChangeTimelineItem[];
  attention_queue: WorkbenchAttentionItem[];
  review_queue: WorkbenchReviewCandidate[];
  intelligence: WorkbenchIntelligenceContext;
}
