import type { ComponentDependencyCategory } from "@supplystrata/component-context";
import type { ObservationType } from "@supplystrata/core";
import type { ResearchSourcePurpose } from "@supplystrata/source-plan";

export type PropagationContextKind =
  | "demand_signal"
  | "capacity_expansion_signal"
  | "facility_construction_signal"
  | "equipment_installation_signal"
  | "process_material_consumption_signal"
  | "material_price_or_trade_signal"
  | "policy_or_export_control_signal";

export type PropagationReadinessStatus = "ready" | "partial" | "blocked";
export type PropagationReadinessPolicy = "reasoning_input_only_no_fact_mutation";

export interface PropagationReadinessReport {
  schema_version: "1.0.0";
  generated_at: string;
  company_id: string;
  summary: PropagationReadinessSummary;
  items: PropagationReadinessItem[];
}

export interface PropagationReadinessSummary {
  contexts_total: number;
  ready: number;
  partial: number;
  blocked: number;
  contexts_with_observations: number;
  contexts_with_source_plan: number;
  contexts_with_component_leads: number;
  reasoning_inputs: number;
  no_fact_mutation_policy: PropagationReadinessPolicy;
}

export interface PropagationReadinessItem {
  context_id: string;
  context_kind: PropagationContextKind;
  status: PropagationReadinessStatus;
  title: string;
  question: string;
  confidence: number;
  ready_signals: string[];
  missing_requirements: string[];
  observation_types: ObservationType[];
  observation_series_refs: string[];
  source_plan_refs: string[];
  component_dependency_refs: string[];
  frontier_refs: string[];
  component_ids: string[];
  material_or_process_refs: string[];
  policy: PropagationReadinessPolicy;
  rationale: string;
  action: string;
}

export interface PropagationContextRule {
  context_kind: PropagationContextKind;
  title: string;
  question: string;
  ready_observation_types: readonly ObservationType[];
  supporting_observation_types?: readonly ObservationType[];
  source_purposes?: readonly ResearchSourcePurpose[];
  source_ids?: readonly string[];
  dependency_categories?: readonly ComponentDependencyCategory[];
  component_id_prefixes?: readonly string[];
  frontier_required?: boolean;
  action_ready: string;
  action_partial: string;
  action_blocked: string;
}
