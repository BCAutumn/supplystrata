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
  action_queue: Gate1RunAction[];
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
