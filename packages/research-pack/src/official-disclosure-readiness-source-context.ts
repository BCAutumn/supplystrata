import type {
  OfficialDisclosureNodeCoverageState,
  OfficialDisclosureNodeDraft,
  OfficialDisclosureNodeKind,
  OfficialDisclosureProfileExpansionCandidate,
  OfficialDisclosureReadinessEdge,
  OfficialDisclosureReadinessNode,
  OfficialDisclosureReadinessSourcePlanItem,
  OfficialDisclosureReadinessSourceTarget,
  OfficialDisclosureReadinessTargetNode
} from "./official-disclosure-readiness-definitions.js";
import { sourceTargetsForNode } from "./official-disclosure-source-targets.js";

const NODE_COVERAGE_ORDER = {
  missing: 0,
  official_source_planned: 1,
  official_target_runnable: 2,
  official_target_synced: 3,
  official_target_with_observation: 4,
  covered_fact: 5
} as const satisfies Record<OfficialDisclosureNodeCoverageState, number>;

const TARGET_PRIORITY_ORDER = {
  P0: 0,
  P1: 1,
  P2: 2
} as const satisfies Record<NonNullable<OfficialDisclosureReadinessNode["target_priority"]>, number>;

export { buildCorroborationQueue } from "./official-disclosure-corroboration-queue.js";
export {
  buildExpectedSourceCoverage,
  expectedSourceCoverageAction,
  expectedSourceHasCoverage,
  expectedSourceHasRunnablePath
} from "./official-disclosure-expected-source-coverage.js";
export { actionForOfficialTargets, summarizeOfficialSourcePlan, uniqueSourceTargets } from "./official-disclosure-source-targets.js";

export function buildNodeCoverageMatrix(input: {
  companies: readonly { entity_id: string; name: string }[];
  componentIds: readonly string[];
  targetNodes: readonly OfficialDisclosureReadinessTargetNode[];
  edges: readonly OfficialDisclosureReadinessEdge[];
  sourcePlanItems: readonly OfficialDisclosureReadinessSourcePlanItem[];
}): OfficialDisclosureReadinessNode[] {
  const nodes = new Map<string, OfficialDisclosureNodeDraft>();
  for (const targetNode of input.targetNodes) {
    mergeNode(nodes, targetNode.node_id, {
      node_kind: targetNode.node_kind,
      name: targetNode.name ?? null,
      is_target_node: true,
      target_priority: targetNode.priority ?? null,
      expected_source_ids: targetNode.expected_source_ids ?? []
    });
  }
  for (const company of input.companies) {
    mergeNode(nodes, company.entity_id, { node_kind: "company", name: company.name });
  }
  for (const componentId of input.componentIds) {
    mergeNode(nodes, componentId, { node_kind: "component", name: null });
  }
  for (const edge of input.edges) {
    mergeNode(nodes, edge.from_id, { node_kind: "company", name: edge.from_name });
    mergeNode(nodes, edge.to_id, { node_kind: "company", name: edge.to_name });
    if (edge.component_id !== null) mergeNode(nodes, edge.component_id, { node_kind: "component", name: null });
  }
  for (const item of input.sourcePlanItems) {
    for (const componentId of item.component_ids) mergeNode(nodes, componentId, { node_kind: "component", name: null });
    for (const targetId of item.target_ids) {
      mergeNode(nodes, targetId, { node_kind: nodeKindFromId(targetId), name: null });
    }
    for (const sourceTarget of item.source_targets) {
      if (sourceTarget.target_entity_id !== null) mergeNode(nodes, sourceTarget.target_entity_id, { node_kind: "company", name: null });
      if (sourceTarget.target_component_id !== null) mergeNode(nodes, sourceTarget.target_component_id, { node_kind: "component", name: null });
    }
  }
  return [...nodes.entries()]
    .map(([nodeId, node]) => {
      const factEdgeIds = factEdgeIdsForNode(nodeId, node.node_kind, input.edges);
      const sourcePlanItems = sourcePlanItemsForNode(nodeId, input.sourcePlanItems);
      const sourceTargets = sourcePlanItems.flatMap((item) => sourceTargetsForNode(nodeId, node.node_kind, item));
      return {
        node_id: nodeId,
        node_kind: node.node_kind,
        name: node.name,
        is_target_node: node.is_target_node,
        target_priority: node.target_priority,
        expected_source_ids: node.expected_source_ids,
        coverage_state: nodeCoverageState({ factEdgeIds, sourcePlanItems, sourceTargets }),
        fact_edge_ids: factEdgeIds,
        source_plan_refs: sourcePlanItems.map((item) => `source_plan:${item.source_id}`),
        source_targets: sourceTargets
      };
    })
    .sort(compareNodes);
}

