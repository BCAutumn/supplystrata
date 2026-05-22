import { createHash } from "node:crypto";
import type { SourcePlanItem } from "@supplystrata/source-plan";
import { buildSourceManagementCatalog } from "@supplystrata/source-management";
import type {
  OfficialDisclosureCorroborationDisposition,
  OfficialDisclosureCorroborationQueueItem,
  OfficialDisclosureExpectedSourceCoverage,
  OfficialDisclosureExpectedSourceCoverageState,
  OfficialDisclosureNodeCoverageState,
  OfficialDisclosureNodeDraft,
  OfficialDisclosureNodeKind,
  OfficialDisclosureProfileExpansionCandidate,
  OfficialDisclosureProposedUnknown,
  OfficialDisclosureReadinessEdge,
  OfficialDisclosureReadinessNode,
  OfficialDisclosureReadinessSourcePlanItem,
  OfficialDisclosureReadinessSourceTarget,
  OfficialDisclosureReadinessTargetNode
} from "./official-disclosure-readiness-definitions.js";
import type { SourceTargetCoverageReport } from "./source-target-coverage.js";

// 这里刻意只登记当前后端已经有 source-check connector 的官方披露源。
// profile 可以期待更多来源，但 Gate 1 不能把“注册过来源”误报成“可运行监控能力”。
const OFFICIAL_SOURCE_CONNECTOR_IDS = new Set([
  "apple-suppliers",
  "company-ir",
  "dart-kr",
  "edinet",
  "sec-edgar",
  "micron-ir",
  "twse-mops",
  "tsmc-ir",
  "samsung-ir",
  "skhynix-ir",
  "asml-ir"
]);

export function summarizeOfficialSourcePlan(
  sourcePlan: readonly SourcePlanItem[],
  coverage: SourceTargetCoverageReport | undefined
): OfficialDisclosureReadinessSourcePlanItem[] {
  return sourcePlan
    .filter(isOfficialDisclosurePlanItem)
    .map((item) => ({
      source_id: item.source_id,
      source_name: item.source_name,
      priority: item.priority,
      expected_output_layer: item.expected_output_layer,
      relation_policy: item.relation_policy,
      component_ids: uniqueSorted(item.parent_component_ids),
      target_ids: uniqueSorted(item.target_ids),
      reasons: item.reasons.slice(0, 5),
      source_targets: item.suggested_check_targets.map((target) => summarizeSourceTarget(target, coverage)).sort(compareSourceTargets)
    }))
    .sort((left, right) => left.source_id.localeCompare(right.source_id));
}

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

export function buildExpectedSourceCoverage(input: {
  nodes: readonly OfficialDisclosureReadinessNode[];
  edges: readonly OfficialDisclosureReadinessEdge[];
}): OfficialDisclosureExpectedSourceCoverage[] {
  const sourceCatalog = buildSourceManagementCatalog();
  const registeredSourceIds = new Set(sourceCatalog.sources.map((item) => item.source.id));
  return input.nodes
    .filter((node) => node.expected_source_ids.length > 0)
    .flatMap((node) =>
      node.expected_source_ids.map((expectedSourceId) =>
        expectedSourceCoverageForNode({
          node,
          expectedSourceId,
          edges: input.edges,
          registeredSourceIds
        })
      )
    )
    .sort(compareExpectedSourceCoverage);
}

export function buildCorroborationQueue(input: {
  edges: readonly OfficialDisclosureReadinessEdge[];
  nodes: readonly OfficialDisclosureReadinessNode[];
}): OfficialDisclosureCorroborationQueueItem[] {
  const nodesById = new Map(input.nodes.map((node) => [node.node_id, node]));
  return input.edges
    .filter((edge) => edge.corroboration_state !== "cross_source")
    .map((edge) => corroborationQueueItemForEdge(edge, nodesById))
    .sort(compareCorroborationQueueItems);
}

