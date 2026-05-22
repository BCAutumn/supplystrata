import { createHash } from "node:crypto";
import { listComponentUpstreamLeads, type ComponentDependencyCategory, type ComponentUpstreamLead } from "@supplystrata/component-context";
import type { SourcePlanItem } from "@supplystrata/source-plan";
import type { WorkbenchEdge, WorkbenchModel, WorkbenchUnknownItem } from "@supplystrata/workbench-export";
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

interface SourcePlanMatch {
  source_ids: string[];
  source_plan_refs: string[];
  has_runnable_target: boolean;
}

export function buildSupplyChainExpansionPlan(input: SupplyChainExpansionPlanInput): SupplyChainExpansionPlan {
  const maxDepth = normalizeMaxDepth(input.max_depth ?? 7);
  const l45Edges = input.workbench.edges.filter((edge) => edge.evidence_level >= 4).sort(compareEdges);
  const edgeDepths = edgeDepthMap(input.workbench.chain_segments);
  const unknownsByEdge = unknownsByEdgeId(input.workbench.unknown_items);
  const sourcePlanRefsByComponent = sourcePlanRefsByComponentId(input.source_plan);
  const frontier = l45Edges.map((edge) =>
    frontierItem(edge, {
      companyId: input.company_id,
      maxDepth,
      pathDepth: edgeDepths.get(edge.edge_id) ?? 1,
      unknowns: unknownsByEdge.get(edge.edge_id) ?? [],
      sourcePlanRefs: edge.component_id === null ? [] : (sourcePlanRefsByComponent.get(edge.component_id) ?? [])
    })
  );
  const componentIds = uniqueSorted([...input.component_ids, ...l45Edges.flatMap((edge) => (edge.component_id === null ? [] : [edge.component_id]))]);
  const leads = componentDependencyLeads({
    componentIds,
    edges: l45Edges,
    sourcePlan: input.source_plan,
    officialDisclosureReadiness: input.official_disclosure_readiness
  });
  const stopConditions = [...frontierStopConditions(frontier), ...componentStopConditions(leads)].sort((left, right) =>
    left.stop_id.localeCompare(right.stop_id)
  );

  return {
    schema_version: "1.0.0",
    generated_at: input.generated_at,
    company_id: input.company_id,
    max_depth: maxDepth,
    summary: expansionSummary({ l45Edges, frontier, leads, stopConditions }),
    frontier,
    component_dependency_leads: leads,
    stop_conditions: stopConditions
  };
}

