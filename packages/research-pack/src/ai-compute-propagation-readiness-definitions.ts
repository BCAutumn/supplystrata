export type AiComputePropagationLayerId =
  | "demand_to_compute"
  | "compute_to_server"
  | "server_to_board_materials"
  | "compute_to_fab_capacity"
  | "fab_to_construction"
  | "construction_to_equipment"
  | "equipment_to_process_inputs"
  | "process_to_raw_materials";

export type AiComputePropagationLayerStatus =
  | "covered_fact"
  | "observation_ready"
  | "official_target_runnable"
  | "lead_only"
  | "unknown_open"
  | "blocked_source";

export type AiComputePropagationPolicy = "reasoning_input_only_no_fact_mutation";

export type AiComputePropagationEvidenceLayerKind = "fact_edge" | "observation" | "lead" | "unknown" | "source_target" | "official_evidence_gap";

export interface AiComputePropagationEvidenceLayerSummary {
  layer_kind: AiComputePropagationEvidenceLayerKind;
  count: number;
  refs: string[];
  interpretation: string;
  allowed_research_outputs: string[];
  prohibited_truth_store_writes: string[];
}

export interface AiComputePropagationSourceTargetStatus {
  ref: string;
  source_adapter_id: string;
  target_kind: string | null;
  state: string | null;
  failure_kind: string | null;
  latest_event_type: string | null;
}

export interface AiComputePropagationSourceTargetStatusSummary {
  targets: number;
  runnable_targets: number;
  blocked_targets: number;
  degraded_targets: number;
  missing_credentials: number;
  source_failed_targets: number;
  by_state: Record<string, number>;
  by_failure_kind: Record<string, number>;
}

export interface AiComputePropagationSourceTargetReadinessAnswer extends AiComputePropagationSourceTargetStatusSummary {
  runnable_refs: string[];
  blocked_refs: string[];
  degraded_refs: string[];
  missing_credentials_refs: string[];
  source_failed_refs: string[];
}

export type AiComputePropagationSourceTargetGroupKind = "official_evidence" | "observation_proxy" | "entity_or_facility_context" | "lead_or_manual_review";

export interface AiComputePropagationSourceTargetGroup {
  group_kind: AiComputePropagationSourceTargetGroupKind;
  source_plan_refs: string[];
  source_target_refs: string[];
  source_adapters: string[];
  target_kinds: string[];
  states: string[];
  failure_kinds: string[];
}

export type AiComputePropagationNextResearchTargetKind = "company" | "component" | "material_or_process" | "source_group";

export interface AiComputePropagationNextResearchTarget {
  target_kind: AiComputePropagationNextResearchTargetKind;
  target_id: string;
  label: string;
  reason: string;
  refs: string[];
  action: string;
}

export type AiComputePropagationOfficialEvidenceGapKind =
  | "component_without_l4_l5_fact"
  | "material_or_process_without_l4_l5_fact"
  | "official_source_not_reviewed"
  | "official_source_blocked"
  | "observation_only";

export type AiComputePropagationOfficialEvidenceGapTargetKind = "component" | "material_or_process" | "source_group" | "layer";

export interface AiComputePropagationOfficialEvidenceGap {
  gap_kind: AiComputePropagationOfficialEvidenceGapKind;
  target_kind: AiComputePropagationOfficialEvidenceGapTargetKind;
  target_id: string;
  label: string;
  reason: string;
  refs: string[];
  recommended_action: string;
  truth_store_write_policy: "review_only_no_automatic_write";
}

export interface AiComputePropagationUnknownBacklogSeed {
  seed_id: string;
  question: string;
  why_unknown: string;
  target_scope_refs: string[];
  existing_unknown_refs: string[];
  source_plan_refs: string[];
  source_target_refs: string[];
  recommended_review_action: "create_explicit_unknown" | "keep_existing_unknown_open" | "repair_source_target" | "run_source_target";
  truth_store_write_policy: "review_only_no_automatic_write";
}

export interface AiComputePropagationUnknownBacklogSummary {
  existing_unknowns: number;
  seeds: number;
  by_recommended_review_action: Record<string, number>;
  target_scope_refs: string[];
  source_target_refs: string[];
  truth_store_write_policy: "review_only_no_automatic_write";
}

export type AiComputePropagationExecutionAction = "run_source_target" | "repair_source_target" | "review_intelligence_context" | "keep_unknown_open";
export type AiComputePropagationExecutionPriority = "P0" | "P1" | "P2";

