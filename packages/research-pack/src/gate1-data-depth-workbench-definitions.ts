import type { SourceTargetCoverageState } from "@supplystrata/source-monitor";

export type Gate1DataDepthWorkstream =
  | "fact_edge_growth"
  | "counterparty_corroboration"
  | "source_blocker"
  | "strength_context"
  | "observation_calibration"
  | "propagation_context";

export type Gate1DataDepthPriority = "P0" | "P1" | "P2";
export type Gate1DataDepthReviewPolicy = "review_only_no_fact_mutation";
export type Gate1DataDepthActionBatchKind = "p0" | "source_blockers" | "labeling" | "corroboration" | "intelligence_context";
export type Gate1DataDepthFrontendActionKind =
  | "run_frontier_research"
  | "repair_source_target"
  | "label_observation_sample"
  | "review_counterparty_corroboration"
  | "review_intelligence_context";
export type Gate1DataDepthReviewDecision =
  | "sync_or_enable_source_target"
  | "rerun_source_check"
  | "record_observation_label"
  | "record_corroboration_disposition"
  | "keep_unknown_open"
  | "run_recursive_company_research"
  | "defer";

export interface Gate1DataDepthActionBatchDefinition {
  kind: Gate1DataDepthActionBatchKind;
  file_name: string;
  description: string;
  priorities?: readonly Gate1DataDepthPriority[];
  workstreams?: readonly Gate1DataDepthWorkstream[];
}

export interface Gate1DataDepthActionBatch {
  schema_version: "1.0.0";
  generated_at: string;
  company_id: string;
  batch_kind: Gate1DataDepthActionBatchKind;
  review_policy: Gate1DataDepthReviewPolicy;
  automatic_fact_mutation_allowed: false;
  summary: {
    items: number;
    p0: number;
    p1: number;
    p2: number;
    source_targets: number;
    edge_refs: number;
    component_refs: number;
    by_workstream: Record<Gate1DataDepthWorkstream, number>;
    by_source_adapter: Record<string, number>;
  };
  items: Gate1DataDepthWorkbenchItem[];
}

export interface Gate1DataDepthWorkbench {
  schema_version: "1.0.0";
  generated_at: string;
  company_id: string;
  summary: Gate1DataDepthSummary;
  items: Gate1DataDepthWorkbenchItem[];
}

export interface Gate1DataDepthSummary {
  items: number;
  p0: number;
  p1: number;
  p2: number;
  by_workstream: Record<Gate1DataDepthWorkstream, number>;
  fact_edge_gap_to_target: number;
  fact_edge_target: number;
  l4_l5_fact_edges: number;
  cross_source_edges: number;
  corroboration_or_disposition_edges: number;
  source_blockers: number;
  strength_missing_edges: number;
  observation_labeling_batch: number;
  propagation_contexts_not_ready: number;
}

export interface Gate1DataDepthWorkbenchItem {
  item_id: string;
  workstream: Gate1DataDepthWorkstream;
  priority: Gate1DataDepthPriority;
  frontend_action_kind: Gate1DataDepthFrontendActionKind;
  title: string;
  rationale: string;
  recommended_action: string;
  recommended_decision: Gate1DataDepthReviewDecision;
  allowed_decisions: Gate1DataDepthReviewDecision[];
  write_impact: string;
  command_hints: Gate1DataDepthCommandHint[];
  review_policy: Gate1DataDepthReviewPolicy;
  automatic_fact_mutation_allowed: false;
  refs: string[];
  edge_ids: string[];
  component_ids: string[];
  source_adapters: string[];
  source_targets: Gate1DataDepthSourceTargetRef[];
}

export interface Gate1DataDepthCommandHint {
  label: string;
  command: string;
  writes_truth_store: boolean;
  requires_database: boolean;
}

export interface Gate1DataDepthSourceTargetRef {
  check_target_id: string | null;
  source_adapter_id: string;
  target_kind: string;
  state: SourceTargetCoverageState | string | null;
  latest_event_type: string | null;
  failure_kind: string | null;
  observations: number | null;
  target_entity_id: string | null;
  target_component_id: string | null;
}