export function renderSupplyChainExpansionPlanMarkdown(plan: SupplyChainExpansionPlan): string {
  const lines = [
    `# Supply Chain Expansion Plan ${plan.company_id}`,
    "",
    `Generated at: ${plan.generated_at}`,
    `Max depth: ${plan.max_depth}`,
    "",
    "This plan is a deterministic research planner. It does not create fact edges, evidence, claims, observations, or unknowns.",
    "",
    "## Summary",
    "",
    `- Fact edges considered: ${plan.summary.fact_edges_considered}`,
    `- Frontier edges: ${plan.summary.frontier_edges}; companies ${plan.summary.frontier_companies}; blocked ${plan.summary.blocked_frontier_edges}`,
    `- Component dependency leads: ${plan.summary.component_dependency_leads}; fact-covered ${plan.summary.leads_with_fact_coverage}; source-path ${plan.summary.leads_with_source_path}; lead-only ${plan.summary.lead_only_items}; observation-layer ${plan.summary.observation_layer_items}`,
    `- Stop conditions: ${plan.summary.stop_conditions}; explicit unknown refs ${plan.summary.explicit_unknown_refs}`,
    "",
    "## Frontier",
    ""
  ];
  if (plan.frontier.length === 0) {
    lines.push("No Level 4/5 fact edge frontier is available for recursive expansion.");
  } else {
    for (const item of plan.frontier.slice(0, 60)) {
      lines.push(`- ${item.expansion_state} ${item.edge_id}: ${item.from_name} -> ${item.to_name}`);
      lines.push(`  Depth: ${item.path_depth}; component=${item.component_id ?? "missing"}; next=${item.next_company_name ?? "none"}`);
      lines.push(`  Action: ${item.action}`);
      lines.push(`  Why: ${item.rationale}`);
      if (item.unknown_ids.length > 0) lines.push(`  Unknowns: ${item.unknown_ids.join(", ")}`);
      if (item.source_plan_refs.length > 0) lines.push(`  Source plan: ${item.source_plan_refs.slice(0, 10).join(", ")}`);
    }
  }

  lines.push("", "## Component Dependency Leads", "");
  if (plan.component_dependency_leads.length === 0) {
    lines.push("No component dependency taxonomy leads are available for the current frontier.");
  } else {
    for (const lead of plan.component_dependency_leads.slice(0, 80)) {
      lines.push(`- ${lead.state} ${lead.parent_component_id} -> ${lead.target_id} (${lead.target_name})`);
      lines.push(`  Category: ${lead.category}; tier=${lead.tier_depth}; confidence=${lead.confidence.toFixed(2)}`);
      lines.push(`  Policy: ${lead.expansion_policy}`);
      lines.push(`  Action: ${lead.action}`);
      lines.push(`  Why: ${lead.rationale}`);
      if (lead.supporting_edge_ids.length > 0) lines.push(`  Edges: ${lead.supporting_edge_ids.slice(0, 10).join(", ")}`);
      if (lead.source_plan_refs.length > 0) lines.push(`  Source plan: ${lead.source_plan_refs.slice(0, 10).join(", ")}`);
      if (lead.unknowns.length > 0) lines.push(`  Unknowns: ${lead.unknowns.join("; ")}`);
    }
  }

  lines.push("", "## Stop Conditions", "");
  if (plan.stop_conditions.length === 0) {
    lines.push("No deterministic stop condition was reached.");
  } else {
    for (const stop of plan.stop_conditions.slice(0, 80)) {
      lines.push(`- ${stop.reason} ${stop.scope_kind}:${stop.scope_id}`);
      lines.push(`  Why: ${stop.rationale}`);
      if (stop.refs.length > 0) lines.push(`  Refs: ${stop.refs.slice(0, 10).join(", ")}`);
    }
  }

  return lines.join("\n");
}

function frontierItem(
  edge: WorkbenchEdge,
  input: {
    companyId: string;
    maxDepth: number;
    pathDepth: number;
    unknowns: readonly WorkbenchUnknownItem[];
    sourcePlanRefs: readonly string[];
  }
): SupplyChainExpansionFrontierItem {
  const expansionState = frontierState(edge, input.pathDepth, input.maxDepth);
  const nextCompany = nextCompanyForEdge(edge, input.companyId);
  return {
    frontier_id: stableId("SCF", [edge.edge_id, String(input.pathDepth)]),
    edge_id: edge.edge_id,
    path_depth: input.pathDepth,
    expansion_state: expansionState,
    from_id: edge.from_id,
    from_name: edge.from_name,
    to_id: edge.to_id,
    to_name: edge.to_name,
    next_company_id: nextCompany.id,
    next_company_name: nextCompany.name,
    relation: edge.relation,
    component_id: edge.component_id,
    evidence_level: edge.evidence_level,
    unknown_ids: input.unknowns.map((unknown) => unknown.unknown_id).sort(),
    source_plan_refs: [...input.sourcePlanRefs].sort(),
    rationale: frontierRationale(edge, expansionState, input.pathDepth, input.maxDepth, input.unknowns),
    action: frontierAction(expansionState)
  };
}

