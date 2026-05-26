import type { WorkbenchReviewCandidate } from "@supplystrata/workbench-export";
import type { OfficialDisclosureSignalCorrelationHint } from "./official-disclosure-signal-correlation.js";
import type {
  OfficialDisclosureCorroborationQueueItem,
  OfficialDisclosureExpectedSourceCoverage,
  OfficialDisclosureReadinessEdge,
  OfficialDisclosureReadinessNode,
  OfficialDisclosureReadinessSourcePlanItem,
  OfficialDisclosureReadinessSummary,
  OfficialDisclosureSignalReviewSummary
} from "./official-disclosure-readiness-definitions.js";
import { expectedSourceHasCoverage, expectedSourceHasRunnablePath } from "./official-disclosure-readiness-source-context.js";

export function readinessSummary(input: {
  nodes: readonly OfficialDisclosureReadinessNode[];
  edges: readonly OfficialDisclosureReadinessEdge[];
  unknownItems: number;
  sourcePlanItems: readonly OfficialDisclosureReadinessSourcePlanItem[];
  expectedSourceCoverage: readonly OfficialDisclosureExpectedSourceCoverage[];
  corroborationQueue: readonly OfficialDisclosureCorroborationQueueItem[];
  officialDisclosureSignals: readonly OfficialDisclosureSignalReviewSummary[];
  officialDisclosureSignalCorrelationHints: readonly OfficialDisclosureSignalCorrelationHint[];
}): OfficialDisclosureReadinessSummary {
  const edgeCount = input.edges.length;
  const crossSourceEdges = input.edges.filter((edge) => edge.corroboration_state === "cross_source").length;
  const recordedDispositionEdges = input.corroborationQueue.filter((item) => item.disposition === "single_source_disposition_recorded").length;
  const corroborationOrDispositionEdges = Math.min(edgeCount, crossSourceEdges + recordedDispositionEdges);
  const traceableEdges = input.edges.filter((edge) => edge.traceability_state === "complete").length;
  const sourceTargets = input.sourcePlanItems.flatMap((item) => item.source_targets);
  const targetNodes = input.nodes.filter((node) => node.is_target_node);
  const expectedCoverage = input.expectedSourceCoverage;
  return {
    visible_research_nodes: input.nodes.length,
    target_research_nodes: targetNodes.length,
    company_nodes: input.nodes.filter((node) => node.node_kind === "company").length,
    component_nodes: input.nodes.filter((node) => node.node_kind === "component").length,
    nodes_with_fact_edges: input.nodes.filter((node) => node.coverage_state === "covered_fact").length,
    target_nodes_with_fact_edges: targetNodes.filter((node) => node.coverage_state === "covered_fact").length,
    nodes_with_official_source_plan: input.nodes.filter((node) => node.source_plan_refs.length > 0).length,
    target_nodes_with_official_source_plan: targetNodes.filter((node) => node.source_plan_refs.length > 0).length,
    nodes_with_runnable_official_targets: input.nodes.filter((node) => node.source_targets.some((target) => target.runnable)).length,
    target_nodes_with_runnable_official_targets: targetNodes.filter((node) => node.source_targets.some((target) => target.runnable)).length,
    nodes_with_official_observations: input.nodes.filter((node) => node.source_targets.some((target) => (target.observations ?? 0) > 0)).length,
    target_nodes_with_official_observations: targetNodes.filter((node) => node.source_targets.some((target) => (target.observations ?? 0) > 0)).length,
    nodes_missing_official_coverage: input.nodes.filter((node) => node.coverage_state === "missing").length,
    target_nodes_missing_official_coverage: targetNodes.filter((node) => node.coverage_state === "missing").length,
    level_4_5_fact_edges: edgeCount,
    traceable_edges: traceableEdges,
    partial_traceability_edges: input.edges.filter((edge) => edge.traceability_state === "partial").length,
    missing_traceability_edges: input.edges.filter((edge) => edge.traceability_state === "missing").length,
    cross_source_edges: crossSourceEdges,
    single_source_edges: input.edges.filter((edge) => edge.corroboration_state === "single_source").length,
    missing_evidence_edges: input.edges.filter((edge) => edge.corroboration_state === "missing_evidence").length,
    corroboration_ratio: edgeCount === 0 ? 0 : roundSix(crossSourceEdges / edgeCount),
    corroboration_or_disposition_edges: corroborationOrDispositionEdges,
    corroboration_or_disposition_ratio: edgeCount === 0 ? 0 : roundSix(corroborationOrDispositionEdges / edgeCount),
    corroboration_queue_items: input.corroborationQueue.length,
    corroboration_queue_with_runnable_targets: input.corroborationQueue.filter((item) => item.source_targets.some((target) => target.runnable)).length,
    corroboration_queue_needing_disposition: input.corroborationQueue.filter((item) => item.disposition === "needs_explicit_single_source_disposition").length,
    corroboration_queue_with_recorded_disposition: input.corroborationQueue.filter((item) => item.disposition === "single_source_disposition_recorded").length,
    corroboration_queue_proposed_unknowns: input.corroborationQueue.filter((item) => item.proposed_unknown !== null).length,
    edges_with_strength: input.edges.filter((edge) => edge.has_strength).length,
    edges_with_freshness: input.edges.filter((edge) => edge.has_freshness).length,
    edges_missing_strength: input.edges.filter((edge) => !edge.has_strength).length,
    edges_missing_freshness: input.edges.filter((edge) => !edge.has_freshness).length,
    explicit_unknowns: input.unknownItems,
    official_source_plan_items: input.sourcePlanItems.length,
    expected_official_source_links: expectedCoverage.length,
    expected_official_source_links_with_coverage: expectedCoverage.filter((item) => expectedSourceHasCoverage(item.coverage_state)).length,
    expected_official_source_links_runnable: expectedCoverage.filter((item) => expectedSourceHasRunnablePath(item.coverage_state)).length,
    expected_official_source_links_connector_available: expectedCoverage.filter((item) => item.coverage_state === "connector_available").length,
    expected_official_source_links_unimplemented: expectedCoverage.filter((item) => item.coverage_state === "source_registered_unimplemented").length,
    expected_official_source_links_missing: expectedCoverage.filter((item) => item.coverage_state === "missing_source_mapping").length,
    runnable_official_targets: sourceTargets.filter((target) => target.runnable).length,
    synced_official_targets: sourceTargets.filter((target) => target.synced === true).length,
    due_official_targets: sourceTargets.filter((target) => target.state === "due").length,
    degraded_official_targets: sourceTargets.filter((target) => target.state === "degraded").length,
    official_targets_with_observations: sourceTargets.filter((target) => (target.observations ?? 0) > 0).length,
    official_disclosure_signal_review_candidates: input.officialDisclosureSignals.length,
    open_official_disclosure_signal_review_candidates: input.officialDisclosureSignals.filter(signalNeedsDisposition).length,
    official_disclosure_signal_dispositions: input.officialDisclosureSignals.reduce((count, signal) => count + signal.dispositions.length, 0),
    official_disclosure_signal_correlation_hints: input.officialDisclosureSignalCorrelationHints.length,
    open_official_disclosure_signal_correlation_hints: input.officialDisclosureSignalCorrelationHints.filter((hint) => hint.disposition_status === "open")
      .length
  };
}

