import type { SourcePlanItem } from "@supplystrata/source-plan";
import type { WorkbenchModel } from "@supplystrata/workbench-export";
import type { OfficialDisclosureSignalCorrelationHint } from "./official-disclosure-signal-correlation.js";
import type { SourceTargetCoverageReport } from "./source-target-coverage.js";

export type OfficialDisclosureTraceabilityState = "complete" | "partial" | "missing";
export type OfficialDisclosureCorroborationState = "cross_source" | "single_source" | "missing_evidence";

export interface OfficialDisclosureReadinessTargets {
  core_nodes: number;
  level_4_5_fact_edges: number;
  corroboration_ratio: number;
}

export interface OfficialDisclosureReadinessSummary {
  visible_research_nodes: number;
  target_research_nodes: number;
  company_nodes: number;
  component_nodes: number;
  nodes_with_fact_edges: number;
  target_nodes_with_fact_edges: number;
  nodes_with_official_source_plan: number;
  target_nodes_with_official_source_plan: number;
  nodes_with_runnable_official_targets: number;
  target_nodes_with_runnable_official_targets: number;
  nodes_with_official_observations: number;
  target_nodes_with_official_observations: number;
  nodes_missing_official_coverage: number;
  target_nodes_missing_official_coverage: number;
  level_4_5_fact_edges: number;
  traceable_edges: number;
  partial_traceability_edges: number;
  missing_traceability_edges: number;
  cross_source_edges: number;
  single_source_edges: number;
  missing_evidence_edges: number;
  corroboration_ratio: number;
  corroboration_or_disposition_edges: number;
  corroboration_or_disposition_ratio: number;
  corroboration_queue_items: number;
  corroboration_queue_with_runnable_targets: number;
  corroboration_queue_needing_disposition: number;
  corroboration_queue_with_recorded_disposition: number;
  corroboration_queue_proposed_unknowns: number;
  edges_with_strength: number;
  edges_with_freshness: number;
  edges_missing_strength: number;
  edges_missing_freshness: number;
  explicit_unknowns: number;
  official_source_plan_items: number;
  expected_official_source_links: number;
  expected_official_source_links_with_coverage: number;
  expected_official_source_links_runnable: number;
  expected_official_source_links_connector_available: number;
  expected_official_source_links_unimplemented: number;
  expected_official_source_links_missing: number;
  runnable_official_targets: number;
  synced_official_targets: number;
  due_official_targets: number;
  degraded_official_targets: number;
  official_targets_with_observations: number;
  official_disclosure_signal_review_candidates: number;
  open_official_disclosure_signal_review_candidates: number;
  official_disclosure_signal_dispositions: number;
  official_disclosure_signal_correlation_hints: number;
  open_official_disclosure_signal_correlation_hints: number;
}

export interface OfficialDisclosureGateStatus {
  gate_id: string;
  status: "pass" | "partial" | "blocked";
  measured: number;
  target: number;
  rationale: string;
}

export interface OfficialDisclosureGate1Scorecard {
  scorecard_id: "gate_1_official_disclosure";
  status: "pass" | "partial" | "blocked";
  overall_progress: number;
  data_progress: number;
  source_path_progress: number;
  criteria: OfficialDisclosureGate1ScorecardCriterion[];
  next_actions: string[];
}

export interface OfficialDisclosureGate1ScorecardCriterion {
  criterion_id:
    | "core_node_official_coverage"
    | "level_4_5_fact_edge_coverage"
    | "corroboration_or_disposition_coverage"
    | "fact_edge_traceability"
    | "expected_source_path_coverage";
  label: string;
  kind: "completion" | "operability";
  status: "pass" | "partial" | "blocked";
  measured: number;
  target: number;
  progress: number;
  rationale: string;
}

