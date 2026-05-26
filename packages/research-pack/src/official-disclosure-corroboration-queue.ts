import { createHash } from "node:crypto";
import type {
  OfficialDisclosureCorroborationDisposition,
  OfficialDisclosureCorroborationQueueItem,
  OfficialDisclosureEdgeCorroborationDispositionSummary,
  OfficialDisclosureProposedUnknown,
  OfficialDisclosureNodeCoverageState,
  OfficialDisclosureReadinessEdge,
  OfficialDisclosureReadinessNode,
  OfficialDisclosureReadinessSourceTarget
} from "./official-disclosure-readiness-definitions.js";
import { actionForOfficialTargets, uniqueSourceTargets } from "./official-disclosure-source-targets.js";

type CorroborationPriority = OfficialDisclosureCorroborationQueueItem["priority"];

const DISPOSITION_REASONS = {
  needs_traceability_backfill: "This Level 4/5 edge has no active official evidence visible in the pack.",
  needs_counterparty_check: "A non-edge official source path exists for one of the counterparties/components and should be checked before disposition.",
  needs_counterparty_source_target:
    "The target profile names candidate official sources, but this edge does not yet have a concrete counterparty source target.",
  single_source_disposition_recorded:
    "A linked explicit unknown records that no profile-backed second-source path is currently visible; keep it reviewable instead of treating silence as corroboration.",
  needs_explicit_single_source_disposition:
    "No profile-backed second-source path is visible; silence must be captured as an explicit single-source disposition or unknown."
} as const satisfies Record<OfficialDisclosureCorroborationDisposition, string>;

const DISPOSITION_ACTIONS = {
  needs_traceability_backfill: () => "Backfill active official evidence and trace context before attempting corroboration.",
  needs_counterparty_check: (input) =>
    `${actionForOfficialTargets(input.sourceTargets)} If the counterparty source confirms the relation, add it through evidence review; if not, keep an explicit single-source disposition.`,
  needs_counterparty_source_target: () =>
    "Create node-specific source-plan targets for the candidate official sources, then run them before changing corroboration state.",
  single_source_disposition_recorded: () =>
    "Review the linked or proposed single-source disposition unknown during research updates; do not count it as cross-source corroboration.",
  needs_explicit_single_source_disposition: (input) => {
    const suffix = input.proposedUnknown === null ? "" : ` Proposed unknown: ${input.proposedUnknown.unknown_id}.`;
    return `Record an explicit single-source unknown/disposition so the edge is not silently treated as corroborated.${suffix}`;
  }
} as const satisfies Record<
  OfficialDisclosureCorroborationDisposition,
  (input: { sourceTargets: readonly OfficialDisclosureReadinessSourceTarget[]; proposedUnknown: OfficialDisclosureProposedUnknown | null }) => string
>;

const NODE_COVERAGE_ORDER = {
  missing: 0,
  official_source_planned: 1,
  official_target_runnable: 2,
  official_target_synced: 3,
  official_target_with_observation: 4,
  covered_fact: 5
} as const satisfies Record<OfficialDisclosureNodeCoverageState, number>;

const CORROBORATION_DISPOSITION_ORDER = {
  needs_traceability_backfill: 0,
  needs_counterparty_check: 1,
  needs_counterparty_source_target: 2,
  needs_explicit_single_source_disposition: 3,
  single_source_disposition_recorded: 4
} as const satisfies Record<OfficialDisclosureCorroborationDisposition, number>;

const CORROBORATION_PRIORITY_ORDER = {
  P1: 1,
  P2: 2
} as const satisfies Record<CorroborationPriority, number>;

export function buildCorroborationQueue(input: {
  edges: readonly OfficialDisclosureReadinessEdge[];
  nodes: readonly OfficialDisclosureReadinessNode[];
  edgeCorroborationDispositions?: readonly OfficialDisclosureEdgeCorroborationDispositionSummary[];
}): OfficialDisclosureCorroborationQueueItem[] {
  const nodesById = new Map(input.nodes.map((node) => [node.node_id, node]));
  const dispositionsByEdge = latestDispositionByEdge(input.edgeCorroborationDispositions ?? []);
  return input.edges
    .filter((edge) => edge.corroboration_state !== "cross_source")
    .map((edge) => corroborationQueueItemForEdge(edge, nodesById, dispositionsByEdge.get(edge.edge_id) ?? null))
    .sort(compareCorroborationQueueItems);
}

