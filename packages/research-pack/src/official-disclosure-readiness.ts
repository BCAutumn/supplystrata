import type { WorkbenchEdge, WorkbenchEvidence, WorkbenchUnknownItem } from "@supplystrata/workbench-export";
import { buildOfficialDisclosureSignalCorrelationHints } from "./official-disclosure-signal-correlation.js";
import type {
  OfficialDisclosureCorroborationQueueItem,
  OfficialDisclosureCorroborationState,
  OfficialDisclosureExpectedSourceCoverage,
  OfficialDisclosureGate1Scorecard,
  OfficialDisclosureGate1ScorecardCriterion,
  OfficialDisclosureGateStatus,
  OfficialDisclosureReadinessEdge,
  OfficialDisclosureReadinessGap,
  OfficialDisclosureReadinessInput,
  OfficialDisclosureReadinessNode,
  OfficialDisclosureReadinessReport,
  OfficialDisclosureReadinessSourcePlanItem,
  OfficialDisclosureReadinessSourceTarget,
  OfficialDisclosureReadinessSummary,
  OfficialDisclosureReadinessTargets,
  OfficialDisclosureTraceabilityState
} from "./official-disclosure-readiness-definitions.js";
import {
  actionForOfficialTargets,
  buildCorroborationQueue,
  buildExpectedSourceCoverage,
  buildNodeCoverageMatrix,
  buildProfileExpansionCandidates,
  expectedSourceCoverageAction,
  expectedSourceHasCoverage,
  summarizeOfficialSourcePlan,
  uniqueSourceTargets
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

function gateStatuses(targets: OfficialDisclosureReadinessTargets, summary: OfficialDisclosureReadinessSummary): OfficialDisclosureGateStatus[] {
  const coreNodeMeasurement = coreNodeCoverageMeasurement(summary);
  return [
    {
      gate_id: "official_disclosure.core_nodes",
      status: thresholdStatus(coreNodeMeasurement, targets.core_nodes),
      measured: coreNodeMeasurement,
      target: targets.core_nodes,
      rationale:
        summary.target_research_nodes > 0
          ? "Backend Gate 1 is measured against the explicit target node set, counting nodes with fact coverage, source-plan coverage, runnable/synced targets, or official observations."
          : "Backend Gate 1 is falling back to visible research nodes because no explicit target node set was supplied."
    },
    {
      gate_id: "official_disclosure.level_4_5_edges",
      status: thresholdStatus(summary.level_4_5_fact_edges, targets.level_4_5_fact_edges),
      measured: summary.level_4_5_fact_edges,
      target: targets.level_4_5_fact_edges,
      rationale: "Backend Gate 1 expects enough Level 4/5 fact edges before downstream risk and monitoring claims are mature."
    },
    {
      gate_id: "official_disclosure.cross_source_ratio",
      status: thresholdStatus(summary.corroboration_ratio, targets.corroboration_ratio),
      measured: summary.corroboration_ratio,
      target: targets.corroboration_ratio,
      rationale:
        "The conservative baseline counts only distinct source-adapter corroboration; explicit single-source disposition is reported as a gap instead of being inferred from silence."
    },
    {
      gate_id: "official_disclosure.traceability",
      status:
        summary.level_4_5_fact_edges === 0
          ? "blocked"
          : summary.traceable_edges === summary.level_4_5_fact_edges
            ? "pass"
            : summary.traceable_edges > 0
              ? "partial"
              : "blocked",
      measured: summary.traceable_edges,
      target: summary.level_4_5_fact_edges,
      rationale: "Every official fact edge should retain cite text, source URL, source adapter, and a fingerprint or source snapshot hash."
    }
  ];
}

function gate1Scorecard(input: { targets: OfficialDisclosureReadinessTargets; summary: OfficialDisclosureReadinessSummary }): OfficialDisclosureGate1Scorecard {
  const coreNodeMeasurement = coreNodeCoverageMeasurement(input.summary);
  const completionCriteria: OfficialDisclosureGate1ScorecardCriterion[] = [
    scorecardCriterion({
      criterion_id: "core_node_official_coverage",
      label: "Core node official source coverage",
      kind: "completion",
      measured: coreNodeMeasurement,
      target: input.targets.core_nodes,
      rationale:
        input.summary.target_research_nodes > 0
          ? "Counts explicit target nodes with fact coverage, source-plan coverage, runnable/synced targets, or official observations."
          : "Falls back to visible research nodes because no explicit target node set was supplied."
    }),
    scorecardCriterion({
      criterion_id: "level_4_5_fact_edge_coverage",
      label: "Level 4/5 fact edge coverage",
      kind: "completion",
      measured: input.summary.level_4_5_fact_edges,
      target: input.targets.level_4_5_fact_edges,
      rationale: "Counts only auditable Level 4/5 fact edges visible in the current workbench pack."
    }),
    scorecardCriterion({
      criterion_id: "cross_source_corroboration",
      label: "Cross-source corroboration",
      kind: "completion",
      measured: input.summary.corroboration_ratio,
      target: input.targets.corroboration_ratio,
      rationale: "Uses a conservative distinct source-adapter ratio; single-source silence is not treated as corroboration."
    }),
    scorecardCriterion({
      criterion_id: "fact_edge_traceability",
      label: "Fact edge traceability",
      kind: "completion",
      measured: input.summary.traceable_edges,
      target: input.summary.level_4_5_fact_edges,
      rationale: "Every Level 4/5 edge should carry cite text, source URL, source adapter, and fingerprint or snapshot context."
    })
  ];
  const sourcePathCriterion = scorecardCriterion({
    criterion_id: "expected_source_path_coverage",
    label: "Expected official source path coverage",
    kind: "operability",
    measured: input.summary.expected_official_source_links_with_coverage,
    target: input.summary.expected_official_source_links,
    rationale: "Measures whether target-profile expected sources are represented by fact evidence, source-plan paths, runnable/synced targets, or observations."
  });
  const criteria = [...completionCriteria, sourcePathCriterion];
  const dataProgress = averageProgress(completionCriteria);
  const sourcePathProgress = sourcePathCriterion.progress;
  const overallProgress = roundSix(dataProgress * 0.75 + sourcePathProgress * 0.25);
  return {
    scorecard_id: "gate_1_official_disclosure",
    status: scorecardStatus(criteria),
    overall_progress: overallProgress,
    data_progress: dataProgress,
    source_path_progress: sourcePathProgress,
    criteria,
    next_actions: scorecardNextActions(criteria)
  };
}

function scorecardCriterion(input: {
  criterion_id: OfficialDisclosureGate1ScorecardCriterion["criterion_id"];
  label: string;
  kind: OfficialDisclosureGate1ScorecardCriterion["kind"];
  measured: number;
  target: number;
  rationale: string;
}): OfficialDisclosureGate1ScorecardCriterion {
  return {
    criterion_id: input.criterion_id,
    label: input.label,
    kind: input.kind,
    status: input.target <= 0 ? "blocked" : thresholdStatus(input.measured, input.target),
    measured: input.measured,
    target: input.target,
    progress: scorecardProgress(input.measured, input.target),
    rationale: input.rationale
  };
}

function scorecardProgress(measured: number, target: number): number {
  if (target <= 0) return 0;
  return roundSix(Math.min(measured / target, 1));
}

function averageProgress(criteria: readonly OfficialDisclosureGate1ScorecardCriterion[]): number {
  if (criteria.length === 0) return 0;
  return roundSix(criteria.reduce((sum, criterion) => sum + criterion.progress, 0) / criteria.length);
}

function scorecardStatus(criteria: readonly OfficialDisclosureGate1ScorecardCriterion[]): OfficialDisclosureGate1Scorecard["status"] {
  if (criteria.every((criterion) => criterion.status === "pass")) return "pass";
  if (criteria.some((criterion) => criterion.progress > 0)) return "partial";
  return "blocked";
}

function scorecardNextActions(criteria: readonly OfficialDisclosureGate1ScorecardCriterion[]): string[] {
  return criteria.filter((criterion) => criterion.status !== "pass").map(scorecardNextAction);
}

function scorecardNextAction(criterion: OfficialDisclosureGate1ScorecardCriterion): string {
  if (criterion.criterion_id === "core_node_official_coverage")
    return "Close target-node official coverage gaps before expanding into lower-confidence signal sources.";
  if (criterion.criterion_id === "level_4_5_fact_edge_coverage")
    return "Convert useful official disclosures into reviewable evidence candidates, keeping observations and leads out of the fact layer.";
  if (criterion.criterion_id === "cross_source_corroboration")
    return "Check counterparty official disclosures for single-source edges or record explicit single-source unknown/disposition.";
  if (criterion.criterion_id === "fact_edge_traceability")
    return "Backfill cite text, source URL, source adapter, and fingerprint/snapshot context for every Level 4/5 edge.";
  return "Wire expected source links into concrete source-plan targets, then preview, smoke, sync, and enable them through source-management.";
}

function readinessGaps(input: {
  targets: OfficialDisclosureReadinessTargets;
  summary: OfficialDisclosureReadinessSummary;
  nodes: readonly OfficialDisclosureReadinessNode[];
  edges: readonly OfficialDisclosureReadinessEdge[];
  componentIds: readonly string[];
  sourcePlanItems: readonly OfficialDisclosureReadinessSourcePlanItem[];
  expectedSourceCoverage: readonly OfficialDisclosureExpectedSourceCoverage[];
  corroborationQueue: readonly OfficialDisclosureCorroborationQueueItem[];
}): OfficialDisclosureReadinessGap[] {
  const gaps: OfficialDisclosureReadinessGap[] = [];
  const sourceTargets = input.sourcePlanItems.flatMap((item) => item.source_targets);
  const sourcePlanRefs = input.sourcePlanItems.map((item) => `source_plan:${item.source_id}`);
  const missingNodes = input.nodes.filter((node) => node.coverage_state === "missing");
  const coreNodeMeasurement = coreNodeCoverageMeasurement(input.summary);
  if (coreNodeMeasurement < input.targets.core_nodes) {
    gaps.push({
      gap_id: "official-disclosure:core-node-coverage",
      priority: "P0",
      kind: "core_node_coverage",
      title: "Expand official disclosure coverage across the core research nodes",
      rationale:
        input.summary.target_research_nodes > 0
          ? `Only ${coreNodeMeasurement} of ${input.summary.target_research_nodes} explicit target nodes have official disclosure coverage; target is ${input.targets.core_nodes}.`
          : `Only ${input.summary.visible_research_nodes} visible research nodes are represented in this pack; target is ${input.targets.core_nodes}.`,
      action:
        sourceTargets.length > 0
          ? actionForOfficialTargets(sourceTargets)
          : "Prioritize existing official disclosure source-plan targets for uncovered core companies/components before adding lower-confidence signal sources.",
      edge_ids: [],
      component_ids: uniqueSorted(missingNodes.flatMap((node) => (node.node_kind === "component" ? [node.node_id] : []))),
      source_adapters: uniqueSorted(sourceTargets.map((target) => target.source_adapter_id)),
      source_plan_refs: sourcePlanRefs,
      source_targets: sourceTargets
    });
  }
  if (input.summary.level_4_5_fact_edges < input.targets.level_4_5_fact_edges) {
    gaps.push({
      gap_id: "official-disclosure:l4-l5-edge-coverage",
      priority: "P0",
      kind: "level_4_5_edge_coverage",
      title: "Increase audited Level 4/5 fact edge coverage",
      rationale: `This pack has ${input.summary.level_4_5_fact_edges} Level 4/5 fact edges; target is ${input.targets.level_4_5_fact_edges}.`,
      action:
        sourceTargets.length > 0
          ? `${actionForOfficialTargets(sourceTargets)} Convert useful official disclosures into reviewable evidence candidates only after trace validation; do not promote observations or leads into fact edges.`
          : "Use official filings, official supplier lists, and audited company disclosures to add reviewable evidence candidates; do not promote observations or leads into fact edges.",
      edge_ids: [],
      component_ids: uniqueSorted(
        input.nodes.flatMap((node) => (node.node_kind === "component" && node.coverage_state !== "covered_fact" ? [node.node_id] : []))
      ),
      source_adapters: uniqueSorted(sourceTargets.map((target) => target.source_adapter_id)),
      source_plan_refs: sourcePlanRefs,
      source_targets: sourceTargets
    });
  }
  const expectedSourceGaps = input.expectedSourceCoverage.filter((item) => !expectedSourceHasCoverage(item.coverage_state));
  if (expectedSourceGaps.length > 0) {
    gaps.push({
      gap_id: "official-disclosure:expected-source-coverage",
      priority: expectedSourceGaps.some((item) => item.target_priority === "P0") ? "P0" : "P1",
      kind: "expected_official_source_coverage",
      title: "Wire expected official sources for target profile nodes",
      rationale: `${expectedSourceGaps.length} expected official source links are not yet represented by fact evidence, source-plan coverage, or runnable/synced targets.`,
      action: expectedSourceCoverageAction(expectedSourceGaps),
      edge_ids: uniqueSorted(expectedSourceGaps.flatMap((item) => item.fact_edge_ids)),
      component_ids: uniqueSorted(expectedSourceGaps.flatMap((item) => (item.node_kind === "component" ? [item.node_id] : []))),
      source_adapters: uniqueSorted(expectedSourceGaps.map((item) => item.expected_source_id)),
      source_plan_refs: uniqueSorted(expectedSourceGaps.flatMap((item) => item.source_plan_refs)),
      source_targets: uniqueSourceTargets(expectedSourceGaps.flatMap((item) => item.source_targets))
    });
  }
  const traceabilityEdges = input.edges.filter((edge) => edge.traceability_state !== "complete");
  if (traceabilityEdges.length > 0) {
    gaps.push({
      gap_id: "official-disclosure:traceability",
      priority: "P0",
      kind: "traceability",
      title: "Backfill citation traceability for official fact edges",
      rationale: `${traceabilityEdges.length} Level 4/5 edges are missing complete cite text, source URL, source adapter, or fingerprint context.`,
      action: "Backfill evidence trace fields from existing documents or mark the edge for manual review before relying on it in derived analysis.",
      edge_ids: traceabilityEdges.map((edge) => edge.edge_id),
      component_ids: uniqueSorted(traceabilityEdges.flatMap((edge) => (edge.component_id === null ? [] : [edge.component_id]))),
      source_adapters: uniqueSorted(traceabilityEdges.flatMap((edge) => edge.source_adapters)),
      source_plan_refs: [],
      source_targets: []
    });
  }
  if (input.summary.corroboration_ratio < input.targets.corroboration_ratio && input.corroborationQueue.length > 0) {
    gaps.push({
      gap_id: "official-disclosure:cross-source-corroboration",
      priority: "P1",
      kind: "cross_source_corroboration",
      title: "Add second-source corroboration or explicit single-source disposition",
      rationale: `Cross-source ratio is ${formatPercent(input.summary.corroboration_ratio)}; target is ${formatPercent(input.targets.corroboration_ratio)}.`,
      action:
        "For single-source edges, check counterparty official disclosures first; if no second source is expected, record an explicit unknown/disposition instead of treating silence as corroboration.",
      edge_ids: input.corroborationQueue.map((item) => item.edge_id),
      component_ids: uniqueSorted(input.corroborationQueue.flatMap((item) => (item.component_id === null ? [] : [item.component_id]))),
      source_adapters: uniqueSorted(input.corroborationQueue.flatMap((item) => [...item.existing_source_adapters, ...item.candidate_source_ids])),
      source_plan_refs: uniqueSorted(input.corroborationQueue.flatMap((item) => item.source_plan_refs)),
      source_targets: uniqueSourceTargets(input.corroborationQueue.flatMap((item) => item.source_targets))
    });
  }
  const missingStrengthEdges = input.edges.filter((edge) => !edge.has_strength);
  if (missingStrengthEdges.length > 0) {
    gaps.push({
      gap_id: "official-disclosure:edge-strength",
      priority: "P2",
      kind: "edge_strength",
      title: "Resolve missing relationship strength context",
      rationale: `${missingStrengthEdges.length} Level 4/5 edges have no strength estimate in the current intelligence context.`,
      action: "Only write strength when explicit qualitative/dependency/capacity evidence exists; otherwise keep or create explicit unknowns.",
      edge_ids: missingStrengthEdges.map((edge) => edge.edge_id),
      component_ids: uniqueSorted(missingStrengthEdges.flatMap((edge) => (edge.component_id === null ? [] : [edge.component_id]))),
      source_adapters: uniqueSorted(missingStrengthEdges.flatMap((edge) => edge.source_adapters)),
      source_plan_refs: [],
      source_targets: []
    });
  }
  const missingFreshnessEdges = input.edges.filter((edge) => !edge.has_freshness);
  if (missingFreshnessEdges.length > 0) {
    gaps.push({
      gap_id: "official-disclosure:edge-freshness",
      priority: "P1",
      kind: "edge_freshness",
      title: "Refresh freshness for official fact edges",
      rationale: `${missingFreshnessEdges.length} Level 4/5 edges have no freshness record in the current intelligence context.`,
      action: "Run the existing edge intelligence refresh path so stale official disclosures are visible to research-pack and risk views.",
      edge_ids: missingFreshnessEdges.map((edge) => edge.edge_id),
      component_ids: uniqueSorted(missingFreshnessEdges.flatMap((edge) => (edge.component_id === null ? [] : [edge.component_id]))),
      source_adapters: uniqueSorted(missingFreshnessEdges.flatMap((edge) => edge.source_adapters)),
      source_plan_refs: [],
      source_targets: []
    });
  }
  return gaps.sort(compareGaps);
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

function coreNodeCoverageMeasurement(summary: OfficialDisclosureReadinessSummary): number {
  if (summary.target_research_nodes === 0) return summary.visible_research_nodes;
  return summary.target_research_nodes - summary.target_nodes_missing_official_coverage;
}

function thresholdStatus(measured: number, target: number): OfficialDisclosureGateStatus["status"] {
  if (measured >= target) return "pass";
  if (measured > 0) return "partial";
  return "blocked";
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
  if (state === "missing") return 0;
  if (state === "partial") return 1;
  return 2;
}

function corroborationOrder(state: OfficialDisclosureCorroborationState): number {
  if (state === "missing_evidence") return 0;
  if (state === "single_source") return 1;
  return 2;
}

function compareGaps(left: OfficialDisclosureReadinessGap, right: OfficialDisclosureReadinessGap): number {
  return priorityOrder(left.priority) - priorityOrder(right.priority) || left.kind.localeCompare(right.kind);
}

function priorityOrder(priority: OfficialDisclosureReadinessGap["priority"]): number {
  if (priority === "P0") return 0;
  if (priority === "P1") return 1;
  return 2;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function nonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}

function roundSix(value: number): number {
  return Number(value.toFixed(6));
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
