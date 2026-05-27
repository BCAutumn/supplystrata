import type { ResearchPackManifest } from "./definitions.js";

export type ConsumerReadModelPolicy = "read_only_no_truth_store_mutation";

export interface ConsumerReadModel {
  schema_version: "1.0.0";
  contract_id: "gate8_lite_consumer_read_model.v0";
  generated_at: string;
  company: ConsumerCompanySummary;
  research_pack: ConsumerResearchPackSummary;
  chain: ConsumerChainSummary;
  changes: ConsumerChangesSummary;
  derived_context: ConsumerDerivedContextSummary;
  constraints: ConsumerConstraintContextSummary;
  unknowns: ConsumerUnknownSummary;
  next_actions: ConsumerNextActionSummary;
  source_monitoring: ConsumerSourceMonitoringSummary;
  policy: {
    read_policy: ConsumerReadModelPolicy;
    fact_mutation_allowed: false;
    intended_consumers: string[];
  };
}

export interface ConsumerCompanySummary {
  selected_company_id: string;
  name: string;
  visible_companies: number;
}

export interface ConsumerResearchPackSummary {
  mode: ResearchPackManifest["mode"];
  depth: number;
  components: string[];
  fact_edges: number;
  evidences: number;
  l4_l5_fact_edges: number;
  traceable_edges: number;
  cross_source_edges: number;
  corroboration_or_disposition_edges: number;
  readiness: {
    question_ready: number;
    question_partial: number;
    question_blocked: number;
    gate1_overall_progress: number;
    gate1_data_progress: number;
    gate1_source_path_progress: number;
  };
}

export interface ConsumerChainSummary {
  segments: number;
  upstream_edges: number;
  downstream_edges: number;
  component_ids: string[];
  counterparty_company_ids: string[];
}

export interface ConsumerChangesSummary {
  total: number;
  requires_attention: number;
  by_family: Record<string, number>;
  latest: ConsumerChangeItem[];
}

export interface ConsumerChangeItem {
  event_id: string;
  event_family: string;
  event_type: string;
  occurred_at: string;
  requires_attention: boolean;
  scope_kind: string | null;
  scope_id: string | null;
}

export interface ConsumerDerivedContextSummary {
  edge_strengths: number;
  edge_freshness: number;
  stale_edges: number;
  component_risk_scope: "component_global" | "not_refreshed";
  component_risk_global_edges: number;
  component_risk_visible_edges: number;
  component_risk_metrics: number;
  component_risk_changes: number;
}

export interface ConsumerConstraintContextSummary {
  policy_or_export_control_status: string;
  policy_or_export_control_sources: number;
  policy_or_export_control_observations: number;
  policy_or_export_control_missing_requirements: string[];
  truth_store_write_policy: "constraint_context_only_no_fact_mutation";
}

export interface ConsumerUnknownSummary {
  total: number;
  open: number;
  resolved: number;
  by_scope_kind: Record<string, number>;
  top_open: ConsumerUnknownItem[];
}

export interface ConsumerUnknownItem {
  unknown_id: string;
  scope_kind: string;
  scope_id: string;
  question: string;
}

export interface ConsumerNextActionSummary {
  total: number;
  p0: number;
  p1: number;
  p2: number;
  by_frontend_action: Record<string, number>;
  top_items: ConsumerNextActionItem[];
}

export interface ConsumerNextActionItem {
  item_id: string;
  priority: string;
  workstream: string;
  frontend_action_kind: string;
  title: string;
  recommended_action: string;
  write_impact: string;
  refs: string[];
}

export interface ConsumerSourceMonitoringSummary {
  expected_targets: number;
  synced_targets: number;
  not_synced: number;
  due_targets: number;
  active_jobs: number;
  degraded_targets: number;
  dead_targets: number;
  missing_credentials: number;
  invalid_config: number;
  source_unreachable: number;
  targets_with_observations: number;
  total_observations: number;
}