function componentDependencyLeads(input: {
  componentIds: readonly string[];
  edges: readonly WorkbenchEdge[];
  sourcePlan: readonly SourcePlanItem[];
  officialDisclosureReadiness: OfficialDisclosureReadinessReport | undefined;
}): SupplyChainComponentDependencyLead[] {
  const factComponentIds = new Set(input.edges.flatMap((edge) => (edge.component_id === null ? [] : [edge.component_id])));
  const edgesByComponent = edgeIdsByComponentId(input.edges);
  const readinessSourceRefs = new Map(
    (input.officialDisclosureReadiness?.expected_source_coverage ?? []).map((coverage) => [
      `${coverage.node_id}\0${coverage.expected_source_id}`,
      coverage.coverage_state
    ])
  );
  const leads = new Map<string, SupplyChainComponentDependencyLead>();
  for (const componentId of input.componentIds) {
    for (const lead of listComponentUpstreamLeads(componentId, 3)) {
      const sourcePlanMatch = sourcePlanMatchForLead(input.sourcePlan, lead);
      leads.set(
        lead.dependency_id,
        componentDependencyLead(lead, {
          factCovered: factComponentIds.has(lead.target_id),
          supportingEdgeIds: edgesByComponent.get(lead.parent_component_id) ?? [],
          sourcePlanMatch,
          readinessSourceRefs
        })
      );
    }
  }
  return [...leads.values()].sort(compareComponentLeads);
}

function componentDependencyLead(
  lead: ComponentUpstreamLead,
  input: {
    factCovered: boolean;
    supportingEdgeIds: readonly string[];
    sourcePlanMatch: SourcePlanMatch;
    readinessSourceRefs: ReadonlyMap<string, string>;
  }
): SupplyChainComponentDependencyLead {
  const state = dependencyState(lead, input.factCovered, input.sourcePlanMatch);
  const sourceIds = uniqueSorted([...input.sourcePlanMatch.source_ids, ...sourceIdsFromReadiness(input.readinessSourceRefs, lead.target_id)]);
  return {
    lead_id: stableId("SCL", [lead.dependency_id, lead.parent_component_id, lead.target_id]),
    dependency_id: lead.dependency_id,
    parent_component_id: lead.parent_component_id,
    target_kind: lead.target_kind,
    target_id: lead.target_id,
    target_name: lead.target_name,
    tier_depth: lead.tier_depth,
    category: lead.category,
    state,
    confidence: lead.confidence,
    source_ids: sourceIds,
    source_plan_refs: input.sourcePlanMatch.source_plan_refs,
    supporting_edge_ids: [...input.supportingEdgeIds].sort(),
    unknowns: [...lead.unknowns].sort(),
    expansion_policy: "lead_only_no_fact_mutation",
    rationale: lead.summary,
    action: dependencyAction(state, lead)
  };
}

function dependencyState(lead: ComponentUpstreamLead, factCovered: boolean, sourcePlanMatch: SourcePlanMatch): SupplyChainDependencyState {
  if (factCovered) return "fact_covered";
  if (sourcePlanMatch.has_runnable_target) return "source_path_runnable";
  if (sourcePlanMatch.source_plan_refs.length > 0) return "source_path_planned";
  if (lead.category === "logistics") return "observation_layer_only";
  return "lead_only";
}

function frontierState(edge: WorkbenchEdge, pathDepth: number, maxDepth: number): SupplyChainExpansionState {
  if (pathDepth >= maxDepth) return "stop_depth_limit";
  if (edge.component_id === null) return "needs_component_context";
  return "expand_candidate";
}

function frontierRationale(
  edge: WorkbenchEdge,
  state: SupplyChainExpansionState,
  pathDepth: number,
  maxDepth: number,
  unknowns: readonly WorkbenchUnknownItem[]
): string {
  if (state === "stop_depth_limit") return `The current path depth ${pathDepth} reached the configured expansion limit ${maxDepth}.`;
  if (state === "needs_component_context") return "The fact edge lacks component semantics, so recursive expansion would become company-generic and noisy.";
  const unknownSuffix =
    unknowns.length === 0 ? "" : ` ${unknowns.length} explicit unknown item(s) remain attached to this edge and must stay visible during expansion.`;
  return `The Level ${edge.evidence_level} fact edge has component context and can seed the next research frontier.${unknownSuffix}`;
}

function frontierAction(state: SupplyChainExpansionState): string {
  if (state === "stop_depth_limit") return "Stop recursive expansion for this edge unless the caller raises max_depth after review.";
  if (state === "needs_component_context")
    return "Backfill component_id/component specificity from evidence before expanding the counterparty's supplier network.";
  return "Research the counterparty with the same evidence-first workflow, constrained to this edge's component/process context.";
}