export interface OfficialDisclosureReadinessEdge {
  edge_id: string;
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  relation: string;
  component_id: string | null;
  evidence_level: number;
  confidence: number;
  evidence_ids: string[];
  source_adapters: string[];
  source_urls: string[];
  source_documents: string[];
  traceability_state: OfficialDisclosureTraceabilityState;
  corroboration_state: OfficialDisclosureCorroborationState;
  has_strength: boolean;
  has_freshness: boolean;
  unknown_ids: string[];
  single_source_disposition_unknown_ids: string[];
}

export type OfficialDisclosureCorroborationDisposition =
  | "needs_counterparty_check"
  | "needs_counterparty_source_target"
  | "needs_explicit_single_source_disposition"
  | "single_source_disposition_recorded"
  | "needs_traceability_backfill";

export interface OfficialDisclosureProposedUnknown {
  unknown_id: string;
  scope_kind: "edge";
  scope_id: string;
  question: string;
  why_unknown: string;
  blocking_data_sources: string[];
  proxies: string[];
  created_by: string;
}

export interface OfficialDisclosureCorroborationQueueItem {
  edge_id: string;
  priority: "P1" | "P2";
  disposition: OfficialDisclosureCorroborationDisposition;
  reason: string;
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  component_id: string | null;
  existing_source_adapters: string[];
  candidate_node_ids: string[];
  candidate_source_ids: string[];
  source_plan_refs: string[];
  source_targets: OfficialDisclosureReadinessSourceTarget[];
  unknown_ids: string[];
  proposed_unknown: OfficialDisclosureProposedUnknown | null;
  action: string;
}

export interface OfficialDisclosureReadinessGap {
  gap_id: string;
  priority: "P0" | "P1" | "P2";
  kind:
    | "core_node_coverage"
    | "level_4_5_edge_coverage"
    | "expected_official_source_coverage"
    | "traceability"
    | "corroboration_or_disposition_coverage"
    | "edge_strength"
    | "edge_freshness";
  title: string;
  rationale: string;
  action: string;
  edge_ids: string[];
  component_ids: string[];
  source_adapters: string[];
  source_plan_refs: string[];
  source_targets: OfficialDisclosureReadinessSourceTarget[];
}

export interface OfficialDisclosureReadinessSourcePlanItem {
  source_id: string;
  source_name: string;
  priority: string;
  expected_output_layer: string;
  relation_policy: string;
  component_ids: string[];
  target_ids: string[];
  reasons: string[];
  source_targets: OfficialDisclosureReadinessSourceTarget[];
}

export interface OfficialDisclosureReadinessSourceTarget {
  source_adapter_id: string;
  target_kind: string;
  runnable: boolean;
  target_key: string;
  target_entity_id: string | null;
  target_component_id: string | null;
  check_target_id: string | null;
  state: string | null;
  synced: boolean | null;
  observations: number | null;
  latest_event_type: string | null;
}

export type OfficialDisclosureNodeKind = "company" | "component";
export type OfficialDisclosureNodeCoverageState =
  | "covered_fact"
  | "official_target_with_observation"
  | "official_target_synced"
  | "official_target_runnable"
  | "official_source_planned"
  | "missing";

export interface OfficialDisclosureReadinessNode {
  node_id: string;
  node_kind: OfficialDisclosureNodeKind;
  name: string | null;
  is_target_node: boolean;
  target_priority: "P0" | "P1" | "P2" | null;
  expected_source_ids: string[];
  coverage_state: OfficialDisclosureNodeCoverageState;
  fact_edge_ids: string[];
  source_plan_refs: string[];
  source_targets: OfficialDisclosureReadinessSourceTarget[];
}

export interface OfficialDisclosureReadinessTargetNode {
  node_id: string;
  node_kind: OfficialDisclosureNodeKind;
  name?: string;
  priority?: "P0" | "P1" | "P2";
  expected_source_ids?: readonly string[];
  expected_source_targets?: readonly OfficialDisclosureReadinessTargetSourceConfig[];
}

export interface OfficialDisclosureReadinessTargetSourceConfig {
  source_id: string;
  target_kind: string;
  target_config: Record<string, string | number | boolean | string[]>;
  reason?: string;
}

