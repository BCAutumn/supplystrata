import { createHash } from "node:crypto";
import { listComponentUpstreamLeads, type ComponentUpstreamLead } from "@supplystrata/component-context";
import type { PlannedOutputLayer, SourcePlanItem, SourceRelationPolicy } from "@supplystrata/source-plan";
import type { WorkbenchEdge, WorkbenchModel, WorkbenchUnknownItem } from "@supplystrata/workbench-export";
import type { OfficialDisclosureReadinessReport } from "./official-disclosure-readiness.js";
import type {
  SupplyChainComponentDependencyLead,
  SupplyChainDependencyState,
  SupplyChainExpansionFrontierItem,
  SupplyChainExpansionState,
  SupplyChainSourcePathAuthority,
  SupplyChainExpansionStopReason,
  SupplyChainExpansionStopCondition,
  SupplyChainExpansionSummary
} from "./supply-chain-expansion-definitions.js";

interface SourcePlanMatch {
  source_ids: string[];
  source_plan_refs: string[];
  relation_policies: SourceRelationPolicy[];
  output_layers: PlannedOutputLayer[];
  has_runnable_target: boolean;
}

type DependencyStateRule = {
  state: SupplyChainDependencyState;
  matches: (input: { lead: ComponentUpstreamLead; factCovered: boolean; sourcePlanMatch: SourcePlanMatch }) => boolean;
};

type FrontierStateRule = {
  state: SupplyChainExpansionState;
  matches: (input: { edge: WorkbenchEdge; pathDepth: number; maxDepth: number }) => boolean;
};

const DEPENDENCY_STATE_RULES = [
  {
    state: "fact_covered",
    matches: (input) => input.factCovered
  },
  {
    state: "source_path_runnable",
    matches: (input) => input.sourcePlanMatch.has_runnable_target
  },
  {
    state: "source_path_planned",
    matches: (input) => input.sourcePlanMatch.source_plan_refs.length > 0
  },
  {
    state: "observation_layer_only",
    matches: (input) => input.lead.category === "logistics"
  }
] as const satisfies readonly DependencyStateRule[];

const FRONTIER_STATE_RULES = [
  {
    state: "stop_depth_limit",
    matches: (input) => input.pathDepth >= input.maxDepth
  },
  {
    state: "needs_component_context",
    matches: (input) => input.edge.component_id === null
  }
] as const satisfies readonly FrontierStateRule[];

const FRONTIER_ACTIONS = {
  stop_depth_limit: "Stop recursive expansion for this edge unless the caller raises max_depth after review.",
  needs_component_context: "Backfill component_id/component specificity from evidence before expanding the counterparty's supplier network.",
  expand_candidate: "Research the counterparty with the same evidence-first workflow, constrained to this edge's component/process context."
} as const satisfies Record<SupplyChainExpansionState, string>;

const FRONTIER_STOP_REASONS = {
  stop_depth_limit: "depth_limit",
  needs_component_context: "missing_component_context"
} as const satisfies Record<Exclude<SupplyChainExpansionState, "expand_candidate">, SupplyChainExpansionStopReason>;

const COMPONENT_STOP_RULES = {
  observation_layer_only: {
    reason: "observation_layer_boundary",
    rationale: "This dependency should remain in observation/lead layers because logistics signals do not prove company-specific cargo ownership."
  },
  catalog_boundary: {
    reason: "catalog_boundary",
    rationale: "The current component-context catalog has no deeper deterministic upstream dependency for this target."
  }
} as const satisfies Record<
  "observation_layer_only" | "catalog_boundary",
  {
    reason: SupplyChainExpansionStopReason;
    rationale: string;
  }
>;