function dependencyAction(state: SupplyChainDependencyState, lead: ComponentUpstreamLead): string {
  if (state === "fact_covered") return "Use existing Level 4/5 component fact coverage before scheduling more expansion.";
  if (state === "source_path_runnable")
    return "Run or sync the existing source-plan target, then keep outputs in review/observation paths until evidence supports a fact edge.";
  if (state === "source_path_planned") return "Turn the planned source path into a synced target before expecting data coverage.";
  if (state === "observation_layer_only")
    return "Collect route/trade/port observations as context; do not create company fact edges from logistics signals alone.";
  return `Review source suggestions (${lead.source_suggestions.join(", ")}) and add an auditable source-plan path if this lead is in scope.`;
}

function componentStopConditions(leads: readonly SupplyChainComponentDependencyLead[]): SupplyChainExpansionStopCondition[] {
  return leads
    .filter((lead) => lead.state === "observation_layer_only" || reachesCatalogBoundary(lead))
    .map((lead) => ({
      stop_id: stableId("SCS", [lead.lead_id, lead.state]),
      reason: lead.state === "observation_layer_only" ? "observation_layer_boundary" : "catalog_boundary",
      scope_kind: "component",
      scope_id: lead.target_id,
      rationale:
        lead.state === "observation_layer_only"
          ? "This dependency should remain in observation/lead layers because logistics signals do not prove company-specific cargo ownership."
          : "The current component-context catalog has no deeper deterministic upstream dependency for this target.",
      refs: [`dependency:${lead.dependency_id}`, ...lead.supporting_edge_ids.map((edgeId) => `edge:${edgeId}`)]
    }));
}

function frontierStopConditions(frontier: readonly SupplyChainExpansionFrontierItem[]): SupplyChainExpansionStopCondition[] {
  return frontier
    .filter((item) => item.expansion_state !== "expand_candidate")
    .map((item) => ({
      stop_id: stableId("SCS", [item.frontier_id, item.expansion_state]),
      reason: item.expansion_state === "stop_depth_limit" ? "depth_limit" : "missing_component_context",
      scope_kind: "edge",
      scope_id: item.edge_id,
      rationale: item.rationale,
      refs: [`edge:${item.edge_id}`, ...item.unknown_ids.map((unknownId) => `unknown:${unknownId}`)]
    }));
}

function reachesCatalogBoundary(lead: SupplyChainComponentDependencyLead): boolean {
  return lead.target_kind === "component" && listComponentUpstreamLeads(lead.target_id, 1).length === 0;
}

function expansionSummary(input: {
  l45Edges: readonly WorkbenchEdge[];
  frontier: readonly SupplyChainExpansionFrontierItem[];
  leads: readonly SupplyChainComponentDependencyLead[];
  stopConditions: readonly SupplyChainExpansionStopCondition[];
}): SupplyChainExpansionSummary {
  return {
    fact_edges_considered: input.l45Edges.length,
    frontier_edges: input.frontier.length,
    frontier_companies: uniqueSorted(input.frontier.flatMap((item) => (item.next_company_id === null ? [] : [item.next_company_id]))).length,
    component_dependency_leads: input.leads.length,
    leads_with_fact_coverage: input.leads.filter((lead) => lead.state === "fact_covered").length,
    leads_with_source_path: input.leads.filter((lead) => lead.state === "source_path_runnable" || lead.state === "source_path_planned").length,
    lead_only_items: input.leads.filter((lead) => lead.state === "lead_only").length,
    observation_layer_items: input.leads.filter((lead) => lead.state === "observation_layer_only").length,
    blocked_frontier_edges: input.frontier.filter((item) => item.expansion_state !== "expand_candidate").length,
    stop_conditions: input.stopConditions.length,
    explicit_unknown_refs: input.frontier.reduce((count, item) => count + item.unknown_ids.length, 0)
  };
}

