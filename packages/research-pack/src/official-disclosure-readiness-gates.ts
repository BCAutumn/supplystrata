import type {
  OfficialDisclosureCorroborationQueueItem,
  OfficialDisclosureExpectedSourceCoverage,
  OfficialDisclosureGate1Scorecard,
  OfficialDisclosureGate1ScorecardCriterion,
  OfficialDisclosureGateStatus,
  OfficialDisclosureReadinessEdge,
  OfficialDisclosureReadinessGap,
  OfficialDisclosureReadinessNode,
  OfficialDisclosureReadinessSourcePlanItem,
  OfficialDisclosureReadinessSummary,
  OfficialDisclosureReadinessTargets
} from "./official-disclosure-readiness-definitions.js";
import {
  actionForOfficialTargets,
  expectedSourceCoverageAction,
  expectedSourceHasCoverage,
  uniqueSourceTargets
} from "./official-disclosure-readiness-source-context.js";

export function gateStatuses(targets: OfficialDisclosureReadinessTargets, summary: OfficialDisclosureReadinessSummary): OfficialDisclosureGateStatus[] {
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
      gate_id: "official_disclosure.corroboration_or_disposition_ratio",
      status: thresholdStatus(summary.corroboration_or_disposition_ratio, targets.corroboration_ratio),
      measured: summary.corroboration_or_disposition_ratio,
      target: targets.corroboration_ratio,
      rationale: "Counts distinct source-adapter corroboration plus recorded single-source disposition unknowns; unreviewed silence is never counted."
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

export function gate1Scorecard(input: {
  targets: OfficialDisclosureReadinessTargets;
  summary: OfficialDisclosureReadinessSummary;
}): OfficialDisclosureGate1Scorecard {
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
      criterion_id: "corroboration_or_disposition_coverage",
      label: "Corroboration or single-source disposition coverage",
      kind: "completion",
      measured: input.summary.corroboration_or_disposition_ratio,
      target: input.targets.corroboration_ratio,
      rationale: "Counts distinct second-source corroboration plus explicit single-source disposition unknowns; unreviewed silence is not treated as coverage."
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

export function readinessGaps(input: {
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
  if (input.summary.corroboration_or_disposition_ratio < input.targets.corroboration_ratio && input.corroborationQueue.length > 0) {
    gaps.push({
      gap_id: "official-disclosure:corroboration-or-disposition",
      priority: "P1",
      kind: "corroboration_or_disposition_coverage",
      title: "Add second-source corroboration or explicit single-source disposition",
      rationale: `Corroboration/disposition coverage is ${formatPercent(input.summary.corroboration_or_disposition_ratio)}; target is ${formatPercent(input.targets.corroboration_ratio)}. Strict cross-source ratio remains ${formatPercent(input.summary.corroboration_ratio)}.`,
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

const SCORECARD_NEXT_ACTIONS: Readonly<Partial<Record<OfficialDisclosureGate1ScorecardCriterion["criterion_id"], string>>> = {
  core_node_official_coverage: "Close target-node official coverage gaps before expanding into lower-confidence signal sources.",
  level_4_5_fact_edge_coverage:
    "Convert useful official disclosures into reviewable evidence candidates, keeping observations and leads out of the fact layer.",
  corroboration_or_disposition_coverage:
    "Check counterparty official disclosures for single-source edges or record explicit single-source unknown/disposition.",
  fact_edge_traceability: "Backfill cite text, source URL, source adapter, and fingerprint/snapshot context for every Level 4/5 edge."
};

function scorecardNextAction(criterion: OfficialDisclosureGate1ScorecardCriterion): string {
  return (
    SCORECARD_NEXT_ACTIONS[criterion.criterion_id] ??
    "Wire expected source links into concrete source-plan targets, then preview, smoke, sync, and enable them through source-management."
  );
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

function roundSix(value: number): number {
  return Number(value.toFixed(6));
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
