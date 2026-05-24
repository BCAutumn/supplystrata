import {
  buildExpansionFrontier,
  compareEdges,
  componentDependencyLeads,
  componentStopConditions,
  expansionSummary,
  frontierStopConditions,
  normalizeMaxDepth,
  uniqueSorted
} from "./supply-chain-expansion-functions.js";
import type { SupplyChainExpansionPlan, SupplyChainExpansionPlanInput } from "./supply-chain-expansion-definitions.js";

export {
  type SupplyChainComponentDependencyLead,
  type SupplyChainDependencyState,
  type SupplyChainExpansionFrontierItem,
  type SupplyChainExpansionPlan,
  type SupplyChainExpansionPlanInput,
  type SupplyChainExpansionState,
  type SupplyChainExpansionStopCondition,
  type SupplyChainExpansionStopReason,
  type SupplyChainExpansionSummary
} from "./supply-chain-expansion-definitions.js";
export { renderSupplyChainExpansionPlanMarkdown } from "./supply-chain-expansion-render.js";

export function buildSupplyChainExpansionPlan(input: SupplyChainExpansionPlanInput): SupplyChainExpansionPlan {
  const maxDepth = normalizeMaxDepth(input.max_depth ?? 7);
  const l45Edges = input.workbench.edges.filter((edge) => edge.evidence_level >= 4).sort(compareEdges);
  const frontier = buildExpansionFrontier({
    companyId: input.company_id,
    maxDepth,
    edges: l45Edges,
    chainSegments: input.workbench.chain_segments,
    unknownItems: input.workbench.unknown_items,
    sourcePlan: input.source_plan
  });
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
