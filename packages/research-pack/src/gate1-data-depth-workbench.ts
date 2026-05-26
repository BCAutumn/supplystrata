import type {
  Gate1DataDepthActionBatch,
  Gate1DataDepthActionBatchDefinition,
  Gate1DataDepthActionBatchKind,
  Gate1DataDepthCommandHint,
  Gate1DataDepthFrontendActionKind,
  Gate1DataDepthPriority,
  Gate1DataDepthReviewDecision,
  Gate1DataDepthReviewPolicy,
  Gate1DataDepthSourceTargetRef,
  Gate1DataDepthSummary,
  Gate1DataDepthWorkbench,
  Gate1DataDepthWorkbenchInput,
  Gate1DataDepthWorkbenchItem,
  Gate1DataDepthWorkstream
} from "./gate1-data-depth-workbench-definitions.js";
import { buildGate1DataDepthItems } from "./gate1-data-depth-workbench-items.js";

export type {
  Gate1DataDepthActionBatch,
  Gate1DataDepthActionBatchDefinition,
  Gate1DataDepthActionBatchKind,
  Gate1DataDepthCommandHint,
  Gate1DataDepthFrontendActionKind,
  Gate1DataDepthPriority,
  Gate1DataDepthReviewDecision,
  Gate1DataDepthReviewPolicy,
  Gate1DataDepthSourceTargetRef,
  Gate1DataDepthSummary,
  Gate1DataDepthWorkbench,
  Gate1DataDepthWorkbenchInput,
  Gate1DataDepthWorkbenchItem,
  Gate1DataDepthWorkstream
} from "./gate1-data-depth-workbench-definitions.js";
export { renderGate1DataDepthWorkbenchMarkdown } from "./gate1-data-depth-workbench-render.js";

const REVIEW_POLICY = "review_only_no_fact_mutation";
const GATE1_FACT_EDGE_SCOPE = "research_pack_visible_target_profile_l4_l5_edges";

export const GATE1_DATA_DEPTH_ACTION_BATCHES = [
  {
    kind: "p0",
    file_name: "gate1-data-depth-p0.json",
    description: "Gate 1 data-depth P0 items that need review or operational action first",
    priorities: ["P0"]
  },
  {
    kind: "source_blockers",
    file_name: "gate1-data-depth-source-blockers.json",
    description: "Gate 1 source blockers grouped for credential, configuration, or source-health repair",
    workstreams: ["source_blocker"]
  },
  {
    kind: "labeling",
    file_name: "gate1-data-depth-labeling.json",
    description: "Gate 1 observation calibration labeling batch for gold-label growth",
    workstreams: ["observation_calibration"]
  },
  {
    kind: "corroboration",
    file_name: "gate1-data-depth-corroboration.json",
    description: "Gate 1 edge corroboration review items for counterparty official-source checking",
    workstreams: ["counterparty_corroboration"]
  },
  {
    kind: "entity_context",
    file_name: "gate1-data-depth-entity-context.json",
    description: "Gate 1 entity affiliation context items for parent/subsidiary or business-unit review",
    workstreams: ["entity_context"]
  },
  {
    kind: "adjacent_facts",
    file_name: "gate1-data-depth-adjacent-facts.json",
    description: "Gate 1 adjacent official fact edges grouped by component for recursive company research",
    workstreams: ["adjacent_official_facts"]
  },
  {
    kind: "intelligence_context",
    file_name: "gate1-data-depth-intelligence-context.json",
    description: "Gate 1 strength and propagation-context items that remain reasoning inputs only",
    workstreams: ["strength_context", "propagation_context"]
  }
] as const satisfies readonly Gate1DataDepthActionBatchDefinition[];

const WORKSTREAM_ORDER: Record<Gate1DataDepthWorkstream, number> = {
  fact_edge_growth: 0,
  adjacent_official_facts: 1,
  entity_context: 2,
  source_blocker: 3,
  counterparty_corroboration: 4,
  observation_calibration: 5,
  propagation_context: 6,
  strength_context: 7
};

const PRIORITY_ORDER: Record<Gate1DataDepthPriority, number> = { P0: 0, P1: 1, P2: 2 };

export function buildGate1DataDepthWorkbench(input: Gate1DataDepthWorkbenchInput): Gate1DataDepthWorkbench {
  const items = buildGate1DataDepthItems(input).sort(compareItems);
  return {
    schema_version: "1.0.0",
    generated_at: input.generated_at,
    company_id: input.company_id,
    summary: summarizeWorkbench(input, items),
    items
  };
}

export function buildGate1DataDepthActionBatch(workbench: Gate1DataDepthWorkbench, definition: Gate1DataDepthActionBatchDefinition): Gate1DataDepthActionBatch {
  const items = workbench.items.filter((item) => actionBatchIncludes(definition, item));
  return {
    schema_version: "1.0.0",
    generated_at: workbench.generated_at,
    company_id: workbench.company_id,
    batch_kind: definition.kind,
    review_policy: REVIEW_POLICY,
    automatic_fact_mutation_allowed: false,
    summary: {
      items: items.length,
      p0: items.filter((item) => item.priority === "P0").length,
      p1: items.filter((item) => item.priority === "P1").length,
      p2: items.filter((item) => item.priority === "P2").length,
      source_targets: items.reduce((count, item) => count + item.source_targets.length, 0),
      edge_refs: uniqueSorted(items.flatMap((item) => item.edge_ids)).length,
      component_refs: uniqueSorted(items.flatMap((item) => item.component_ids)).length,
      by_workstream: countByWorkstream(items),
      by_source_adapter: countBySourceAdapter(items)
    },
    items
  };
}

