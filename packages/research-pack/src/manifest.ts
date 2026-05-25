import type { DataQualitySummary } from "@supplystrata/data-quality";
import type { EdgeIntelligenceRefreshSummary } from "@supplystrata/evidence-maintenance";
import type { SourcePlanItem } from "@supplystrata/source-plan";
import type { WorkbenchModel } from "@supplystrata/workbench-export";
import type { CorroborationSourcePlan } from "./corroboration-source-plan.js";
import type { Gate1DataDepthWorkbench } from "./gate1-data-depth-workbench.js";
import type {
  ResearchPackClaimBuild,
  ResearchPackComponentRiskRefresh,
  ResearchPackInput,
  ResearchPackManifest,
  ResearchPackTargetProfile
} from "./definitions.js";
import type { InvestigationBacklog } from "./investigation-backlog.js";
import type { ObservationCoverageReport } from "./observation-coverage.js";
import type { OfficialDisclosureReadinessReport } from "./official-disclosure-readiness.js";
import type { PropagationReadinessReport } from "./propagation-readiness.js";
import type { QuestionReadinessMatrix } from "./question-readiness.js";
import type { ResearchTargetProfileSelection } from "./research-target-profile.js";
import type { SourceTargetCoverageReport } from "./source-target-coverage.js";
import type { SourceTargetPreflightReport } from "./source-target-preflight.js";
import type { SupplyChainExpansionPlan } from "./supply-chain-expansion-plan.js";

