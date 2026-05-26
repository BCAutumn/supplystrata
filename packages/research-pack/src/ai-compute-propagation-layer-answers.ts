import type {
  AiComputePropagationLayerReadinessAnswers,
  AiComputePropagationNextResearchTarget,
  AiComputePropagationOfficialEvidenceGap,
  AiComputePropagationPolicy,
  AiComputePropagationSourceTargetReadinessAnswer,
  AiComputePropagationSourceTargetStatus,
  AiComputePropagationSourceTargetStatusSummary,
  AiComputePropagationUnknownBacklogSummary
} from "./ai-compute-propagation-readiness-definitions.js";
import { isBlockedSourceTarget, isRunnableSourceTarget } from "./ai-compute-propagation-source-target-summary.js";

export function buildAiComputePropagationLayerReadinessAnswers(input: {
  fact_edge_refs: readonly string[];
  observation_refs: readonly string[];
  observation_series_refs: readonly string[];
  component_dependency_refs: readonly string[];
  frontier_refs: readonly string[];
  official_evidence_gaps: readonly AiComputePropagationOfficialEvidenceGap[];
  unknown_backlog_summary: AiComputePropagationUnknownBacklogSummary;
  next_research_targets: readonly AiComputePropagationNextResearchTarget[];
  source_target_statuses: readonly AiComputePropagationSourceTargetStatus[];
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
    source_targets: sourceTargetReadinessAnswer(input.source_target_status_summary, input.source_target_statuses),
    output_policy: {
      allowed_research_outputs: [...input.allowed_research_outputs],
      prohibited_truth_store_writes: [...input.prohibited_truth_store_writes],
      truth_store_write_policy: input.policy
    }
  };
}

function sourceTargetReadinessAnswer(
  summary: AiComputePropagationSourceTargetStatusSummary,
  statuses: readonly AiComputePropagationSourceTargetStatus[]
): AiComputePropagationSourceTargetReadinessAnswer {
  return {
    ...summary,
    runnable_refs: uniqueSorted(statuses.filter(isRunnableSourceTarget).map((status) => status.ref)),
    blocked_refs: uniqueSorted(statuses.filter(isBlockedSourceTarget).map((status) => status.ref)),
    degraded_refs: uniqueSorted(statuses.filter((status) => status.state === "degraded").map((status) => status.ref)),
    missing_credentials_refs: uniqueSorted(statuses.filter((status) => status.failure_kind === "missing_credentials").map((status) => status.ref)),
    source_failed_refs: uniqueSorted(statuses.filter((status) => status.latest_event_type === "SOURCE_FAILED").map((status) => status.ref))
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
