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

export interface AiComputePropagationSourceTargetStatus {
  ref: string;
  source_adapter_id: string;
  state: string | null;
  failure_kind: string | null;
  latest_event_type: string | null;
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
  component_ids: string[];
  material_or_process_refs: string[];
  fact_edge_refs: string[];
  observation_refs: string[];
  observation_series_refs: string[];
  source_plan_refs: string[];
  source_target_refs: string[];
  source_target_statuses: AiComputePropagationSourceTargetStatus[];
  component_dependency_refs: string[];
  frontier_refs: string[];
  unknown_refs: string[];
  missing_official_evidence: string[];
  allowed_research_outputs: string[];
  prohibited_truth_store_writes: string[];
  next_actions: string[];
  policy: AiComputePropagationPolicy;
}
