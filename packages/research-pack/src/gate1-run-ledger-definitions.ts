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
  | "wait_for_scheduled_targets"
  | "smoke_targets"
  | "investigate_source_failures"
  | "review_observations"
  | "record_single_source_disposition"
  | "record_official_signal_dispositions"
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
  propagation_execution: Gate1PropagationExecutionLedger;
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
  fact_edge_scope: string;
  l4_l5_fact_edges: number;
  l4_l5_fact_edge_target: number;
  cross_source_ratio: number;
  cross_source_target: number;
  traceable_edges: number;
  traceable_edge_target: number;
}

export interface Gate1DataProgressLedger {
  fact_edge_scope: string;
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
  official_signal_correlation_hints: number;
  open_official_signal_correlation_hints: number;
  next_focus: string;
}

export interface Gate1SourcePathProgressLedger {
  expected_source_links: number;
  expected_source_links_with_coverage: number;
  expected_source_links_gap: number;
  runnable_targets: number;
  synced_targets: number;
  enabled_targets: number;
  due_targets: number;
  active_jobs: number;
  retry_wait_targets: number;
  degraded_targets: number;
  dead_targets: number;
  source_failed_targets: number;
  source_failure_kinds: Record<string, number>;
  targets_with_observations: number;
  next_focus: string;
}

export interface Gate1PropagationExecutionLedger {
  summary: Gate1PropagationExecutionSummary;
  layers: Gate1PropagationExecutionLayer[];
  next_focus: string;
  guardrails: string[];
}

export interface Gate1PropagationExecutionSummary {
  layers: number;
  queue_items: number;
  run_source_target: number;
  repair_source_target: number;
  review_intelligence_context: number;
  keep_unknown_open: number;
  runnable_source_targets: number;
  blocked_source_targets: number;
  unknown_refs: number;
  p0: number;
  p1: number;
  p2: number;
}

export interface Gate1PropagationExecutionLayer {
  layer_id: string;
  title: string;
  status: string;
  queue_items: number;
  run_source_target: number;
  repair_source_target: number;
  review_intelligence_context: number;
  keep_unknown_open: number;
  runnable_source_targets: number;
  blocked_source_targets: number;
  unknown_refs: number;
  queue_item_refs: string[];
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
  current_state: Gate1MonitoringCurrentState;
  recommended_next_decision: Gate1ReviewDecision;
  recommended_operational_action: Gate1MonitoringOperationalAction;
  state_counts: Gate1MonitoringStateCounts;
  attention_hint: string | null;
  preview_command_hint: string;
  sync_command_hint: string;
  enable_command_hint: string;
  run_due_command_hint: string;
}

export type Gate1MonitoringCurrentState =
  | "not_synced"
  | "smoke_first"
  | "disabled"
  | "synced"
  | "due"
  | "active_job"
  | "retry_wait"
  | "degraded"
  | "dead"
  | "observing";

export type Gate1MonitoringOperationalAction =
  | "sync_targets"
  | "smoke_targets"
  | "enable_targets"
  | "run_due_targets"
  | "wait_for_jobs"
  | "investigate_source_failure"
  | "review_observations"
  | "none";

export interface Gate1MonitoringStateCounts {
  not_synced: number;
  disabled: number;
  synced: number;
  enabled: number;
  due: number;
  active_jobs: number;
  retry_wait: number;
  degraded: number;
  dead: number;
  source_failed: number;
  targets_with_observations: number;
  preflight_failed: number;
  missing_credentials: number;
  invalid_config: number;
  source_unreachable: number;
  rate_limited: number;
  adapter_error: number;
  unknown_failure: number;
}

export type Gate1ReviewItemKind =
  | "source_target_batch"
  | "edge_corroboration"
  | "official_signal_disposition"
  | "entity_affiliation_disposition"
  | "frontier_company_research";

export type Gate1ReviewDecision =
  | "approve_smoke"
  | "approve_sync"
  | "approve_enable"
  | "approve_run_due"
  | "supports_existing_edge"
  | "needs_more_evidence"
  | "not_relevant"
  | "record_single_source_unknown"
  | "create_counterparty_source_target"
  | "review_entity_affiliation"
  | "research_parent_entity"
  | "research_child_entity"
  | "research_both_scopes"
  | "keep_unknown_open"
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
    entity_affiliation_disposition_items: number;
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
  scope_kind: "direct_frontier_company" | "affiliation_parent_entity";
  source_entity_id: string;
  source_entity_name: string;
  entity_context_id: string | null;
  suggested_company_query: string;
  suggested_components: string[];
  command_hint: string;
  rationale: string;
  unknown_ids: string[];
}