function signalNeedsDisposition(signal: OfficialDisclosureSignalReviewSummary): boolean {
  // review_candidates.status 只是队列表状态；Gate 1 更关心“这个 signal 是否已有审查结论”。
  // 已有 disposition 的 pending row 不应继续污染 data-depth backlog，否则会把完成项误报为 open。
  return ["pending", "in_review", "approved", "blocked"].includes(signal.status) && signal.dispositions.length === 0;
}

export function summarizeOfficialDisclosureSignals(reviewQueue: readonly WorkbenchReviewCandidate[]): OfficialDisclosureSignalReviewSummary[] {
  return reviewQueue
    .filter((candidate) => candidate.kind === "official_disclosure_signal" && candidate.signal !== null)
    .map((candidate) => ({
      review_id: candidate.review_id,
      status: candidate.status,
      source_adapter_id: candidate.source_adapter_id,
      doc_id: candidate.doc_id,
      signal_title: candidate.signal?.signal_title ?? "",
      evidence_level_hint: candidate.signal?.evidence_level_hint ?? 0,
      confidence: candidate.confidence,
      source_url: candidate.source_url,
      source_locator: candidate.source_locator,
      cite_text: candidate.source_row_text,
      dispositions: candidate.dispositions.map((disposition) => ({
        change_id: disposition.change_id,
        edge_id: disposition.edge_id,
        decision: disposition.decision,
        reviewer: disposition.reviewer,
        reason: disposition.reason,
        evidence_id: disposition.evidence_id,
        unknown_id: disposition.unknown_id,
        check_target_id: disposition.check_target_id,
        recorded_at: disposition.recorded_at
      }))
    }))
    .filter((signal) => signal.signal_title.length > 0 && signal.evidence_level_hint > 0)
    .sort(compareOfficialDisclosureSignals);
}

function compareOfficialDisclosureSignals(left: OfficialDisclosureSignalReviewSummary, right: OfficialDisclosureSignalReviewSummary): number {
  return (
    left.status.localeCompare(right.status) || left.source_adapter_id.localeCompare(right.source_adapter_id) || left.review_id.localeCompare(right.review_id)
  );
}

function roundSix(value: number): number {
  return Number(value.toFixed(6));
}