function corroborationQueueItemForEdge(
  edge: OfficialDisclosureReadinessEdge,
  nodesById: ReadonlyMap<string, OfficialDisclosureReadinessNode>,
  latestDisposition: OfficialDisclosureEdgeCorroborationDispositionSummary | null
): OfficialDisclosureCorroborationQueueItem {
  const candidateNodes = corroborationCandidateNodes(edge, nodesById);
  const existingSources = new Set(edge.source_adapters);
  const candidateSourceIds = uniqueSorted(candidateNodes.flatMap((node) => node.expected_source_ids).filter((sourceId) => !existingSources.has(sourceId)));
  const sourceTargets = uniqueSourceTargets(
    candidateNodes.flatMap((node) => node.source_targets).filter((target) => !existingSources.has(target.source_adapter_id))
  );
  const sourcePlanRefs = uniqueSorted(candidateNodes.flatMap((node) => node.source_plan_refs));
  const disposition = corroborationDisposition({ edge, candidateSourceIds, sourceTargets, latestDisposition });
  const proposedUnknown =
    disposition === "needs_explicit_single_source_disposition" ||
    (latestDisposition?.decision === "record_single_source_unknown" && latestDisposition.unknown_id === null)
      ? proposedSingleSourceDispositionUnknown(edge)
      : null;
  return {
    edge_id: edge.edge_id,
    priority: corroborationPriority({ edge, candidateNodes, sourceTargets }),
    disposition,
    reason: corroborationReason(edge, candidateSourceIds, sourceTargets, latestDisposition),
    from_id: edge.from_id,
    from_name: edge.from_name,
    to_id: edge.to_id,
    to_name: edge.to_name,
    component_id: edge.component_id,
    existing_source_adapters: edge.source_adapters,
    candidate_node_ids: candidateNodes.map((node) => node.node_id),
    candidate_source_ids: candidateSourceIds,
    source_plan_refs: sourcePlanRefs,
    source_targets: sourceTargets,
    unknown_ids: edge.unknown_ids,
    latest_disposition: latestDisposition,
    proposed_unknown: proposedUnknown,
    action: corroborationAction(disposition, sourceTargets, proposedUnknown)
  };
}

function corroborationPriority(input: {
  edge: OfficialDisclosureReadinessEdge;
  candidateNodes: readonly OfficialDisclosureReadinessNode[];
  sourceTargets: readonly OfficialDisclosureReadinessSourceTarget[];
}): OfficialDisclosureCorroborationQueueItem["priority"] {
  if (input.sourceTargets.length > 0) return "P1";
  const nonRootCandidateIsP0 = input.candidateNodes.some((node) => node.node_id !== input.edge.from_id && node.target_priority === "P0");
  return nonRootCandidateIsP0 ? "P1" : "P2";
}

function corroborationCandidateNodes(
  edge: OfficialDisclosureReadinessEdge,
  nodesById: ReadonlyMap<string, OfficialDisclosureReadinessNode>
): OfficialDisclosureReadinessNode[] {
  const companyCandidates = [nodesById.get(edge.to_id), nodesById.get(edge.from_id)].filter(
    (node): node is OfficialDisclosureReadinessNode => node !== undefined && nodeHasCorroborationPath(node)
  );
  if (companyCandidates.length > 0) return uniqueNodes(companyCandidates).sort(compareNodes);

  // 只有边两端公司都没有可见官方路径时，才退到组件级来源。
  // 否则组件 profile 的通用来源会污染具体 counterparty 的二源检查清单。
  const componentNode = edge.component_id === null ? undefined : nodesById.get(edge.component_id);
  if (componentNode === undefined || !nodeHasCorroborationPath(componentNode)) return [];
  return [componentNode];
}

function nodeHasCorroborationPath(node: OfficialDisclosureReadinessNode): boolean {
  return node.expected_source_ids.length > 0 || node.source_plan_refs.length > 0 || node.source_targets.length > 0;
}

function uniqueNodes(nodes: readonly OfficialDisclosureReadinessNode[]): OfficialDisclosureReadinessNode[] {
  return [...new Map(nodes.map((node) => [node.node_id, node])).values()];
}

