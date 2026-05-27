import type { DataQualitySummary } from "@supplystrata/data-quality";
import type { ComponentRiskRefreshSummary, EdgeIntelligenceRefreshSummary, MaterializeRootResearchUnknownsSummary } from "@supplystrata/evidence-maintenance";
import type { ChainViewModel, CompanyCardModel, ComponentCardModel } from "@supplystrata/render";
import type { SourcePlanItem, TradeObservationDirection } from "@supplystrata/source-plan";
import type { WorkbenchModel } from "@supplystrata/workbench-export";
import type { CorroborationSourcePlan } from "./corroboration-source-plan.js";
import type { ConsumerReadModel } from "./consumer-read-model-definitions.js";
import type { Gate1DataDepthWorkbench, Gate1DataDepthWorkstream } from "./gate1-data-depth-workbench.js";
import type { Gate1RunLedger } from "./gate1-run-ledger.js";
import type { InvestigationBacklog } from "./investigation-backlog.js";
import type { ObservationCoverageReport } from "./observation-coverage.js";
import type { OfficialDisclosureReadinessReport, OfficialDisclosureReadinessTargetNode } from "./official-disclosure-readiness.js";
import type { PropagationReadinessReport } from "./propagation-readiness.js";
import type { QuestionReadinessMatrix } from "./question-readiness.js";
import type { ReasoningWalkthrough } from "./reasoning-walkthrough-definitions.js";
import type { ResearchTargetProfileOption } from "./research-target-profile.js";
import type { SourceTargetCoverageReport } from "./source-target-coverage.js";
import type { SourceTargetPreflightReport } from "./source-target-preflight.js";
import type { SupplyChainExpansionPlan } from "./supply-chain-expansion-plan.js";

export interface ResearchPackInput {
  company: string;
  components?: readonly string[];
  depth?: number;
  generatedAt: string;
  since?: string;
  changeLimit?: number;
  sourceLimit?: number;
  buildClaims?: boolean;
  refreshIntelligence?: boolean;
  refreshComponentRisk?: boolean;
  materializeRootUnknowns?: boolean;
  intelligenceLimit?: number;
  minEvidenceLevel?: 4 | 5;
  generatedBy?: string;
  tradeObservationMonth?: string;
  tradeObservationCountryCode?: string;
  tradeObservationDirections?: readonly TradeObservationDirection[];
  officialDisclosureYear?: string;
  materialObservationYear?: string;
  commodityObservationMonth?: string;
  sourceTargetNamespace?: string;
  sourceTargetPreflight?: SourceTargetPreflightReport;
  researchTargetProfileId?: ResearchTargetProfileOption;
  officialDisclosureTargetNodes?: readonly OfficialDisclosureReadinessTargetNode[];
  supplyChainExpansionMaxDepth?: number;
  researchLineage?: ResearchPackLineage;
}

export interface ResearchPackLineage {
  kind: "frontier_company_research" | "manual_research";
  parent_company_id: string | null;
  parent_component_ids: string[];
  seed_edge_ids: string[];
  seed_unknown_ids: string[];
  note: string | null;
}

export interface ResearchPackWriteSteps {
  buildClaims: boolean;
  refreshIntelligence: boolean;
  refreshComponentRisk: boolean;
  materializeRootUnknowns: boolean;
}

export interface ResearchPackManifest {
  schema_version: "1.0.0";
  mode: "truth_store" | "workbench_snapshot";
  generated_at: string;
  company_query: string;
  selected_company_id: string;
  depth: number;
  components: string[];
  files: ResearchPackFile[];
  stats: ResearchPackStats;
  claim_build: ResearchPackClaimBuild | null;
  intelligence_refresh: EdgeIntelligenceRefreshSummary | null;
  component_risk_refresh: ResearchPackComponentRiskRefresh | null;
  root_unknown_materialization: MaterializeRootResearchUnknownsSummary | null;
  research_target_profile: ResearchPackTargetProfile | null;
  research_lineage: ResearchPackLineage | null;
}

export interface ResearchPackFile {
  path: string;
  kind: "json" | "markdown";
  description: string;
}