export function buildExpansionFrontier(input: {
  companyId: string;
  maxDepth: number;
  edges: readonly WorkbenchEdge[];
  chainSegments: WorkbenchModel["chain_segments"];
  unknownItems: readonly WorkbenchUnknownItem[];
  sourcePlan: readonly SourcePlanItem[];
}): SupplyChainExpansionFrontierItem[] {
  const edgeDepths = edgeDepthMap(input.chainSegments);
  const unknownsByEdge = unknownsByEdgeId(input.unknownItems);
  const sourcePlanRefsByComponent = sourcePlanRefsByComponentId(input.sourcePlan);
  return input.edges.map((edge) =>
    frontierItem(edge, {
      companyId: input.companyId,
      maxDepth: input.maxDepth,
      pathDepth: edgeDepths.get(edge.edge_id) ?? 1,
      unknowns: unknownsByEdge.get(edge.edge_id) ?? [],
      sourcePlanRefs: edge.component_id === null ? [] : (sourcePlanRefsByComponent.get(edge.component_id) ?? [])
    })
  );
}

export function componentDependencyLeads(input: {
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

export function componentStopConditions(leads: readonly SupplyChainComponentDependencyLead[]): SupplyChainExpansionStopCondition[] {
  return leads.filter((lead) => lead.state === "observation_layer_only" || reachesCatalogBoundary(lead)).map((lead) => componentStopCondition(lead));
}

export function frontierStopConditions(frontier: readonly SupplyChainExpansionFrontierItem[]): SupplyChainExpansionStopCondition[] {
  return frontier
    .filter((item) => item.expansion_state !== "expand_candidate")
    .map((item) => ({
      stop_id: stableId("SCS", [item.frontier_id, item.expansion_state]),
      reason: frontierStopReason(item.expansion_state),
      scope_kind: "edge",
      scope_id: item.edge_id,
      rationale: item.rationale,
      refs: [`edge:${item.edge_id}`, ...item.unknown_ids.map((unknownId) => `unknown:${unknownId}`)]
    }));
}

export function expansionSummary(input: {
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
    leads_with_fact_capable_source_path: input.leads.filter((lead) => lead.source_path_authority === "fact_capable").length,
    leads_with_observation_source_path: input.leads.filter((lead) => lead.source_path_authority === "observation_only").length,
    leads_with_lead_only_source_path: input.leads.filter((lead) => lead.source_path_authority === "lead_only").length,
    lead_only_items: input.leads.filter((lead) => lead.state === "lead_only").length,
    observation_layer_items: input.leads.filter((lead) => lead.state === "observation_layer_only").length,
    blocked_frontier_edges: input.frontier.filter((item) => item.expansion_state !== "expand_candidate").length,
    stop_conditions: input.stopConditions.length,
    explicit_unknown_refs: input.frontier.reduce((count, item) => count + item.unknown_ids.length, 0)
  };
}

export function normalizeMaxDepth(value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`supply chain expansion max_depth must be a positive integer: ${value}`);
  return value;
}

export function compareEdges(left: WorkbenchEdge, right: WorkbenchEdge): number {
  return left.edge_id.localeCompare(right.edge_id);
}

export function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort((left, right) => left.localeCompare(right));
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
  const sourcePathAuthority = sourcePathAuthorityFor(input.sourcePlanMatch.relation_policies);
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
    source_relation_policies: input.sourcePlanMatch.relation_policies,
    source_output_layers: input.sourcePlanMatch.output_layers,
    source_path_authority: sourcePathAuthority,
    supporting_edge_ids: [...input.supportingEdgeIds].sort(),
    unknowns: [...lead.unknowns].sort(),
    expansion_policy: "lead_only_no_fact_mutation",
    rationale: lead.summary,
    action: dependencyAction(state, lead, sourcePathAuthority)
  };
}

function dependencyState(lead: ComponentUpstreamLead, factCovered: boolean, sourcePlanMatch: SourcePlanMatch): SupplyChainDependencyState {
  return DEPENDENCY_STATE_RULES.find((rule) => rule.matches({ lead, factCovered, sourcePlanMatch }))?.state ?? "lead_only";
}

function frontierState(edge: WorkbenchEdge, pathDepth: number, maxDepth: number): SupplyChainExpansionState {
  return FRONTIER_STATE_RULES.find((rule) => rule.matches({ edge, pathDepth, maxDepth }))?.state ?? "expand_candidate";
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
  return FRONTIER_ACTIONS[state];
}