export function actionForOfficialTargets(targets: readonly OfficialDisclosureReadinessSourceTarget[]): string {
  if (targets.some((target) => target.state === "not_synced")) return "Sync runnable official disclosure targets into source_check_targets first.";
  if (targets.some((target) => target.state === "disabled")) return "Enable synced official disclosure targets after cadence/retry policy review.";
  if (targets.some((target) => target.state === "due")) return "Run due official disclosure targets through the shared source-check worker path.";
  if (targets.some((target) => target.state === "active_job")) return "Wait for active official disclosure source-check jobs before changing conclusions.";
  if (targets.some((target) => target.state === "retry_wait" || target.state === "dead" || target.state === "degraded"))
    return "Inspect failed or degraded official disclosure checks before relying on the latest source state.";
  if (targets.some((target) => (target.observations ?? 0) > 0))
    return "Review produced official disclosure observations and keep any fact-edge promotion behind evidence review.";
  return "Review configured official disclosure targets and collect traceable evidence candidates before expanding to weaker signal sources.";
}

export function expectedSourceCoverageAction(items: readonly OfficialDisclosureExpectedSourceCoverage[]): string {
  if (items.some((item) => item.coverage_state === "connector_available"))
    return "Add node-specific source-plan targets for expected official sources that already have connectors, then sync them into source_check_targets.";
  if (items.some((item) => item.coverage_state === "source_registered_unimplemented"))
    return "Keep registered-but-unimplemented official sources as explicit Gate 1 gaps until connector or manual-review workflow support exists.";
  return "Register missing expected source mappings before using the profile as an operational coverage plan.";
}

export function expectedSourceHasCoverage(state: OfficialDisclosureExpectedSourceCoverageState): boolean {
  return (
    state === "covered_fact" ||
    state === "official_target_with_observation" ||
    state === "official_target_synced" ||
    state === "official_target_runnable" ||
    state === "official_source_planned"
  );
}

export function expectedSourceHasRunnablePath(state: OfficialDisclosureExpectedSourceCoverageState): boolean {
  return state === "official_target_with_observation" || state === "official_target_synced" || state === "official_target_runnable";
}

export function uniqueSourceTargets(targets: readonly OfficialDisclosureReadinessSourceTarget[]): OfficialDisclosureReadinessSourceTarget[] {
  const byKey = new Map<string, OfficialDisclosureReadinessSourceTarget>();
  for (const target of targets) byKey.set(target.target_key, target);
  return [...byKey.values()].sort(compareSourceTargets);
}

function corroborationQueueItemForEdge(
  edge: OfficialDisclosureReadinessEdge,
  nodesById: ReadonlyMap<string, OfficialDisclosureReadinessNode>
): OfficialDisclosureCorroborationQueueItem {
  const candidateNodes = corroborationCandidateNodes(edge, nodesById);
  const existingSources = new Set(edge.source_adapters);
  const candidateSourceIds = uniqueSorted(candidateNodes.flatMap((node) => node.expected_source_ids).filter((sourceId) => !existingSources.has(sourceId)));
  const sourceTargets = uniqueSourceTargets(
    candidateNodes.flatMap((node) => node.source_targets).filter((target) => !existingSources.has(target.source_adapter_id))
  );
  const sourcePlanRefs = uniqueSorted(candidateNodes.flatMap((node) => node.source_plan_refs));
  const disposition = corroborationDisposition({ edge, candidateSourceIds, sourceTargets });
  const proposedUnknown = disposition === "needs_explicit_single_source_disposition" ? proposedSingleSourceDispositionUnknown(edge) : null;
  return {
    edge_id: edge.edge_id,
    priority: corroborationPriority({ edge, candidateNodes, sourceTargets }),
    disposition,
    reason: corroborationReason(edge, candidateSourceIds, sourceTargets),
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
}): OfficialDisclosureCorroborationDisposition {
  if (input.edge.corroboration_state === "missing_evidence") return "needs_traceability_backfill";
  if (input.sourceTargets.length > 0) return "needs_counterparty_check";
  if (input.candidateSourceIds.length > 0) return "needs_counterparty_source_target";
  if (input.edge.single_source_disposition_unknown_ids.length > 0) return "single_source_disposition_recorded";
  return "needs_explicit_single_source_disposition";
}

