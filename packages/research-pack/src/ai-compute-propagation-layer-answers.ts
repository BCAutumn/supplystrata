import type {
  AiComputePropagationLayerReadinessAnswers,
  AiComputePropagationNextResearchTarget,
  AiComputePropagationOfficialEvidenceGap,
  AiComputePropagationPolicy,
  AiComputePropagationSourceTargetStatusSummary,
  AiComputePropagationUnknownBacklogSummary
} from "./ai-compute-propagation-readiness-definitions.js";

export function buildAiComputePropagationLayerReadinessAnswers(input: {
  fact_edge_refs: readonly string[];
  observation_refs: readonly string[];
  observation_series_refs: readonly string[];
  component_dependency_refs: readonly string[];
  frontier_refs: readonly string[];
  official_evidence_gaps: readonly AiComputePropagationOfficialEvidenceGap[];
  unknown_backlog_summary: AiComputePropagationUnknownBacklogSummary;
  next_research_targets: readonly AiComputePropagationNextResearchTarget[];
  source_target_status_summary: AiComputePropagationSourceTargetStatusSummary;
  allowed_research_outputs: readonly string[];
  prohibited_truth_store_writes: readonly string[];
  policy: AiComputePropagationPolicy;
}): AiComputePropagationLayerReadinessAnswers {
  return {
    fact_edges: {
      count: input.fact_edge_refs.length,
      refs: [...input.fact_edge_refs]
    },
    non_fact_inputs: {
      observation_refs: uniqueSorted([...input.observation_refs, ...input.observation_series_refs]),
      lead_refs: uniqueSorted([...input.component_dependency_refs, ...input.frontier_refs])
    },
    official_evidence: {
      gaps: input.official_evidence_gaps.length,
      by_gap_kind: countBy(input.official_evidence_gaps, (gap) => gap.gap_kind)
    },
    unknowns: input.unknown_backlog_summary,
    next_research: {
      by_target_kind: countBy(input.next_research_targets, (target) => target.target_kind),
      target_refs: input.next_research_targets.map((target) => `${target.target_kind}:${target.target_id}`)
    },
    source_targets: input.source_target_status_summary,
    output_policy: {
      allowed_research_outputs: [...input.allowed_research_outputs],
      prohibited_truth_store_writes: [...input.prohibited_truth_store_writes],
      truth_store_write_policy: input.policy
    }
  };
}

function countBy<T>(values: readonly T[], keyFor: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = keyFor(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort((left, right) => left.localeCompare(right));
}