function corroborationDisposition(input: {
  edge: OfficialDisclosureReadinessEdge;
  candidateSourceIds: readonly string[];
  sourceTargets: readonly OfficialDisclosureReadinessSourceTarget[];
  latestDisposition: OfficialDisclosureEdgeCorroborationDispositionSummary | null;
}): OfficialDisclosureCorroborationDisposition {
  if (input.edge.corroboration_state === "missing_evidence") return "needs_traceability_backfill";
  if (input.latestDisposition?.decision === "record_single_source_unknown") return "single_source_disposition_recorded";
  if (input.sourceTargets.length > 0) return "needs_counterparty_check";
  if (input.candidateSourceIds.length > 0) return "needs_counterparty_source_target";
  if (input.edge.single_source_disposition_unknown_ids.length > 0) return "single_source_disposition_recorded";
  return "needs_explicit_single_source_disposition";
}

function corroborationReason(
  edge: OfficialDisclosureReadinessEdge,
  candidateSourceIds: readonly string[],
  sourceTargets: readonly OfficialDisclosureReadinessSourceTarget[],
  latestDisposition: OfficialDisclosureEdgeCorroborationDispositionSummary | null = null
): string {
  const disposition = corroborationDisposition({ edge, candidateSourceIds, sourceTargets, latestDisposition });
  return DISPOSITION_REASONS[disposition];
}

function corroborationAction(
  disposition: OfficialDisclosureCorroborationDisposition,
  sourceTargets: readonly OfficialDisclosureReadinessSourceTarget[],
  proposedUnknown: OfficialDisclosureProposedUnknown | null
): string {
  return DISPOSITION_ACTIONS[disposition]({ sourceTargets, proposedUnknown });
}

function proposedSingleSourceDispositionUnknown(edge: OfficialDisclosureReadinessEdge): OfficialDisclosureProposedUnknown {
  const componentText = edge.component_id ?? "the disclosed relationship scope";
  return {
    unknown_id: deterministicSingleSourceDispositionUnknownId(edge.edge_id),
    scope_kind: "edge",
    scope_id: edge.edge_id,
    question: `Can ${edge.edge_id} (${edge.from_name} -> ${edge.to_name}, ${componentText}) be corroborated by a second official source, or should it remain single-source?`,
    why_unknown:
      "The Level 4/5 fact edge is traceable, but the current research pack has no profile-backed counterparty source target or second official source evidence for this relationship.",
    blocking_data_sources: ["counterparty official disclosure", "official supplier/customer list", "reviewed second-source filing"],
    proxies: ["source-plan target coverage", "official disclosure observations", "manual review disposition"],
    created_by: "official-disclosure-readiness.single-source-disposition.v1"
  };
}

function latestDispositionByEdge(
  dispositions: readonly OfficialDisclosureEdgeCorroborationDispositionSummary[]
): Map<string, OfficialDisclosureEdgeCorroborationDispositionSummary> {
  const byEdge = new Map<string, OfficialDisclosureEdgeCorroborationDispositionSummary>();
  for (const disposition of dispositions) {
    const existing = byEdge.get(disposition.edge_id);
    if (existing === undefined || disposition.recorded_at.localeCompare(existing.recorded_at) > 0) byEdge.set(disposition.edge_id, disposition);
  }
  return byEdge;
}

function deterministicSingleSourceDispositionUnknownId(edgeId: string): string {
  const digest = createHash("sha256").update(`single-source-disposition:${edgeId}`).digest("hex").slice(0, 20).toUpperCase();
  return `UNK-EDGE-CORROB-${digest}`;
}

function compareCorroborationQueueItems(left: OfficialDisclosureCorroborationQueueItem, right: OfficialDisclosureCorroborationQueueItem): number {
  return (
    priorityOrder(left.priority) - priorityOrder(right.priority) ||
    corroborationDispositionOrder(left.disposition) - corroborationDispositionOrder(right.disposition) ||
    left.edge_id.localeCompare(right.edge_id)
  );
}

function compareNodes(left: OfficialDisclosureReadinessNode, right: OfficialDisclosureReadinessNode): number {
  return (
    nodeCoverageOrder(left.coverage_state) - nodeCoverageOrder(right.coverage_state) ||
    left.node_kind.localeCompare(right.node_kind) ||
    left.node_id.localeCompare(right.node_id)
  );
}

function nodeCoverageOrder(state: OfficialDisclosureReadinessNode["coverage_state"]): number {
  return NODE_COVERAGE_ORDER[state];
}

function corroborationDispositionOrder(disposition: OfficialDisclosureCorroborationDisposition): number {
  return CORROBORATION_DISPOSITION_ORDER[disposition];
}

function priorityOrder(priority: CorroborationPriority): number {
  return CORROBORATION_PRIORITY_ORDER[priority];
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