function corroborationReason(
  edge: OfficialDisclosureReadinessEdge,
  candidateSourceIds: readonly string[],
  sourceTargets: readonly OfficialDisclosureReadinessSourceTarget[]
): string {
  if (edge.corroboration_state === "missing_evidence") return "This Level 4/5 edge has no active official evidence visible in the pack.";
  if (sourceTargets.length > 0)
    return "A non-edge official source path exists for one of the counterparties/components and should be checked before disposition.";
  if (candidateSourceIds.length > 0)
    return "The target profile names candidate official sources, but this edge does not yet have a concrete counterparty source target.";
  if (edge.single_source_disposition_unknown_ids.length > 0)
    return "A linked explicit unknown records that no profile-backed second-source path is currently visible; keep it reviewable instead of treating silence as corroboration.";
  return "No profile-backed second-source path is visible; silence must be captured as an explicit single-source disposition or unknown.";
}

function corroborationAction(
  disposition: OfficialDisclosureCorroborationDisposition,
  sourceTargets: readonly OfficialDisclosureReadinessSourceTarget[],
  proposedUnknown: OfficialDisclosureProposedUnknown | null
): string {
  if (disposition === "needs_traceability_backfill") return "Backfill active official evidence and trace context before attempting corroboration.";
  if (disposition === "needs_counterparty_check")
    return `${actionForOfficialTargets(sourceTargets)} If the counterparty source confirms the relation, add it through evidence review; if not, keep an explicit single-source disposition.`;
  if (disposition === "needs_counterparty_source_target")
    return "Create node-specific source-plan targets for the candidate official sources, then run them before changing corroboration state.";
  if (disposition === "single_source_disposition_recorded")
    return "Review the linked single-source disposition unknown during research updates; do not count it as cross-source corroboration.";
  const suffix = proposedUnknown === null ? "" : ` Proposed unknown: ${proposedUnknown.unknown_id}.`;
  return `Record an explicit single-source unknown/disposition so the edge is not silently treated as corroborated.${suffix}`;
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

function expectedSourceCoverageForNode(input: {
  node: OfficialDisclosureReadinessNode;
  expectedSourceId: string;
  edges: readonly OfficialDisclosureReadinessEdge[];
  registeredSourceIds: ReadonlySet<string>;
}): OfficialDisclosureExpectedSourceCoverage {
  const sourceTargets = input.node.source_targets.filter((target) => target.source_adapter_id === input.expectedSourceId);
  const hasFactFromExpectedSource = input.edges
    .filter((edge) => input.node.fact_edge_ids.includes(edge.edge_id))
    .some((edge) => edge.source_adapters.includes(input.expectedSourceId));
  const coverageState = expectedSourceCoverageState({
    hasFactFromExpectedSource,
    sourcePlanRefs: input.node.source_plan_refs,
    sourceTargets,
    expectedSourceId: input.expectedSourceId,
    registeredSourceIds: input.registeredSourceIds
  });
  return {
    node_id: input.node.node_id,
    node_kind: input.node.node_kind,
    node_name: input.node.name,
    target_priority: input.node.target_priority,
    expected_source_id: input.expectedSourceId,
    coverage_state: coverageState,
    action: actionForExpectedSourceCoverage(coverageState, input.expectedSourceId),
    fact_edge_ids: input.node.fact_edge_ids,
    source_plan_refs: input.node.source_plan_refs.filter((ref) => ref === `source_plan:${input.expectedSourceId}`),
    source_targets: sourceTargets
  };
}

function expectedSourceCoverageState(input: {
  hasFactFromExpectedSource: boolean;
  sourcePlanRefs: readonly string[];
  sourceTargets: readonly OfficialDisclosureReadinessSourceTarget[];
  expectedSourceId: string;
  registeredSourceIds: ReadonlySet<string>;
}): OfficialDisclosureExpectedSourceCoverageState {
  if (input.hasFactFromExpectedSource) return "covered_fact";
  if (input.sourceTargets.some((target) => (target.observations ?? 0) > 0)) return "official_target_with_observation";
  if (input.sourceTargets.some((target) => target.synced === true)) return "official_target_synced";
  if (input.sourceTargets.some((target) => target.runnable)) return "official_target_runnable";
  if (input.sourceTargets.length > 0 && input.sourcePlanRefs.includes(`source_plan:${input.expectedSourceId}`)) return "official_source_planned";
  if (OFFICIAL_SOURCE_CONNECTOR_IDS.has(input.expectedSourceId)) return "connector_available";
  if (input.registeredSourceIds.has(input.expectedSourceId)) return "source_registered_unimplemented";
  return "missing_source_mapping";
}

function actionForExpectedSourceCoverage(state: OfficialDisclosureExpectedSourceCoverageState, sourceId: string): string {
  if (state === "covered_fact") return "Official fact evidence from this expected source is already visible in the pack.";
  if (state === "official_target_with_observation")
    return "Review produced official observations and promote only traceable evidence candidates through the evidence review path.";
  if (state === "official_target_synced") return "Enable or run the synced official source target according to the configured monitoring policy.";
  if (state === "official_target_runnable") return "Sync the runnable source-plan target into source_check_targets before expecting observations.";
  if (state === "official_source_planned") return "Add a concrete runnable target config for this planned official source.";
  if (state === "connector_available")
    return `Create a node-specific source-plan target for ${sourceId}; the connector exists but this profile node is not yet wired.`;
  if (state === "source_registered_unimplemented")
    return `Keep ${sourceId} as an explicit backend coverage gap until a connector or manual review workflow exists.`;
  return `Map this expected source id to the registered source catalog before treating it as actionable coverage.`;
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

function sourceTargetsForNode(
  nodeId: string,
  nodeKind: OfficialDisclosureNodeKind,
  item: OfficialDisclosureReadinessSourcePlanItem
): OfficialDisclosureReadinessSourceTarget[] {
  return item.source_targets.filter((target) => {
    if (target.target_component_id !== null) return target.target_component_id === nodeId;
    if (target.target_entity_id !== null) {
      if (nodeKind === "company") return target.target_entity_id === nodeId;
      return item.target_ids.includes(nodeId);
    }
    return item.target_ids.includes(nodeId);
  });
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

function isOfficialDisclosurePlanItem(item: SourcePlanItem): boolean {
  return item.purpose === "official_disclosure" || (item.expected_output_layer === "edge" && item.relation_policy === "can_create_fact_edge");
}

function summarizeSourceTarget(
  target: SourcePlanItem["suggested_check_targets"][number],
  coverage: SourceTargetCoverageReport | undefined
): OfficialDisclosureReadinessSourceTarget {
  const matched = coverage?.items.find((item) => sourceTargetKey(item.expected_target) === sourceTargetKey(target));
  return {
    source_adapter_id: target.source_adapter_id,
    target_kind: target.target_kind,
    runnable: target.runnable,
    target_key: sourceTargetKey(target),
    target_entity_id: stringConfigValue(target.target_config, "entity_id"),
    target_component_id: stringConfigValue(target.target_config, "component_id"),
    check_target_id: matched?.matched_check_target_id ?? matched?.expected_target.check_target_id ?? null,
    state: matched?.state ?? null,
    synced: matched?.synced ?? null,
    observations: matched?.observations ?? null,
    latest_event_type: matched?.latest_event?.event_type ?? null
  };
}

function deterministicSingleSourceDispositionUnknownId(edgeId: string): string {
  const digest = createHash("sha256").update(`single-source-disposition:${edgeId}`).digest("hex").slice(0, 20).toUpperCase();
  return `UNK-EDGE-CORROB-${digest}`;
}

function sourceTargetKey(target: { source_adapter_id: string; target_kind: string; target_config: Record<string, unknown> }): string {
  return `${target.source_adapter_id}:${target.target_kind}:${stableConfigKey(target.target_config)}`;
}

function stableConfigKey(config: Record<string, unknown>): string {
  return Object.entries(config)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${stableConfigValue(value)}`)
    .join(";");
}

function stableConfigValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableConfigValue).join(",")}]`;
  if (isRecord(value)) return `{${stableConfigKey(value)}}`;
  return String(value);
}

function stringConfigValue(config: Record<string, unknown>, key: string): string | null {
  const value = config[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareNodes(left: OfficialDisclosureReadinessNode, right: OfficialDisclosureReadinessNode): number {
  return (
    nodeCoverageOrder(left.coverage_state) - nodeCoverageOrder(right.coverage_state) ||
    left.node_kind.localeCompare(right.node_kind) ||
    left.node_id.localeCompare(right.node_id)
  );
}

function nodeCoverageOrder(state: OfficialDisclosureNodeCoverageState): number {
  if (state === "missing") return 0;
  if (state === "official_source_planned") return 1;
  if (state === "official_target_runnable") return 2;
  if (state === "official_target_synced") return 3;
  if (state === "official_target_with_observation") return 4;
  return 5;
}

function compareSourceTargets(left: OfficialDisclosureReadinessSourceTarget, right: OfficialDisclosureReadinessSourceTarget): number {
  return left.source_adapter_id.localeCompare(right.source_adapter_id) || left.target_kind.localeCompare(right.target_kind);
}

function compareProfileExpansionCandidates(left: OfficialDisclosureProfileExpansionCandidate, right: OfficialDisclosureProfileExpansionCandidate): number {
  return (
    priorityOrder(left.suggested_priority) - priorityOrder(right.suggested_priority) ||
    nodeCoverageOrder(left.coverage_state) - nodeCoverageOrder(right.coverage_state) ||
    left.node_kind.localeCompare(right.node_kind) ||
    left.node_id.localeCompare(right.node_id)
  );
}

function compareExpectedSourceCoverage(left: OfficialDisclosureExpectedSourceCoverage, right: OfficialDisclosureExpectedSourceCoverage): number {
  return (
    priorityOrder(left.target_priority ?? "P2") - priorityOrder(right.target_priority ?? "P2") ||
    expectedSourceCoverageOrder(left.coverage_state) - expectedSourceCoverageOrder(right.coverage_state) ||
    left.node_kind.localeCompare(right.node_kind) ||
    left.node_id.localeCompare(right.node_id) ||
    left.expected_source_id.localeCompare(right.expected_source_id)
  );
}

function compareCorroborationQueueItems(left: OfficialDisclosureCorroborationQueueItem, right: OfficialDisclosureCorroborationQueueItem): number {
  return (
    priorityOrder(left.priority) - priorityOrder(right.priority) ||
    corroborationDispositionOrder(left.disposition) - corroborationDispositionOrder(right.disposition) ||
    left.edge_id.localeCompare(right.edge_id)
  );
}

function expectedSourceCoverageOrder(state: OfficialDisclosureExpectedSourceCoverageState): number {
  if (state === "missing_source_mapping") return 0;
  if (state === "source_registered_unimplemented") return 1;
  if (state === "connector_available") return 2;
  if (state === "official_source_planned") return 3;
  if (state === "official_target_runnable") return 4;
  if (state === "official_target_synced") return 5;
  if (state === "official_target_with_observation") return 6;
  return 7;
}

function corroborationDispositionOrder(disposition: OfficialDisclosureCorroborationDisposition): number {
  if (disposition === "needs_traceability_backfill") return 0;
  if (disposition === "needs_counterparty_check") return 1;
  if (disposition === "needs_counterparty_source_target") return 2;
  if (disposition === "needs_explicit_single_source_disposition") return 3;
  return 4;
}

function priorityOrder(priority: "P0" | "P1" | "P2"): number {
  if (priority === "P0") return 0;
  if (priority === "P1") return 1;
  return 2;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