export interface ResearchPackStats {
  companies: number;
  chain_segments: number;
  fact_edges: number;
  claims: number;
  draft_claims: number;
  claim_conflicts: number;
  contradicting_evidence_links: number;
  claim_lifecycle_warnings: number;
  attention_items: number;
  review_candidates: number;
  official_disclosure_signal_review_candidates: number;
  open_official_disclosure_signal_review_candidates: number;
  official_disclosure_signal_dispositions: number;
  official_disclosure_signal_correlation_hints: number;
  open_official_disclosure_signal_correlation_hints: number;
  evidences: number;
  unknown_items: number;
  source_plan_items: number;
  runnable_suggested_targets: number;
  data_quality_errors: number;
  data_quality_warnings: number;
  intelligence_edge_strengths: number;
  intelligence_edge_freshness: number;
  component_risk_views_refreshed: number;
  component_risk_metrics_written: number;
  component_risk_visible_edges: number;
  component_risk_global_edges: number;
  component_risk_changes_recorded: number;
  question_readiness_ready: number;
  question_readiness_partial: number;
  question_readiness_blocked: number;
  investigation_backlog_items: number;
  investigation_backlog_p0: number;
  investigation_backlog_p1: number;
  investigation_backlog_corroboration_reviews: number;
  investigation_backlog_corroboration_review_runnable_targets: number;
  investigation_backlog_corroboration_review_with_source_target_coverage: number;
  investigation_backlog_corroboration_review_explicit_disposition_only: number;
  investigation_backlog_corroboration_review_need_sync: number;
  investigation_backlog_corroboration_review_need_enable: number;
  investigation_backlog_corroboration_review_due: number;
  investigation_backlog_corroboration_review_failed_preflight: number;
  investigation_backlog_corroboration_review_missing_credentials: number;
  investigation_backlog_corroboration_review_invalid_config: number;
  investigation_backlog_corroboration_review_unsupported_connector: number;
  investigation_backlog_corroboration_review_source_unreachable: number;
  investigation_backlog_propagation_readiness_items: number;
  corroboration_source_plan_items: number;
  corroboration_source_plan_targets: number;
  corroboration_source_plan_edges: number;
  corroboration_source_plan_need_sync: number;
  corroboration_source_plan_need_enable: number;
  corroboration_source_plan_due: number;
  corroboration_source_plan_failed_preflight: number;
  corroboration_source_plan_missing_credentials: number;
  corroboration_source_plan_next_actions: Record<string, number>;
  investigation_backlog_runnable_targets: number;
  source_target_expected_targets: number;
  source_target_synced_targets: number;
  source_target_not_synced: number;
  source_target_due_targets: number;
  source_target_active_jobs: number;
  source_target_retry_wait: number;
  source_target_degraded_targets: number;
  source_target_dead_targets: number;
  source_target_source_failed_targets: number;
  source_target_failure_kinds: Record<string, number>;
  source_target_targets_with_observations: number;
  source_target_total_observations: number;
  source_target_observed_subject_entities: number;
  source_target_observations_by_source: Record<string, number>;
  source_target_observations_by_target_kind: Record<string, number>;
  source_target_observations_by_metric: Record<string, number>;
  source_target_observation_review_items: number;
  source_target_observation_review_p0: number;
  source_target_observation_review_p1: number;
  source_target_observation_review_p2: number;
  source_target_observation_review_by_category: Record<string, number>;
  source_target_observation_calibration_candidates: number;
  source_target_observation_calibration_by_label: Record<string, number>;
  source_target_observation_calibration_labeled_candidates: number;
  source_target_observation_calibration_unlabeled_candidates: number;
  source_target_observation_calibration_by_persisted_label: Record<string, number>;
  source_target_observation_calibration_next_labeling_batch: number;
  source_target_observation_calibration_next_labeling_batch_by_priority: Record<string, number>;
  source_target_observation_calibration_next_labeling_batch_by_metric: Record<string, number>;
  source_target_preflight_selected_targets: number;
  source_target_preflight_checked_targets: number;
  source_target_preflight_failed_targets: number;
  source_target_preflight_degraded_documents: number;
  source_target_preflight_observation_drafts: number;
  source_target_preflight_semantic_sections: number;
  source_target_preflight_issue_kinds: Record<string, number>;
  observation_records: number;
  observation_chain_segments: number;
  observation_types_present: number;
  observation_methodology_types_missing: number;
  observation_series: number;
  observation_time_series_ready: number;
  observation_explicit_baseline_ready: number;
  observation_sparse_series: number;
  official_disclosure_visible_nodes: number;
  official_disclosure_target_nodes: number;
  official_disclosure_nodes_with_fact_edges: number;
  official_disclosure_target_nodes_with_fact_edges: number;
  official_disclosure_nodes_missing_coverage: number;
  official_disclosure_target_nodes_missing_coverage: number;
  official_disclosure_profile_expansion_candidates: number;
  official_disclosure_expected_source_links: number;
  official_disclosure_expected_source_links_with_coverage: number;
  official_disclosure_expected_source_links_runnable: number;
  official_disclosure_expected_source_links_connector_available: number;
  official_disclosure_expected_source_links_unimplemented: number;
  official_disclosure_expected_source_links_missing: number;
  official_disclosure_l4_l5_edges: number;
  official_disclosure_traceable_edges: number;
  official_disclosure_cross_source_edges: number;
  official_disclosure_corroboration_ratio: number;
  official_disclosure_corroboration_or_disposition_edges: number;
  official_disclosure_corroboration_or_disposition_ratio: number;
  official_disclosure_corroboration_queue_items: number;
  official_disclosure_corroboration_queue_with_runnable_targets: number;
  official_disclosure_corroboration_queue_needing_disposition: number;
  official_disclosure_corroboration_queue_recorded_disposition: number;
  official_disclosure_corroboration_queue_proposed_unknowns: number;
  official_disclosure_gaps: number;
  official_disclosure_p0_gaps: number;
  official_disclosure_runnable_targets: number;
  official_disclosure_synced_targets: number;
  official_disclosure_due_targets: number;
  official_disclosure_degraded_targets: number;
  official_disclosure_targets_with_observations: number;
  official_disclosure_gate1_overall_progress: number;
  official_disclosure_gate1_data_progress: number;
  official_disclosure_gate1_source_path_progress: number;
  supply_chain_expansion_frontier_edges: number;
  supply_chain_expansion_frontier_companies: number;
  supply_chain_expansion_component_dependency_leads: number;
  supply_chain_expansion_leads_with_source_path: number;
  supply_chain_expansion_leads_with_fact_capable_source_path: number;
  supply_chain_expansion_leads_with_observation_source_path: number;
  supply_chain_expansion_leads_with_lead_only_source_path: number;
  supply_chain_expansion_blocked_frontier_edges: number;
  supply_chain_expansion_stop_conditions: number;
  propagation_readiness_ready: number;
  propagation_readiness_partial: number;
  propagation_readiness_blocked: number;
  propagation_contexts_with_observations: number;
  propagation_contexts_with_source_plan: number;
  propagation_contexts_with_component_leads: number;
  propagation_reasoning_inputs: number;
  ai_compute_propagation_layers_total: number;
  ai_compute_propagation_covered_fact: number;
  ai_compute_propagation_observation_ready: number;
  ai_compute_propagation_official_target_runnable: number;
  ai_compute_propagation_lead_only: number;
  ai_compute_propagation_unknown_open: number;
  ai_compute_propagation_blocked_source: number;
  ai_compute_official_evidence_gaps: number;
  ai_compute_official_evidence_gaps_by_kind: Record<string, number>;
  gate1_data_depth_items: number;
  gate1_data_depth_p0: number;
  gate1_data_depth_p1: number;
  gate1_data_depth_p2: number;
  gate1_data_depth_by_workstream: Record<Gate1DataDepthWorkstream, number>;
  gate1_data_depth_fact_edge_gap: number;
  gate1_data_depth_source_blockers: number;
  gate1_data_depth_adjacent_official_fact_edges: number;
  gate1_data_depth_adjacent_official_fact_companies: number;
  gate1_data_depth_entity_context_items: number;
  gate1_data_depth_strength_missing_edges: number;
  gate1_data_depth_observation_labeling_batch: number;
  gate1_data_depth_propagation_contexts_not_ready: number;
  gate1_data_depth_ranking_calibration_candidates: number;
  gate1_data_depth_ranking_labeled_candidates: number;
  gate1_data_depth_ranking_unlabeled_candidates: number;
  gate1_data_depth_ranking_labels_by_persisted_label: Record<string, number>;
}