export interface OfficialDisclosureReadinessProfile {
  profile_id: string;
  title: string;
  version: string;
  description: string;
  selection_reason: string;
}

export interface OfficialDisclosureProfileExpansionCandidate {
  node_id: string;
  node_kind: OfficialDisclosureNodeKind;
  name: string | null;
  suggested_priority: "P1" | "P2";
  reason: string;
  coverage_state: OfficialDisclosureNodeCoverageState;
  fact_edge_ids: string[];
  source_plan_refs: string[];
  source_adapters: string[];
}

export type OfficialDisclosureExpectedSourceCoverageState =
  | "covered_fact"
  | "official_target_with_observation"
  | "official_target_synced"
  | "official_target_runnable"
  | "official_source_planned"
  | "connector_available"
  | "source_registered_unimplemented"
  | "missing_source_mapping";

export interface OfficialDisclosureExpectedSourceCoverage {
  node_id: string;
  node_kind: OfficialDisclosureNodeKind;
  node_name: string | null;
  target_priority: "P0" | "P1" | "P2" | null;
  expected_source_id: string;
  coverage_state: OfficialDisclosureExpectedSourceCoverageState;
  action: string;
  fact_edge_ids: string[];
  source_plan_refs: string[];
  source_targets: OfficialDisclosureReadinessSourceTarget[];
}

export interface OfficialDisclosureReadinessReport {
  schema_version: "1.0.0";
  generated_at: string;
  company_id: string;
  target_profile: OfficialDisclosureReadinessProfile | null;
  targets: OfficialDisclosureReadinessTargets;
  scorecard: OfficialDisclosureGate1Scorecard;
  summary: OfficialDisclosureReadinessSummary;
  gates: OfficialDisclosureGateStatus[];
  nodes: OfficialDisclosureReadinessNode[];
  profile_expansion_candidates: OfficialDisclosureProfileExpansionCandidate[];
  expected_source_coverage: OfficialDisclosureExpectedSourceCoverage[];
  official_disclosure_signals: OfficialDisclosureSignalReviewSummary[];
  official_disclosure_signal_correlation_hints: OfficialDisclosureSignalCorrelationHint[];
  corroboration_queue: OfficialDisclosureCorroborationQueueItem[];
  edges: OfficialDisclosureReadinessEdge[];
  source_plan_items: OfficialDisclosureReadinessSourcePlanItem[];
  gaps: OfficialDisclosureReadinessGap[];
}

export interface OfficialDisclosureReadinessInput {
  generated_at: string;
  company_id: string;
  workbench: Pick<WorkbenchModel, "companies" | "edges" | "evidences" | "unknown_items" | "review_queue" | "intelligence">;
  component_ids: readonly string[];
  target_nodes?: readonly OfficialDisclosureReadinessTargetNode[];
  target_profile?: OfficialDisclosureReadinessProfile;
  source_plan?: readonly SourcePlanItem[];
  source_target_coverage?: SourceTargetCoverageReport;
  targets?: Partial<OfficialDisclosureReadinessTargets>;
}

export interface OfficialDisclosureSignalReviewSummary {
  review_id: string;
  status: string;
  source_adapter_id: string;
  doc_id: string | null;
  signal_title: string;
  evidence_level_hint: number;
  confidence: number;
  source_url: string;
  source_locator: string;
  cite_text: string;
  dispositions: OfficialDisclosureSignalDispositionSummary[];
}

export interface OfficialDisclosureSignalDispositionSummary {
  change_id: string;
  edge_id: string;
  decision: string;
  reviewer: string;
  reason: string;
  evidence_id: string | null;
  unknown_id: string | null;
  check_target_id: string | null;
  recorded_at: string;
}

export interface OfficialDisclosureNodeDraft {
  node_kind: OfficialDisclosureNodeKind;
  name: string | null;
  is_target_node: boolean;
  target_priority: "P0" | "P1" | "P2" | null;
  expected_source_ids: string[];
}