export function manifestFromModel(input: {
  generatedAt: string;
  input: ResearchPackInput;
  depth: number;
  workbench: WorkbenchModel;
  components: readonly string[];
  sourcePlan: readonly SourcePlanItem[];
  sourceTargetCoverage?: SourceTargetCoverageReport;
  sourceTargetPreflight?: SourceTargetPreflightReport | null;
  dataQuality: DataQualitySummary;
  questionReadiness: QuestionReadinessMatrix;
  investigationBacklog: InvestigationBacklog;
  corroborationSourcePlan: CorroborationSourcePlan;
  observationCoverage: ObservationCoverageReport;
  officialDisclosureReadiness: OfficialDisclosureReadinessReport;
  supplyChainExpansionPlan: SupplyChainExpansionPlan;
  propagationReadiness: PropagationReadinessReport;
  gate1DataDepthWorkbench: Gate1DataDepthWorkbench;
  claimBuild: ResearchPackClaimBuild | null;
  intelligenceRefresh: EdgeIntelligenceRefreshSummary | null;
  componentRiskRefresh: ResearchPackComponentRiskRefresh | null;
  targetProfileSelection: ResearchTargetProfileSelection;
  mode?: ResearchPackManifest["mode"];
}): ResearchPackManifest {
  return {
    schema_version: "1.0.0",
    mode: input.mode ?? "truth_store",
    generated_at: input.generatedAt,
    company_query: input.input.company,
    selected_company_id: input.workbench.selected_company_id,
    depth: input.depth,
    components: [...input.components],
    files: [],
    stats: {
      companies: input.workbench.companies.length,
      chain_segments: input.workbench.chain_segments.length,
      fact_edges: input.workbench.edges.length,
      claims: input.workbench.claims.length,
      draft_claims: input.workbench.draft_claims.length,
      claim_conflicts: countClaimConflicts(input.workbench),
      contradicting_evidence_links: countContradictingEvidenceLinks(input.workbench),
      claim_lifecycle_warnings: countClaimLifecycleWarnings(input.workbench),
      attention_items: input.workbench.attention_queue.length,
      review_candidates: input.workbench.review_queue.length,
      evidences: input.workbench.evidences.length,
      unknown_items: input.workbench.unknown_items.length,
      source_plan_items: input.sourcePlan.length,
      runnable_suggested_targets: input.sourcePlan.reduce((count, item) => count + item.suggested_check_targets.filter((target) => target.runnable).length, 0),
      data_quality_errors: input.dataQuality.counts.error,
      data_quality_warnings: input.dataQuality.counts.warn,
      intelligence_edge_strengths: input.workbench.intelligence.edge_strengths.length,
      intelligence_edge_freshness: input.workbench.intelligence.edge_freshness.length,
      component_risk_views_refreshed: input.componentRiskRefresh?.risk_views_refreshed ?? 0,
      component_risk_metrics_written: input.componentRiskRefresh?.metrics_written ?? 0,
      component_risk_changes_recorded: input.componentRiskRefresh?.risk_changes_recorded ?? 0,
      question_readiness_ready: input.questionReadiness.summary.ready,
      question_readiness_partial: input.questionReadiness.summary.partial,
      question_readiness_blocked: input.questionReadiness.summary.blocked,
      investigation_backlog_items: input.investigationBacklog.summary.open_items,
      investigation_backlog_p0: input.investigationBacklog.summary.p0,
      investigation_backlog_p1: input.investigationBacklog.summary.p1,
      investigation_backlog_corroboration_reviews: input.investigationBacklog.summary.corroboration_reviews,
      investigation_backlog_corroboration_review_runnable_targets: input.investigationBacklog.summary.corroboration_review_runnable_targets,
      investigation_backlog_corroboration_review_with_source_target_coverage:
        input.investigationBacklog.summary.corroboration_review_with_source_target_coverage,
      investigation_backlog_corroboration_review_explicit_disposition_only: input.investigationBacklog.summary.corroboration_review_explicit_disposition_only,
      investigation_backlog_corroboration_review_need_sync: input.investigationBacklog.summary.corroboration_review_need_sync,
      investigation_backlog_corroboration_review_need_enable: input.investigationBacklog.summary.corroboration_review_need_enable,
      investigation_backlog_corroboration_review_due: input.investigationBacklog.summary.corroboration_review_due,
      investigation_backlog_corroboration_review_failed_preflight: input.investigationBacklog.summary.corroboration_review_failed_preflight,
      investigation_backlog_corroboration_review_missing_credentials: input.investigationBacklog.summary.corroboration_review_missing_credentials,
      investigation_backlog_corroboration_review_invalid_config: input.investigationBacklog.summary.corroboration_review_invalid_config,
      investigation_backlog_corroboration_review_unsupported_connector: input.investigationBacklog.summary.corroboration_review_unsupported_connector,
      investigation_backlog_corroboration_review_source_unreachable: input.investigationBacklog.summary.corroboration_review_source_unreachable,
      investigation_backlog_propagation_readiness_items: input.investigationBacklog.summary.propagation_readiness_items,
      corroboration_source_plan_items: input.corroborationSourcePlan.summary.source_plan_items,
      corroboration_source_plan_targets: input.corroborationSourcePlan.summary.runnable_targets,
      corroboration_source_plan_edges: input.corroborationSourcePlan.summary.review_edges,
      corroboration_source_plan_need_sync: input.corroborationSourcePlan.summary.targets_need_sync,
      corroboration_source_plan_need_enable: input.corroborationSourcePlan.summary.targets_need_enable,
      corroboration_source_plan_due: input.corroborationSourcePlan.summary.targets_due,
      corroboration_source_plan_failed_preflight: input.corroborationSourcePlan.summary.targets_failed_preflight,
      corroboration_source_plan_missing_credentials: input.corroborationSourcePlan.summary.targets_missing_credentials,
      corroboration_source_plan_next_actions: input.corroborationSourcePlan.summary.by_next_action,
      investigation_backlog_runnable_targets: input.investigationBacklog.summary.runnable_check_targets,
      source_target_expected_targets: input.sourceTargetCoverage?.summary.expected_targets ?? 0,
      source_target_synced_targets: input.sourceTargetCoverage?.summary.synced_targets ?? 0,
      source_target_not_synced: input.sourceTargetCoverage?.summary.not_synced ?? 0,
      source_target_due_targets: input.sourceTargetCoverage?.summary.due_targets ?? 0,
      source_target_active_jobs: input.sourceTargetCoverage?.summary.active_jobs ?? 0,
      source_target_retry_wait: input.sourceTargetCoverage?.summary.retry_wait ?? 0,
      source_target_degraded_targets: input.sourceTargetCoverage?.summary.degraded_targets ?? 0,
      source_target_dead_targets: input.sourceTargetCoverage?.summary.dead_targets ?? 0,
      source_target_source_failed_targets: input.sourceTargetCoverage?.summary.source_failed_targets ?? 0,
      source_target_failure_kinds: input.sourceTargetCoverage?.summary.source_failure_kinds ?? {},
      source_target_targets_with_observations: input.sourceTargetCoverage?.summary.targets_with_observations ?? 0,
      source_target_total_observations: input.sourceTargetCoverage?.summary.total_observations ?? 0,
      source_target_observed_subject_entities: input.sourceTargetCoverage?.summary.observed_subject_entities ?? 0,
      source_target_observations_by_source: input.sourceTargetCoverage?.summary.observations_by_source ?? {},
      source_target_observations_by_target_kind: input.sourceTargetCoverage?.summary.observations_by_target_kind ?? {},
      source_target_observations_by_metric: input.sourceTargetCoverage?.summary.observations_by_metric ?? {},
      source_target_observation_review_items: input.sourceTargetCoverage?.observation_review.summary.review_items ?? 0,
      source_target_observation_review_p0: input.sourceTargetCoverage?.observation_review.summary.p0 ?? 0,
      source_target_observation_review_p1: input.sourceTargetCoverage?.observation_review.summary.p1 ?? 0,
      source_target_observation_review_p2: input.sourceTargetCoverage?.observation_review.summary.p2 ?? 0,
      source_target_observation_review_by_category: input.sourceTargetCoverage?.observation_review.summary.by_category ?? {},
      source_target_observation_calibration_candidates: input.sourceTargetCoverage?.observation_review.summary.calibration_candidates ?? 0,
      source_target_observation_calibration_by_label: input.sourceTargetCoverage?.observation_review.summary.by_recommended_label ?? {},
      source_target_observation_calibration_labeled_candidates: input.sourceTargetCoverage?.observation_review.summary.labeled_calibration_candidates ?? 0,
      source_target_observation_calibration_unlabeled_candidates: input.sourceTargetCoverage?.observation_review.summary.unlabeled_calibration_candidates ?? 0,
      source_target_observation_calibration_by_persisted_label: input.sourceTargetCoverage?.observation_review.summary.by_persisted_label ?? {},
      source_target_observation_calibration_next_labeling_batch: input.sourceTargetCoverage?.observation_review.summary.next_labeling_batch_candidates ?? 0,
      source_target_observation_calibration_next_labeling_batch_by_priority:
        input.sourceTargetCoverage?.observation_review.summary.next_labeling_batch_by_priority ?? {},
      source_target_observation_calibration_next_labeling_batch_by_metric:
        input.sourceTargetCoverage?.observation_review.summary.next_labeling_batch_by_metric ?? {},
      source_target_preflight_selected_targets: input.sourceTargetPreflight?.summary.selected_targets ?? 0,
      source_target_preflight_checked_targets: input.sourceTargetPreflight?.summary.checked_targets ?? 0,
      source_target_preflight_failed_targets: input.sourceTargetPreflight?.summary.failed_targets ?? 0,
      source_target_preflight_degraded_documents: input.sourceTargetPreflight?.summary.degraded_documents ?? 0,
      source_target_preflight_observation_drafts: input.sourceTargetPreflight?.summary.observation_drafts ?? 0,
      source_target_preflight_semantic_sections: input.sourceTargetPreflight?.summary.semantic_sections ?? 0,
      source_target_preflight_issue_kinds: countSourceTargetPreflightIssueKinds(input.sourceTargetPreflight ?? null),
      observation_records: input.observationCoverage.summary.typed_observations,
      observation_chain_segments: input.observationCoverage.summary.chain_observation_segments,
      observation_types_present: input.observationCoverage.summary.observation_types_present,
      observation_methodology_types_missing: input.observationCoverage.summary.methodology_types_missing,
      observation_series: input.observationCoverage.summary.observation_series,
      observation_time_series_ready: input.observationCoverage.summary.time_series_ready,
      observation_explicit_baseline_ready: input.observationCoverage.summary.explicit_baseline_ready,
      observation_sparse_series: input.observationCoverage.summary.sparse_series,
      official_disclosure_visible_nodes: input.officialDisclosureReadiness.summary.visible_research_nodes,
      official_disclosure_target_nodes: input.officialDisclosureReadiness.summary.target_research_nodes,
      official_disclosure_nodes_with_fact_edges: input.officialDisclosureReadiness.summary.nodes_with_fact_edges,
      official_disclosure_target_nodes_with_fact_edges: input.officialDisclosureReadiness.summary.target_nodes_with_fact_edges,
      official_disclosure_nodes_missing_coverage: input.officialDisclosureReadiness.summary.nodes_missing_official_coverage,
      official_disclosure_target_nodes_missing_coverage: input.officialDisclosureReadiness.summary.target_nodes_missing_official_coverage,
      official_disclosure_profile_expansion_candidates: input.officialDisclosureReadiness.profile_expansion_candidates.length,
      official_disclosure_expected_source_links: input.officialDisclosureReadiness.summary.expected_official_source_links,
      official_disclosure_expected_source_links_with_coverage: input.officialDisclosureReadiness.summary.expected_official_source_links_with_coverage,
      official_disclosure_expected_source_links_runnable: input.officialDisclosureReadiness.summary.expected_official_source_links_runnable,
      official_disclosure_expected_source_links_connector_available:
        input.officialDisclosureReadiness.summary.expected_official_source_links_connector_available,
      official_disclosure_expected_source_links_unimplemented: input.officialDisclosureReadiness.summary.expected_official_source_links_unimplemented,
      official_disclosure_expected_source_links_missing: input.officialDisclosureReadiness.summary.expected_official_source_links_missing,
      official_disclosure_l4_l5_edges: input.officialDisclosureReadiness.summary.level_4_5_fact_edges,
      official_disclosure_traceable_edges: input.officialDisclosureReadiness.summary.traceable_edges,
      official_disclosure_cross_source_edges: input.officialDisclosureReadiness.summary.cross_source_edges,
      official_disclosure_corroboration_ratio: input.officialDisclosureReadiness.summary.corroboration_ratio,
      official_disclosure_corroboration_or_disposition_edges: input.officialDisclosureReadiness.summary.corroboration_or_disposition_edges,
      official_disclosure_corroboration_or_disposition_ratio: input.officialDisclosureReadiness.summary.corroboration_or_disposition_ratio,
      official_disclosure_corroboration_queue_items: input.officialDisclosureReadiness.summary.corroboration_queue_items,
      official_disclosure_corroboration_queue_with_runnable_targets: input.officialDisclosureReadiness.summary.corroboration_queue_with_runnable_targets,
      official_disclosure_corroboration_queue_needing_disposition: input.officialDisclosureReadiness.summary.corroboration_queue_needing_disposition,
      official_disclosure_corroboration_queue_recorded_disposition: input.officialDisclosureReadiness.summary.corroboration_queue_with_recorded_disposition,
      official_disclosure_corroboration_queue_proposed_unknowns: input.officialDisclosureReadiness.summary.corroboration_queue_proposed_unknowns,
      official_disclosure_gaps: input.officialDisclosureReadiness.gaps.length,
      official_disclosure_p0_gaps: input.officialDisclosureReadiness.gaps.filter((gap) => gap.priority === "P0").length,
      official_disclosure_runnable_targets: input.officialDisclosureReadiness.summary.runnable_official_targets,
      official_disclosure_synced_targets: input.officialDisclosureReadiness.summary.synced_official_targets,
      official_disclosure_due_targets: input.officialDisclosureReadiness.summary.due_official_targets,
      official_disclosure_degraded_targets: input.officialDisclosureReadiness.summary.degraded_official_targets,
      official_disclosure_targets_with_observations: input.officialDisclosureReadiness.summary.official_targets_with_observations,
      official_disclosure_signal_review_candidates: input.officialDisclosureReadiness.summary.official_disclosure_signal_review_candidates,
      open_official_disclosure_signal_review_candidates: input.officialDisclosureReadiness.summary.open_official_disclosure_signal_review_candidates,
      official_disclosure_signal_dispositions: input.officialDisclosureReadiness.summary.official_disclosure_signal_dispositions,
      official_disclosure_signal_correlation_hints: input.officialDisclosureReadiness.summary.official_disclosure_signal_correlation_hints,
      open_official_disclosure_signal_correlation_hints: input.officialDisclosureReadiness.summary.open_official_disclosure_signal_correlation_hints,
      official_disclosure_gate1_overall_progress: input.officialDisclosureReadiness.scorecard.overall_progress,
      official_disclosure_gate1_data_progress: input.officialDisclosureReadiness.scorecard.data_progress,
      official_disclosure_gate1_source_path_progress: input.officialDisclosureReadiness.scorecard.source_path_progress,
      supply_chain_expansion_frontier_edges: input.supplyChainExpansionPlan.summary.frontier_edges,
      supply_chain_expansion_frontier_companies: input.supplyChainExpansionPlan.summary.frontier_companies,
      supply_chain_expansion_component_dependency_leads: input.supplyChainExpansionPlan.summary.component_dependency_leads,
      supply_chain_expansion_leads_with_source_path: input.supplyChainExpansionPlan.summary.leads_with_source_path,
      supply_chain_expansion_leads_with_fact_capable_source_path: input.supplyChainExpansionPlan.summary.leads_with_fact_capable_source_path,
      supply_chain_expansion_leads_with_observation_source_path: input.supplyChainExpansionPlan.summary.leads_with_observation_source_path,
      supply_chain_expansion_leads_with_lead_only_source_path: input.supplyChainExpansionPlan.summary.leads_with_lead_only_source_path,
      supply_chain_expansion_blocked_frontier_edges: input.supplyChainExpansionPlan.summary.blocked_frontier_edges,
      supply_chain_expansion_stop_conditions: input.supplyChainExpansionPlan.summary.stop_conditions,
      propagation_readiness_ready: input.propagationReadiness.summary.ready,
      propagation_readiness_partial: input.propagationReadiness.summary.partial,
      propagation_readiness_blocked: input.propagationReadiness.summary.blocked,
      propagation_contexts_with_observations: input.propagationReadiness.summary.contexts_with_observations,
      propagation_contexts_with_source_plan: input.propagationReadiness.summary.contexts_with_source_plan,
      propagation_contexts_with_component_leads: input.propagationReadiness.summary.contexts_with_component_leads,
      propagation_reasoning_inputs: input.propagationReadiness.summary.reasoning_inputs,
      gate1_data_depth_items: input.gate1DataDepthWorkbench.summary.items,
      gate1_data_depth_p0: input.gate1DataDepthWorkbench.summary.p0,
      gate1_data_depth_p1: input.gate1DataDepthWorkbench.summary.p1,
      gate1_data_depth_p2: input.gate1DataDepthWorkbench.summary.p2,
      gate1_data_depth_by_workstream: input.gate1DataDepthWorkbench.summary.by_workstream,
      gate1_data_depth_fact_edge_gap: input.gate1DataDepthWorkbench.summary.fact_edge_gap_to_target,
      gate1_data_depth_source_blockers: input.gate1DataDepthWorkbench.summary.source_blockers,
      gate1_data_depth_strength_missing_edges: input.gate1DataDepthWorkbench.summary.strength_missing_edges,
      gate1_data_depth_observation_labeling_batch: input.gate1DataDepthWorkbench.summary.observation_labeling_batch,
      gate1_data_depth_propagation_contexts_not_ready: input.gate1DataDepthWorkbench.summary.propagation_contexts_not_ready
    },
    claim_build: input.claimBuild,
    intelligence_refresh: input.intelligenceRefresh,
    component_risk_refresh: input.componentRiskRefresh,
    research_target_profile: researchPackTargetProfile(input.targetProfileSelection)
  };
}

