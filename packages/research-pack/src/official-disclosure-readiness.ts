import type { WorkbenchEdge, WorkbenchEvidence, WorkbenchUnknownItem } from "@supplystrata/workbench-export";
import { buildOfficialDisclosureSignalCorrelationHints } from "./official-disclosure-signal-correlation.js";
import type {
  OfficialDisclosureCorroborationState,
  OfficialDisclosureReadinessEdge,
  OfficialDisclosureReadinessInput,
  OfficialDisclosureReadinessReport,
  OfficialDisclosureReadinessTargets,
  OfficialDisclosureTraceabilityState
} from "./official-disclosure-readiness-definitions.js";
import { gate1Scorecard, gateStatuses, readinessGaps } from "./official-disclosure-readiness-gates.js";
import {
  buildCorroborationQueue,
  buildExpectedSourceCoverage,
  buildNodeCoverageMatrix,
  buildProfileExpansionCandidates,
  summarizeOfficialSourcePlan
} from "./official-disclosure-readiness-source-context.js";
import { readinessSummary, summarizeOfficialDisclosureSignals } from "./official-disclosure-readiness-summary.js";

export type {
  OfficialDisclosureCorroborationDisposition,
  OfficialDisclosureCorroborationQueueItem,
  OfficialDisclosureCorroborationState,
  OfficialDisclosureExpectedSourceCoverage,
  OfficialDisclosureExpectedSourceCoverageState,
  OfficialDisclosureGate1Scorecard,
  OfficialDisclosureGate1ScorecardCriterion,
  OfficialDisclosureGateStatus,
  OfficialDisclosureNodeCoverageState,
  OfficialDisclosureNodeKind,
  OfficialDisclosureProfileExpansionCandidate,
  OfficialDisclosureProposedUnknown,
  OfficialDisclosureReadinessEdge,
  OfficialDisclosureReadinessGap,
  OfficialDisclosureReadinessInput,
  OfficialDisclosureReadinessNode,
  OfficialDisclosureReadinessProfile,
  OfficialDisclosureReadinessReport,
  OfficialDisclosureReadinessSourcePlanItem,
  OfficialDisclosureReadinessSourceTarget,
  OfficialDisclosureReadinessSummary,
  OfficialDisclosureReadinessTargetNode,
  OfficialDisclosureReadinessTargetSourceConfig,
  OfficialDisclosureReadinessTargets,
  OfficialDisclosureSignalDispositionSummary,
  OfficialDisclosureSignalReviewSummary,
  OfficialDisclosureTraceabilityState
} from "./official-disclosure-readiness-definitions.js";
export { renderOfficialDisclosureReadinessMarkdown } from "./official-disclosure-readiness-render.js";

const DEFAULT_TARGETS: OfficialDisclosureReadinessTargets = {
  core_nodes: 25,
  level_4_5_fact_edges: 100,
  corroboration_ratio: 0.3
};

const TRACEABILITY_ORDER = {
  missing: 0,
  partial: 1,
  complete: 2
} as const satisfies Record<OfficialDisclosureTraceabilityState, number>;

const CORROBORATION_ORDER = {
  missing_evidence: 0,
  single_source: 1,
  cross_source: 2
} as const satisfies Record<OfficialDisclosureCorroborationState, number>;