export interface ResearchPackClaimBuild {
  scanned: number;
  inserted: number;
  updated: number;
  generated_by: string;
}

export interface ResearchPackComponentRiskRefresh {
  scope_kind: "component_global";
  interpretation: string;
  components_considered: number;
  components_eligible: number;
  risk_views_refreshed: number;
  metrics_written: number;
  edge_count: number;
  research_pack_visible_edge_count: number;
  supplier_count: number;
  share_unknown_count: number;
  risk_changes_recorded: number;
  generated_by: string;
  components: ResearchPackComponentRiskRefreshComponent[];
}

export interface ResearchPackComponentRiskRefreshComponent extends ComponentRiskRefreshSummary {
  scope_kind: "component_global";
  research_pack_visible_edge_count: number;
}

export interface ResearchPackModel {
  manifest: ResearchPackManifest;
  workbench: WorkbenchModel;
  company: CompanyCardModel;
  chain: ChainViewModel;
  components: ComponentCardModel[];
  source_plan: SourcePlanItem[];
  data_quality: DataQualitySummary;
  question_readiness: QuestionReadinessMatrix;
  investigation_backlog: InvestigationBacklog;
  corroboration_source_plan: CorroborationSourcePlan;
  source_target_coverage: SourceTargetCoverageReport;
  source_target_preflight: SourceTargetPreflightReport | null;
  observation_coverage: ObservationCoverageReport;
  official_disclosure_readiness: OfficialDisclosureReadinessReport;
  supply_chain_expansion_plan: SupplyChainExpansionPlan;
  propagation_readiness: PropagationReadinessReport;
  gate1_data_depth_workbench: Gate1DataDepthWorkbench;
  gate1_run_ledger: Gate1RunLedger;
  consumer_read_model: ConsumerReadModel;
  reasoning_walkthrough: ReasoningWalkthrough;
}

