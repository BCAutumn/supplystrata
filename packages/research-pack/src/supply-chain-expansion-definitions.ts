import type { ComponentDependencyCategory } from "@supplystrata/component-context";
import type { SourcePlanItem } from "@supplystrata/source-plan";
import type { WorkbenchModel } from "@supplystrata/workbench-export";
import type { OfficialDisclosureReadinessReport } from "./official-disclosure-readiness.js";

export type SupplyChainExpansionState = "expand_candidate" | "needs_component_context" | "stop_depth_limit";
export type SupplyChainDependencyState = "fact_covered" | "source_path_runnable" | "source_path_planned" | "observation_layer_only" | "lead_only";
export type SupplyChainExpansionStopReason = "depth_limit" | "missing_component_context" | "catalog_boundary" | "observation_layer_boundary";

export interface SupplyChainExpansionPlan {
  schema_version: "1.0.0";
  generated_at: string;
  company_id: string;
  max_depth: number;
  summary: SupplyChainExpansionSummary;
  frontier: SupplyChainExpansionFrontierItem[];
  component_dependency_leads: SupplyChainComponentDependencyLead[];
  stop_conditions: SupplyChainExpansionStopCondition[];
}

export interface SupplyChainExpansionSummary {
  fact_edges_considered: number;
  frontier_edges: number;
  frontier_companies: number;
  component_dependency_leads: number;
  leads_with_fact_coverage: number;
  leads_with_source_path: number;
  lead_only_items: number;
  observation_layer_items: number;
  blocked_frontier_edges: number;
  stop_conditions: number;
  explicit_unknown_refs: number;
}

export interface SupplyChainExpansionFrontierItem {
  frontier_id: string;
  edge_id: string;
  path_depth: number;
  expansion_state: SupplyChainExpansionState;
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  next_company_id: string | null;
  next_company_name: string | null;
  relation: string;
  component_id: string | null;
  evidence_level: number;
  unknown_ids: string[];
  source_plan_refs: string[];
  rationale: string;
  action: string;
}

export interface SupplyChainComponentDependencyLead {
  lead_id: string;
  dependency_id: string;
  parent_component_id: string;
  target_kind: string;
  target_id: string;
  target_name: string;
  tier_depth: number;
  category: ComponentDependencyCategory;
  state: SupplyChainDependencyState;
  confidence: number;
  source_ids: string[];
  source_plan_refs: string[];
  supporting_edge_ids: string[];
  unknowns: string[];
  expansion_policy: "lead_only_no_fact_mutation";
  rationale: string;
  action: string;
}

export interface SupplyChainExpansionStopCondition {
  stop_id: string;
  reason: SupplyChainExpansionStopReason;
  scope_kind: "edge" | "component";
  scope_id: string;
  rationale: string;
  refs: string[];
}

export interface SupplyChainExpansionPlanInput {
  generated_at: string;
  company_id: string;
  workbench: Pick<WorkbenchModel, "selected_company_id" | "chain_segments" | "edges" | "unknown_items">;
  component_ids: readonly string[];
  source_plan: readonly SourcePlanItem[];
  official_disclosure_readiness?: OfficialDisclosureReadinessReport;
  max_depth?: number;
}