export function buildOfficialDisclosureReadinessReport(input: OfficialDisclosureReadinessInput): OfficialDisclosureReadinessReport {
  const targets = officialDisclosureTargets(input);
  const componentIds = uniqueSorted(input.component_ids);
  const evidenceByEdge = evidenceByEdgeId(input.workbench.evidences);
  const strengthEdgeIds = new Set(input.workbench.intelligence.edge_strengths.map((strength) => strength.edge_id));
  const freshnessEdgeIds = new Set(input.workbench.intelligence.edge_freshness.map((freshness) => freshness.edge_id));
  const sourcePlanItems = summarizeOfficialSourcePlan(input.source_plan ?? [], input.source_target_coverage);
  const officialDisclosureSignals = summarizeOfficialDisclosureSignals(input.workbench.review_queue);
  const unknownsByEdge = unknownsByReferencedEdge(
    input.workbench.unknown_items,
    input.workbench.edges.map((edge) => edge.edge_id)
  );
  const edges = input.workbench.edges
    .filter((edge) => edge.evidence_level >= 4)
    .map((edge) =>
      summarizeOfficialEdge(edge, {
        evidences: evidenceByEdge.get(edge.edge_id) ?? [],
        strengthEdgeIds,
        freshnessEdgeIds,
        unknowns: unknownsByEdge.get(edge.edge_id) ?? []
      })
    )
    .sort(compareReadinessEdges);
  const nodes = buildNodeCoverageMatrix({
    companies: input.workbench.companies,
    componentIds,
    targetNodes: input.target_nodes ?? [],
    edges,
    sourcePlanItems
  });
  const expectedSourceCoverage = buildExpectedSourceCoverage({ nodes, edges });
  const corroborationQueue = buildCorroborationQueue({ edges, nodes });
  const officialDisclosureSignalCorrelationHints = buildOfficialDisclosureSignalCorrelationHints({
    signals: officialDisclosureSignals,
    corroboration_queue: corroborationQueue
  });
  const summary = readinessSummary({
    nodes,
    edges,
    unknownItems: input.workbench.unknown_items.length,
    sourcePlanItems,
    expectedSourceCoverage,
    corroborationQueue,
    officialDisclosureSignals,
    officialDisclosureSignalCorrelationHints
  });
  const scorecard = gate1Scorecard({ targets, summary });
  const profileExpansionCandidates = buildProfileExpansionCandidates({
    nodes,
    hasTargetProfile: input.target_nodes !== undefined && input.target_nodes.length > 0
  });
  const gaps = readinessGaps({ targets, summary, nodes, edges, componentIds, sourcePlanItems, expectedSourceCoverage, corroborationQueue });

  return {
    schema_version: "1.0.0",
    generated_at: input.generated_at,
    company_id: input.company_id,
    target_profile: input.target_profile ?? null,
    targets,
    scorecard,
    summary,
    gates: gateStatuses(targets, summary),
    nodes,
    profile_expansion_candidates: profileExpansionCandidates,
    expected_source_coverage: expectedSourceCoverage,
    official_disclosure_signals: officialDisclosureSignals,
    official_disclosure_signal_correlation_hints: officialDisclosureSignalCorrelationHints,
    corroboration_queue: corroborationQueue,
    edges,
    source_plan_items: sourcePlanItems,
    gaps
  };
}

function officialDisclosureTargets(input: OfficialDisclosureReadinessInput): OfficialDisclosureReadinessTargets {
  return {
    ...DEFAULT_TARGETS,
    ...(input.target_nodes === undefined || input.targets?.core_nodes !== undefined ? {} : { core_nodes: input.target_nodes.length }),
    ...(input.targets ?? {})
  };
}

function summarizeOfficialEdge(
  edge: WorkbenchEdge,
  input: {
    evidences: readonly WorkbenchEvidence[];
    strengthEdgeIds: ReadonlySet<string>;
    freshnessEdgeIds: ReadonlySet<string>;
    unknowns: readonly WorkbenchUnknownItem[];
  }
): OfficialDisclosureReadinessEdge {
  const evidences = activeEvidenceForEdge(edge, input.evidences);
  const sourceAdapters = uniqueSorted(evidences.map((evidence) => evidence.source_adapter_id).filter(nonEmptyString));
  const sourceUrls = uniqueSorted(evidences.map((evidence) => evidence.source_url).filter(nonEmptyString));
  const sourceDocuments = uniqueSorted(evidences.map(sourceDocumentIdentity).filter(nonEmptyString));
  return {
    edge_id: edge.edge_id,
    from_id: edge.from_id,
    from_name: edge.from_name,
    to_id: edge.to_id,
    to_name: edge.to_name,
    relation: edge.relation,
    component_id: edge.component_id,
    evidence_level: edge.evidence_level,
    confidence: edge.confidence,
    evidence_ids: uniqueSorted([...edge.evidence_ids, ...evidences.map((evidence) => evidence.evidence_id)]),
    source_adapters: sourceAdapters,
    source_urls: sourceUrls,
    source_documents: sourceDocuments,
    traceability_state: traceabilityState(evidences),
    corroboration_state: corroborationState(evidences),
    has_strength: input.strengthEdgeIds.has(edge.edge_id),
    has_freshness: input.freshnessEdgeIds.has(edge.edge_id),
    unknown_ids: input.unknowns.map((unknown) => unknown.unknown_id).sort(),
    single_source_disposition_unknown_ids: input.unknowns
      .filter((unknown) => isSingleSourceDispositionUnknown(unknown, edge.edge_id))
      .map((unknown) => unknown.unknown_id)
      .sort()
  };
}

function activeEvidenceForEdge(edge: WorkbenchEdge, evidences: readonly WorkbenchEvidence[]): WorkbenchEvidence[] {
  const edgeEvidenceIds = new Set(edge.evidence_ids);
  return evidences
    .filter((evidence) => evidence.superseded_by === null)
    .filter((evidence) => evidence.edge_id === edge.edge_id || edgeEvidenceIds.has(evidence.evidence_id))
    .filter((evidence) => evidence.evidence_level >= 4 && !evidence.is_inferred);
}