export interface WorkbenchSnapshotPackInput {
  workbench: WorkbenchModel;
  components?: readonly string[];
  depth?: number;
  generatedAt?: string;
  tradeObservationMonth?: string;
  tradeObservationCountryCode?: string;
  tradeObservationDirections?: readonly TradeObservationDirection[];
  officialDisclosureYear?: string;
  materialObservationYear?: string;
  commodityObservationMonth?: string;
  researchTargetProfileId?: ResearchTargetProfileOption;
  officialDisclosureTargetNodes?: readonly OfficialDisclosureReadinessTargetNode[];
  sourceTargetNamespace?: string;
  sourceTargetPreflight?: SourceTargetPreflightReport;
  supplyChainExpansionMaxDepth?: number;
  researchLineage?: ResearchPackLineage;
}

export interface WorkbenchSnapshotPackModel {
  manifest: ResearchPackManifest;
  workbench: WorkbenchModel;
  chain: ChainViewModel;
  source_plan: SourcePlanItem[];
  question_readiness: QuestionReadinessMatrix;
  investigation_backlog: InvestigationBacklog;
  corroboration_source_plan: CorroborationSourcePlan;
  source_target_coverage: SourceTargetCoverageReport;
  source_target_preflight: SourceTargetPreflightReport | null;
  observation_coverage: ObservationCoverageReport;
  official_disclosure_readiness: OfficialDisclosureReadinessReport;
  supply_chain_expansion_plan: SupplyChainExpansionPlan;
  propagation_readiness: PropagationReadinessReport;
  gate1_data_depth_workbench: Gate1DataDepthWorkbench;
  gate1_run_ledger: Gate1RunLedger;
  consumer_read_model: ConsumerReadModel;
  reasoning_walkthrough: ReasoningWalkthrough;
}

export interface ResearchPackTargetProfile {
  profile_id: string;
  title: string;
  version: string;
  description: string;
  selection_reason: string;
  target_nodes: number;
}

export interface WrittenResearchPack {
  out_dir: string;
  manifest: ResearchPackManifest;
}