export function buildProfileExpansionCandidates(input: {
  nodes: readonly OfficialDisclosureReadinessNode[];
  hasTargetProfile: boolean;
}): OfficialDisclosureProfileExpansionCandidate[] {
  if (!input.hasTargetProfile) return [];
  return input.nodes
    .filter((node) => !node.is_target_node)
    .filter((node) => node.coverage_state !== "missing")
    .map<OfficialDisclosureProfileExpansionCandidate>((node) => ({
      node_id: node.node_id,
      node_kind: node.node_kind,
      name: node.name,
      suggested_priority: node.fact_edge_ids.length > 0 ? "P1" : "P2",
      reason: profileExpansionReason(node),
      coverage_state: node.coverage_state,
      fact_edge_ids: node.fact_edge_ids,
      source_plan_refs: node.source_plan_refs,
      source_adapters: uniqueSorted(node.source_targets.map((target) => target.source_adapter_id))
    }))
    .sort(compareProfileExpansionCandidates);
}

function profileExpansionReason(node: OfficialDisclosureReadinessNode): string {
  if (node.fact_edge_ids.length > 0) return "Visible Level 4/5 fact coverage exists outside the current target profile.";
  if (node.source_targets.some((target) => target.synced === true)) return "A synced official source target exists outside the current target profile.";
  if (node.source_targets.some((target) => target.runnable)) return "A runnable official source target exists outside the current target profile.";
  return "An official source-plan path exists outside the current target profile.";
}

function factEdgeIdsForNode(nodeId: string, nodeKind: OfficialDisclosureNodeKind, edges: readonly OfficialDisclosureReadinessEdge[]): string[] {
  return edges
    .filter((edge) => {
      if (nodeKind === "company") return edge.from_id === nodeId || edge.to_id === nodeId;
      return edge.component_id === nodeId;
    })
    .map((edge) => edge.edge_id)
    .sort();
}

function sourcePlanItemsForNode(
  nodeId: string,
  sourcePlanItems: readonly OfficialDisclosureReadinessSourcePlanItem[]
): OfficialDisclosureReadinessSourcePlanItem[] {
  return sourcePlanItems.filter(
    (item) =>
      item.component_ids.includes(nodeId) ||
      item.target_ids.includes(nodeId) ||
      item.source_targets.some((target) => target.target_entity_id === nodeId || target.target_component_id === nodeId)
  );
}

function mergeNode(
  nodes: Map<string, OfficialDisclosureNodeDraft>,
  nodeId: string,
  next: {
    node_kind: OfficialDisclosureNodeKind;
    name: string | null;
    is_target_node?: boolean;
    target_priority?: "P0" | "P1" | "P2" | null;
    expected_source_ids?: readonly string[];
  }
): void {
  const current = nodes.get(nodeId);
  nodes.set(nodeId, {
    node_kind: current?.node_kind ?? next.node_kind,
    name: current?.name ?? next.name,
    is_target_node: current?.is_target_node === true || next.is_target_node === true,
    target_priority: current?.target_priority ?? next.target_priority ?? null,
    expected_source_ids: uniqueSorted([...(current?.expected_source_ids ?? []), ...(next.expected_source_ids ?? [])])
  });
}

function nodeKindFromId(nodeId: string): OfficialDisclosureNodeKind {
  return nodeId.startsWith("COMP-") ? "component" : "company";
}

function nodeCoverageState(input: {
  factEdgeIds: readonly string[];
  sourcePlanItems: readonly OfficialDisclosureReadinessSourcePlanItem[];
  sourceTargets: readonly OfficialDisclosureReadinessSourceTarget[];
}): OfficialDisclosureNodeCoverageState {
  if (input.factEdgeIds.length > 0) return "covered_fact";
  if (input.sourceTargets.some((target) => (target.observations ?? 0) > 0)) return "official_target_with_observation";
  if (input.sourceTargets.some((target) => target.synced === true)) return "official_target_synced";
  if (input.sourceTargets.some((target) => target.runnable)) return "official_target_runnable";
  if (input.sourceTargets.length > 0) return "official_source_planned";
  return "missing";
}

function compareNodes(left: OfficialDisclosureReadinessNode, right: OfficialDisclosureReadinessNode): number {
  return (
    nodeCoverageOrder(left.coverage_state) - nodeCoverageOrder(right.coverage_state) ||
    left.node_kind.localeCompare(right.node_kind) ||
    left.node_id.localeCompare(right.node_id)
  );
}

function nodeCoverageOrder(state: OfficialDisclosureNodeCoverageState): number {
  return NODE_COVERAGE_ORDER[state];
}

function compareProfileExpansionCandidates(left: OfficialDisclosureProfileExpansionCandidate, right: OfficialDisclosureProfileExpansionCandidate): number {
  return (
    priorityOrder(left.suggested_priority) - priorityOrder(right.suggested_priority) ||
    nodeCoverageOrder(left.coverage_state) - nodeCoverageOrder(right.coverage_state) ||
    left.node_kind.localeCompare(right.node_kind) ||
    left.node_id.localeCompare(right.node_id)
  );
}

function priorityOrder(priority: "P0" | "P1" | "P2"): number {
  return TARGET_PRIORITY_ORDER[priority];
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