export function emptyStaticDataQualitySummary(generatedAt: string): DataQualitySummary {
  return {
    checked_at: generatedAt,
    ok: true,
    counts: { error: 0, warn: 0, info: 0 },
    issues: []
  };
}

function researchPackTargetProfile(selection: ResearchTargetProfileSelection): ResearchPackTargetProfile | null {
  if (selection.profile === null) return null;
  return {
    profile_id: selection.profile.profile_id,
    title: selection.profile.title,
    version: selection.profile.version,
    description: selection.profile.description,
    selection_reason: selection.reason,
    target_nodes: selection.profile.target_nodes.length
  };
}

function countClaimConflicts(workbench: WorkbenchModel): number {
  return [...workbench.claims, ...workbench.draft_claims].filter((claim) => claim.conflict_state !== "none").length;
}

function countContradictingEvidenceLinks(workbench: WorkbenchModel): number {
  return [...workbench.claims, ...workbench.draft_claims].reduce(
    (count, claim) => count + claim.evidence_refs.filter((ref) => ref.role === "contradicting").length,
    0
  );
}

function countClaimLifecycleWarnings(workbench: WorkbenchModel): number {
  return [...workbench.claims, ...workbench.draft_claims].reduce((count, claim) => count + claim.lifecycle_warnings.length, 0);
}

function countSourceTargetPreflightIssueKinds(report: SourceTargetPreflightReport | null): Record<string, number> {
  if (report === null) return {};
  const counts: Record<string, number> = {};
  for (const summary of Object.values(report.summary.by_source_status)) {
    for (const [issueKind, count] of Object.entries(summary.issue_kinds)) {
      counts[issueKind] = (counts[issueKind] ?? 0) + count;
    }
  }
  const sorted: Record<string, number> = {};
  for (const [issueKind, count] of Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))) {
    sorted[issueKind] = count;
  }
  return sorted;
}