export interface AiComputePropagationExecutionSourceTargetAction {
  source_target_ref: string;
  check_target_id: string | null;
  source_adapter_id: string;
  target_kind: string | null;
  state: string | null;
  failure_kind: string | null;
  latest_event_type: string | null;
  recommended_cli_command: string | null;
  writes_truth_store: boolean;
  requires_database: boolean;
}

export interface AiComputePropagationExecutionQueueItem {
  queue_item_id: string;
  action: AiComputePropagationExecutionAction;
  priority: AiComputePropagationExecutionPriority;
  title: string;
  reason: string;
  source_target_refs: string[];
  official_evidence_gap_refs: string[];
  unknown_refs: string[];
  next_research_refs: string[];
  source_target_actions: AiComputePropagationExecutionSourceTargetAction[];
  repair_reason: string | null;
  truth_store_write_policy: "review_only_no_automatic_write";
  automatic_fact_mutation_allowed: false;
}

export interface AiComputePropagationExecutionQueueSummary {
  items: number;
  run_source_target: number;
  repair_source_target: number;
  review_intelligence_context: number;
  keep_unknown_open: number;
  p0: number;
  p1: number;
  p2: number;
  runnable_source_targets: number;
  blocked_source_targets: number;
  unknown_refs: number;
}

export interface AiComputePropagationExecutionQueue {
  schema_version: "1.0.0";
  summary: AiComputePropagationExecutionQueueSummary;
  items: AiComputePropagationExecutionQueueItem[];
}

export interface AiComputePropagationLayerReadinessAnswers {
  fact_edges: {
    count: number;
    refs: string[];
  };
  non_fact_inputs: {
    observation_refs: string[];
    lead_refs: string[];
  };
  official_evidence: {
    gaps: number;
    by_gap_kind: Record<string, number>;
  };
  unknowns: AiComputePropagationUnknownBacklogSummary;
  next_research: {
    by_target_kind: Record<string, number>;
    target_refs: string[];
  };
  source_targets: AiComputePropagationSourceTargetReadinessAnswer;
  output_policy: {
    allowed_research_outputs: string[];
    prohibited_truth_store_writes: string[];
    truth_store_write_policy: AiComputePropagationPolicy;
  };
}

export interface AiComputePropagationReadinessMatrix {
  schema_version: "1.0.0";
  matrix_id: "ai_compute_propagation.v0";
  policy: AiComputePropagationPolicy;
  summary: AiComputePropagationReadinessSummary;
  layers: AiComputePropagationLayer[];
}

export interface AiComputePropagationReadinessSummary {
  layers_total: number;
  covered_fact: number;
  observation_ready: number;
  official_target_runnable: number;
  lead_only: number;
  unknown_open: number;
  blocked_source: number;
  layers_with_fact_refs: number;
  layers_with_observation_refs: number;
  layers_with_source_targets: number;
  layers_with_frontier_refs: number;
}

export interface AiComputePropagationLayer {
  layer_id: AiComputePropagationLayerId;
  title: string;
  question: string;
  status: AiComputePropagationLayerStatus;
  status_reason: string;
  readiness_answers: AiComputePropagationLayerReadinessAnswers;
  execution_queue: AiComputePropagationExecutionQueue;
  evidence_layer_summary: AiComputePropagationEvidenceLayerSummary[];
  component_ids: string[];
  material_or_process_refs: string[];
  fact_edge_refs: string[];
  observation_refs: string[];
  observation_series_refs: string[];
  source_plan_refs: string[];
  source_target_refs: string[];
  source_target_groups: AiComputePropagationSourceTargetGroup[];
  source_target_statuses: AiComputePropagationSourceTargetStatus[];
  source_target_status_summary: AiComputePropagationSourceTargetStatusSummary;
  next_research_targets: AiComputePropagationNextResearchTarget[];
  component_dependency_refs: string[];
  frontier_refs: string[];
  unknown_refs: string[];
  unknown_backlog_seeds: AiComputePropagationUnknownBacklogSeed[];
  unknown_backlog_summary: AiComputePropagationUnknownBacklogSummary;
  official_evidence_gaps: AiComputePropagationOfficialEvidenceGap[];
  missing_official_evidence: string[];
  allowed_research_outputs: string[];
  prohibited_truth_store_writes: string[];
  next_actions: string[];
  policy: AiComputePropagationPolicy;
}