function sourcePlanMatchForLead(sourcePlan: readonly SourcePlanItem[], lead: ComponentUpstreamLead): SourcePlanMatch {
  const matched = sourcePlan.filter(
    (item) =>
      item.trigger_dependency_ids.includes(lead.dependency_id) ||
      item.target_ids.includes(lead.target_id) ||
      item.parent_component_ids.includes(lead.parent_component_id)
  );
  return {
    source_ids: uniqueSorted(matched.map((item) => item.source_id)),
    source_plan_refs: uniqueSorted(matched.map((item) => `source_plan:${item.source_id}`)),
    has_runnable_target: matched.some((item) => item.suggested_check_targets.some((target) => target.runnable))
  };
}

function sourceIdsFromReadiness(readinessSourceRefs: ReadonlyMap<string, string>, targetId: string): string[] {
  return [...readinessSourceRefs.keys()].flatMap((key) => {
    const [nodeId, sourceId] = key.split("\0");
    return nodeId === targetId && sourceId !== undefined ? [sourceId] : [];
  });
}

function sourcePlanRefsByComponentId(sourcePlan: readonly SourcePlanItem[]): Map<string, string[]> {
  const refs = new Map<string, Set<string>>();
  for (const item of sourcePlan) {
    for (const componentId of [...item.parent_component_ids, ...item.target_ids].filter((id) => id.startsWith("COMP-"))) {
      const existing = refs.get(componentId) ?? new Set<string>();
      existing.add(`source_plan:${item.source_id}`);
      refs.set(componentId, existing);
    }
  }
  return new Map([...refs.entries()].map(([componentId, values]) => [componentId, [...values].sort()]));
}

function edgeDepthMap(segments: WorkbenchModel["chain_segments"]): Map<string, number> {
  const depths = new Map<string, number>();
  for (const segment of segments) {
    if (segment.semantic_layer === "edge" && segment.edge_id !== undefined) depths.set(segment.edge_id, segment.depth);
  }
  return depths;
}

function unknownsByEdgeId(unknowns: readonly WorkbenchUnknownItem[]): Map<string, WorkbenchUnknownItem[]> {
  const byEdge = new Map<string, WorkbenchUnknownItem[]>();
  for (const unknown of unknowns) {
    if (unknown.scope_kind !== "edge") continue;
    const current = byEdge.get(unknown.scope_id) ?? [];
    current.push(unknown);
    byEdge.set(unknown.scope_id, current);
  }
  return byEdge;
}

function edgeIdsByComponentId(edges: readonly WorkbenchEdge[]): Map<string, string[]> {
  const byComponent = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.component_id === null) continue;
    const current = byComponent.get(edge.component_id) ?? [];
    current.push(edge.edge_id);
    byComponent.set(edge.component_id, current);
  }
  return new Map([...byComponent.entries()].map(([componentId, edgeIds]) => [componentId, edgeIds.sort()]));
}

function nextCompanyForEdge(edge: WorkbenchEdge, rootCompanyId: string): { id: string | null; name: string | null } {
  if (edge.from_id === rootCompanyId) return { id: edge.to_id, name: edge.to_name };
  if (edge.to_id === rootCompanyId) return { id: edge.from_id, name: edge.from_name };
  return { id: edge.to_id, name: edge.to_name };
}

function stableId(prefix: string, parts: readonly string[]): string {
  const digest = createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16).toUpperCase();
  return `${prefix}-${digest}`;
}

function normalizeMaxDepth(value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`supply chain expansion max_depth must be a positive integer: ${value}`);
  return value;
}

function compareEdges(left: WorkbenchEdge, right: WorkbenchEdge): number {
  return left.edge_id.localeCompare(right.edge_id);
}

function compareComponentLeads(left: SupplyChainComponentDependencyLead, right: SupplyChainComponentDependencyLead): number {
  return (
    left.parent_component_id.localeCompare(right.parent_component_id) ||
    left.tier_depth - right.tier_depth ||
    left.target_name.localeCompare(right.target_name) ||
    left.dependency_id.localeCompare(right.dependency_id)
  );
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort((left, right) => left.localeCompare(right));
}
