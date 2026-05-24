export type Gate1MainlinePhase =
  | "gate1_complete"
  | "increase_l4_l5_fact_edges"
  | "resolve_corroboration"
  | "run_official_source_targets"
  | "sync_official_source_targets"
  | "wire_expected_source_paths"
  | "expand_frontier_companies";

export type Gate1RunActionKind =
  | "sync_targets"
  | "enable_targets"
  | "run_due_targets"
  | "smoke_targets"
  | "review_observations"
  | "record_single_source_disposition"
  | "create_fact_edge_candidates"
  | "expand_frontier_company";

export interface Gate1RunLedger {
  schema_version: "1.0.0";
  generated_at: string;
  company_id: string;
  mainline_phase: Gate1MainlinePhase;
  phase_reason: string;
  scorecard: Gate1RunScorecard;
  data_progress: Gate1DataProgressLedger;
  source_path_progress: Gate1SourcePathProgressLedger;
  monitoring_config: Gate1MonitoringConfigLedger;
  action_queue: Gate1RunAction[];
  review_workbench: Gate1ReviewWorkbench;
  company_switching: Gate1CompanySwitchingLedger;
  guardrails: string[];
}

export interface Gate1RunScorecard {
  status: string;
  overall_progress: number;
  data_progress: number;
  source_path_progress: number;
  l4_l5_fact_edges: number;
  l4_l5_fact_edge_target: number;
  cross_source_ratio: number;
  cross_source_target: number;
  traceable_edges: number;
  traceable_edge_target: number;
}

export interface Gate1DataProgressLedger {
  l4_l5_fact_edges: number;
  l4_l5_fact_edge_target: number;
  fact_edge_gap: number;
  cross_source_edges: number;
  single_source_edges: number;
  corroboration_queue_items: number;
  corroboration_queue_with_runnable_targets: number;
  corroboration_queue_needing_disposition: number;
  corroboration_queue_recorded_disposition: number;
  proposed_single_source_unknowns: number;
  next_focus: string;
}

export interface Gate1SourcePathProgressLedger {
  expected_source_links: number;
  expected_source_links_with_coverage: number;
  expected_source_links_gap: number;
  runnable_targets: number;
  synced_targets: number;
  due_targets: number;
  degraded_targets: number;
  targets_with_observations: number;
  next_focus: string;
}

export interface Gate1RunAction {
  action_id: string;
  kind: Gate1RunActionKind;
  priority: "P0" | "P1" | "P2" | "P3";
  title: string;
  rationale: string;
  command_hint: string | null;
  refs: string[];
}

export interface Gate1MonitoringConfigLedger {
  config_surface: "source_policy_config";
  namespace: string;
  target_schedule_defaults: Gate1MonitoringTargetScheduleDefaults;
  configurable_fields: Gate1MonitoringConfigField[];
  batches: Gate1MonitoringBatch[];
  guardrails: string[];
}

export interface Gate1MonitoringTargetScheduleDefaults {
  enabled_on_sync: false;
  enable_after_review: true;
  check_cadence_minutes: number;
  jitter_minutes: number;
  max_attempts: number;
  backoff_base_minutes: number;
  backoff_max_minutes: number;
  next_check_at: null;
}

export interface Gate1MonitoringConfigField {
  field: keyof Omit<Gate1MonitoringTargetScheduleDefaults, "enabled_on_sync" | "enable_after_review">;
  label: string;
  unit: "minutes" | "count" | "iso_datetime_or_null";
  min: number | null;
  recommended: number | null;
  frontend_control: "number_input" | "datetime_input";
}

export interface Gate1MonitoringBatch {
  batch_id: "official_source_path" | "edge_corroboration";
  source_plan_ref: string;
  target_count: number;
  current_state: "not_synced" | "smoke_first" | "synced" | "due" | "observing";
  recommended_next_decision: Gate1ReviewDecision;
  preview_command_hint: string;
  sync_command_hint: string;
  enable_command_hint: string;
  run_due_command_hint: string;
}

export type Gate1ReviewItemKind = "source_target_batch" | "edge_corroboration" | "official_signal_disposition" | "frontier_company_research";

export type Gate1ReviewDecision =
  | "approve_smoke"
  | "approve_sync"
  | "approve_run_due"
  | "supports_existing_edge"
  | "needs_more_evidence"
  | "not_relevant"
  | "record_single_source_unknown"
  | "create_counterparty_source_target"
  | "open_frontier_research_pack"
  | "defer";

export type Gate1ReviewWriteEffect = "none" | "source_target_state_change" | "review_change_only" | "unknown_materialization_after_review";

export interface Gate1ReviewPolicy {
  review_policy: "review_only_no_fact_mutation";
  automatic_fact_mutation_allowed: false;
  allowed_edge_mutation: "none";
  requires_human_approval: boolean;
  automation_hint: "auto_rank_only" | "auto_prepare_command_only" | "auto_materialize_after_recorded_disposition";
}

export interface Gate1ReviewWorkbench {
  summary: {
    total_items: number;
    source_target_batch_items: number;
    edge_corroboration_items: number;
    official_signal_disposition_items: number;
    frontier_company_research_items: number;
    auto_ranked_items: number;
    human_approval_required_items: number;
  };
  items: Gate1ReviewItem[];
}

export interface Gate1ReviewItem {
  review_item_id: string;
  kind: Gate1ReviewItemKind;
  priority: "P0" | "P1" | "P2" | "P3";
  title: string;
  rationale: string;
  recommended_decision: Gate1ReviewDecision;
  allowed_decisions: Gate1ReviewDecision[];
  write_effect: Gate1ReviewWriteEffect;
  policy: Gate1ReviewPolicy;
  command_hint: string | null;
  refs: string[];
  edge_id: string | null;
  review_id: string | null;
  unknown_id: string | null;
  check_target_id: string | null;
}

export interface Gate1CompanySwitchingLedger {
  frontier_companies: number;
  next_research_targets: Gate1CompanyResearchTarget[];
  next_focus: string;
}

export interface Gate1CompanyResearchTarget {
  company_id: string;
  company_name: string;
  component_id: string;
  seed_edge_id: string;
  suggested_company_query: string;
  suggested_components: string[];
  command_hint: string;
  rationale: string;
  unknown_ids: string[];
}