function traceabilityState(evidences: readonly WorkbenchEvidence[]): OfficialDisclosureTraceabilityState {
  if (evidences.some(hasCompleteTrace)) return "complete";
  if (evidences.some(hasPartialTrace)) return "partial";
  return "missing";
}

function hasCompleteTrace(evidence: WorkbenchEvidence): boolean {
  return (
    evidence.cite_text.trim().length > 0 &&
    evidence.source_url.trim().length > 0 &&
    evidence.source_adapter_id.trim().length > 0 &&
    (evidence.cite_text_sha256 !== null || evidence.normalized_cite_text_sha256 !== null || evidence.source_snapshot_sha256 !== null)
  );
}

function hasPartialTrace(evidence: WorkbenchEvidence): boolean {
  return evidence.cite_text.trim().length > 0 && (evidence.source_url.trim().length > 0 || evidence.source_adapter_id.trim().length > 0);
}

function corroborationState(evidences: readonly WorkbenchEvidence[]): OfficialDisclosureCorroborationState {
  if (evidences.length === 0) return "missing_evidence";
  if (uniqueSorted(evidences.map((evidence) => evidence.source_adapter_id).filter(nonEmptyString)).length >= 2) return "cross_source";
  return "single_source";
}

function evidenceByEdgeId(evidences: readonly WorkbenchEvidence[]): Map<string, WorkbenchEvidence[]> {
  const byEdge = new Map<string, WorkbenchEvidence[]>();
  for (const evidence of evidences) {
    if (evidence.edge_id === null) continue;
    const group = byEdge.get(evidence.edge_id) ?? [];
    group.push(evidence);
    byEdge.set(evidence.edge_id, group);
  }
  return byEdge;
}

function unknownsByReferencedEdge(unknowns: readonly WorkbenchUnknownItem[], edgeIds: readonly string[]): Map<string, WorkbenchUnknownItem[]> {
  const byEdge = new Map<string, WorkbenchUnknownItem[]>();
  for (const edgeId of edgeIds) {
    const matching = unknowns.filter((unknown) => unknownReferencesEdge(unknown, edgeId));
    if (matching.length > 0) byEdge.set(edgeId, matching);
  }
  return byEdge;
}

function unknownReferencesEdge(unknown: WorkbenchUnknownItem, edgeId: string): boolean {
  if (unknown.scope_kind === "edge" && unknown.scope_id === edgeId) return true;
  return (
    unknown.question.includes(edgeId) ||
    unknown.why_unknown.includes(edgeId) ||
    unknown.blocking_data_sources.some((source) => source.includes(edgeId)) ||
    unknown.proxies.some((proxy) => proxy.includes(edgeId))
  );
}

function isSingleSourceDispositionUnknown(unknown: WorkbenchUnknownItem, edgeId: string): boolean {
  if (!unknownReferencesEdge(unknown, edgeId)) return false;
  const haystack = [unknown.unknown_id, unknown.question, unknown.why_unknown, ...unknown.blocking_data_sources, ...unknown.proxies].join(" ");
  const mentionsSingleSource = /\b(?:single[-\s]?source|sole[-\s]?source)\b/i.test(haystack);
  const mentionsDisposition = /\b(?:disposition|corroborat|second[-\s]?source|counterparty|official disclosure)\b/i.test(haystack);
  return mentionsSingleSource && mentionsDisposition;
}

function sourceDocumentIdentity(evidence: WorkbenchEvidence): string {
  if (evidence.source_url.trim().length > 0) return `${evidence.source_adapter_id}:${evidence.source_url}`;
  if (evidence.cite_locator !== null && evidence.cite_locator.trim().length > 0) return `${evidence.source_adapter_id}:${evidence.cite_locator}`;
  return evidence.source_adapter_id;
}

function compareReadinessEdges(left: OfficialDisclosureReadinessEdge, right: OfficialDisclosureReadinessEdge): number {
  return (
    traceabilityOrder(left.traceability_state) - traceabilityOrder(right.traceability_state) ||
    corroborationOrder(left.corroboration_state) - corroborationOrder(right.corroboration_state) ||
    right.evidence_level - left.evidence_level ||
    left.edge_id.localeCompare(right.edge_id)
  );
}

function traceabilityOrder(state: OfficialDisclosureTraceabilityState): number {
  return TRACEABILITY_ORDER[state];
}

function corroborationOrder(state: OfficialDisclosureCorroborationState): number {
  return CORROBORATION_ORDER[state];
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function nonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}