function summarizeWorkbench(input: Gate1DataDepthWorkbenchInput, items: readonly Gate1DataDepthWorkbenchItem[]): Gate1DataDepthSummary {
  const factEdgeTarget = input.official_disclosure_readiness.targets.level_4_5_fact_edges;
  const l4L5Edges = input.official_disclosure_readiness.summary.level_4_5_fact_edges;
  return {
    items: items.length,
    p0: items.filter((item) => item.priority === "P0").length,
    p1: items.filter((item) => item.priority === "P1").length,
    p2: items.filter((item) => item.priority === "P2").length,
    by_workstream: countByWorkstream(items),
    fact_edge_scope: GATE1_FACT_EDGE_SCOPE,
    fact_edge_gap_to_target: Math.max(0, factEdgeTarget - l4L5Edges),
    fact_edge_target: factEdgeTarget,
    l4_l5_fact_edges: l4L5Edges,
    cross_source_edges: input.official_disclosure_readiness.summary.cross_source_edges,
    corroboration_or_disposition_edges: input.official_disclosure_readiness.summary.corroboration_or_disposition_edges,
    source_blockers: items.filter((item) => item.workstream === "source_blocker").length,
    adjacent_official_fact_edges: input.adjacent_official_facts.summary.fact_edges,
    adjacent_official_fact_companies: input.adjacent_official_facts.summary.companies,
    entity_context_items: input.entity_affiliation_contexts?.length ?? 0,
    strength_missing_edges: input.official_disclosure_readiness.summary.edges_missing_strength,
    observation_labeling_batch: input.source_target_coverage.observation_review.labeling_plan.candidates.length,
    propagation_contexts_not_ready: input.propagation_readiness.summary.partial + input.propagation_readiness.summary.blocked,
    ai_compute_propagation_layers_not_covered:
      input.propagation_readiness.ai_compute_matrix.summary.layers_total - input.propagation_readiness.ai_compute_matrix.summary.covered_fact,
    ai_compute_propagation_blocked_source: input.propagation_readiness.ai_compute_matrix.summary.blocked_source,
    ai_compute_propagation_unknown_open: input.propagation_readiness.ai_compute_matrix.summary.unknown_open,
    ai_compute_official_evidence_gaps: input.propagation_readiness.ai_compute_matrix.layers.reduce(
      (count, layer) => count + layer.official_evidence_gaps.length,
      0
    ),
    ai_compute_official_evidence_gaps_by_kind: countOfficialEvidenceGaps(input.propagation_readiness.ai_compute_matrix.layers),
    ranking_calibration_candidates: rankingCandidates(items).length,
    ranking_labeled_candidates: rankingCandidates(items).filter((candidate) => candidate.review_status === "labeled").length,
    ranking_unlabeled_candidates: rankingCandidates(items).filter((candidate) => candidate.review_status === "unlabeled").length,
    ranking_labels_by_persisted_label: countRankingLabels(items)
  };
}

function countOfficialEvidenceGaps(layers: readonly { official_evidence_gaps: readonly { gap_kind: string }[] }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const gap of layers.flatMap((layer) => layer.official_evidence_gaps)) counts[gap.gap_kind] = (counts[gap.gap_kind] ?? 0) + 1;
  const sorted: Record<string, number> = {};
  for (const [kind, count] of Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))) sorted[kind] = count;
  return sorted;
}

function rankingCandidates(items: readonly Gate1DataDepthWorkbenchItem[]): Gate1DataDepthWorkbenchItem["ranking_contexts"][number]["candidates"] {
  return items.flatMap((item) => item.ranking_contexts.flatMap((context) => context.candidates));
}

function countRankingLabels(items: readonly Gate1DataDepthWorkbenchItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const candidate of rankingCandidates(items)) {
    if (candidate.latest_label === null) continue;
    counts[candidate.latest_label.label] = (counts[candidate.latest_label.label] ?? 0) + 1;
  }
  const sorted: Record<string, number> = {};
  for (const [label, count] of Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))) sorted[label] = count;
  return sorted;
}

function countByWorkstream(items: readonly Gate1DataDepthWorkbenchItem[]): Record<Gate1DataDepthWorkstream, number> {
  const counts: Record<Gate1DataDepthWorkstream, number> = {
    fact_edge_growth: 0,
    adjacent_official_facts: 0,
    counterparty_corroboration: 0,
    entity_context: 0,
    source_blocker: 0,
    strength_context: 0,
    observation_calibration: 0,
    propagation_context: 0
  };
  for (const item of items) counts[item.workstream] += 1;
  return counts;
}

function countBySourceAdapter(items: readonly Gate1DataDepthWorkbenchItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sourceAdapter of items.flatMap((item) => item.source_adapters)) counts[sourceAdapter] = (counts[sourceAdapter] ?? 0) + 1;
  const sorted: Record<string, number> = {};
  for (const [sourceAdapter, count] of Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))) sorted[sourceAdapter] = count;
  return sorted;
}

function actionBatchIncludes(definition: Gate1DataDepthActionBatchDefinition, item: Gate1DataDepthWorkbenchItem): boolean {
  const priorityMatches = definition.priorities === undefined || definition.priorities.includes(item.priority);
  const workstreamMatches = definition.workstreams === undefined || definition.workstreams.includes(item.workstream);
  return priorityMatches && workstreamMatches;
}

function compareItems(left: Gate1DataDepthWorkbenchItem, right: Gate1DataDepthWorkbenchItem): number {
  const priority = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
  if (priority !== 0) return priority;
  const workstream = WORKSTREAM_ORDER[left.workstream] - WORKSTREAM_ORDER[right.workstream];
  if (workstream !== 0) return workstream;
  return left.item_id.localeCompare(right.item_id);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
