import { buildSourceManagementCatalog } from "@supplystrata/source-management";
import type {
  OfficialDisclosureExpectedSourceCoverage,
  OfficialDisclosureExpectedSourceCoverageState,
  OfficialDisclosureReadinessEdge,
  OfficialDisclosureReadinessNode,
  OfficialDisclosureReadinessSourceTarget
} from "./official-disclosure-readiness-definitions.js";

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

function compareExpectedSourceCoverage(left: OfficialDisclosureExpectedSourceCoverage, right: OfficialDisclosureExpectedSourceCoverage): number {
  return (
    priorityOrder(left.target_priority ?? "P2") - priorityOrder(right.target_priority ?? "P2") ||
    expectedSourceCoverageOrder(left.coverage_state) - expectedSourceCoverageOrder(right.coverage_state) ||
    left.node_kind.localeCompare(right.node_kind) ||
    left.node_id.localeCompare(right.node_id) ||
    left.expected_source_id.localeCompare(right.expected_source_id)
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

function priorityOrder(priority: "P0" | "P1" | "P2"): number {
  if (priority === "P0") return 0;
  if (priority === "P1") return 1;
  return 2;
}