function dependencyAction(state: SupplyChainDependencyState, lead: ComponentUpstreamLead, authority: SupplyChainSourcePathAuthority): string {
  if (state === "fact_covered") return "Use existing Level 4/5 component fact coverage before scheduling more expansion.";
  if (state === "source_path_runnable") {
    if (authority === "fact_capable") return "Run or sync the official source-plan target, then review evidence before creating any fact edge.";
    if (authority === "observation_only") return "Run or sync the observation-only source-plan target as context; do not create a company fact edge from it.";
    if (authority === "lead_only") return "Run or sync the lead-only target as a review queue input; require stronger evidence before fact mutation.";
    return "Run or sync the existing source-plan target, then keep outputs in review/observation paths until evidence supports a fact edge.";
  }
  if (state === "source_path_planned") {
    if (authority === "fact_capable") return "Turn the planned official source path into a synced target before expecting auditable relation evidence.";
    if (authority === "observation_only") return "Turn the planned observation source path into a synced target before expecting context coverage.";
    return "Turn the planned source path into a synced target before expecting data coverage.";
  }
  if (state === "observation_layer_only")
    return "Collect route/trade/port observations as context; do not create company fact edges from logistics signals alone.";
  return `Review source suggestions (${lead.source_suggestions.join(", ")}) and add an auditable source-plan path if this lead is in scope.`;
}

function componentStopCondition(lead: SupplyChainComponentDependencyLead): SupplyChainExpansionStopCondition {
  const rule = lead.state === "observation_layer_only" ? COMPONENT_STOP_RULES.observation_layer_only : COMPONENT_STOP_RULES.catalog_boundary;
  return {
    stop_id: stableId("SCS", [lead.lead_id, lead.state]),
    reason: rule.reason,
    scope_kind: "component",
    scope_id: lead.target_id,
    rationale: rule.rationale,
    refs: [`dependency:${lead.dependency_id}`, ...lead.supporting_edge_ids.map((edgeId) => `edge:${edgeId}`)]
  };
}

function frontierStopReason(state: SupplyChainExpansionState): SupplyChainExpansionStopReason {
  if (state === "expand_candidate") throw new Error("expand_candidate frontier items do not produce stop conditions");
  return FRONTIER_STOP_REASONS[state];
}

function reachesCatalogBoundary(lead: SupplyChainComponentDependencyLead): boolean {
  return lead.target_kind === "component" && listComponentUpstreamLeads(lead.target_id, 1).length === 0;
}

function sourcePlanMatchForLead(sourcePlan: readonly SourcePlanItem[], lead: ComponentUpstreamLead): SourcePlanMatch {
  const matched = sourcePlan.filter(
    (item) =>
      item.trigger_dependency_ids.includes(lead.dependency_id) || item.target_ids.includes(lead.target_id) || item.parent_component_ids.includes(lead.target_id)
  );
  return {
    source_ids: uniqueSorted(matched.map((item) => item.source_id)),
    source_plan_refs: uniqueSorted(matched.map((item) => `source_plan:${item.source_id}`)),
    relation_policies: uniqueSorted(matched.map((item) => item.relation_policy)),
    output_layers: uniqueSorted(matched.map((item) => item.expected_output_layer)),
    has_runnable_target: matched.some((item) => item.suggested_check_targets.some((target) => target.runnable))
  };
}

function sourcePathAuthorityFor(policies: readonly SourceRelationPolicy[]): SupplyChainSourcePathAuthority {
  if (policies.length === 0) return "none";
  if (policies.includes("can_create_fact_edge")) return "fact_capable";
  if (policies.length > 1) return "mixed";
  const policy = policies[0];
  if (policy === "observation_only" || policy === "lead_only" || policy === "entity_only") return policy;
  return "mixed";
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

function compareComponentLeads(left: SupplyChainComponentDependencyLead, right: SupplyChainComponentDependencyLead): number {
  return (
    left.parent_component_id.localeCompare(right.parent_component_id) ||
    left.tier_depth - right.tier_depth ||
    left.target_name.localeCompare(right.target_name) ||
    left.dependency_id.localeCompare(right.dependency_id)
  );
}
