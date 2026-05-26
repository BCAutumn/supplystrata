import type { AiComputePropagationUnknownBacklogSeed, AiComputePropagationUnknownBacklogSummary } from "./ai-compute-propagation-readiness-definitions.js";

export function buildAiComputePropagationUnknownBacklogSummary(input: {
  unknown_refs: readonly string[];
  unknown_backlog_seeds: readonly AiComputePropagationUnknownBacklogSeed[];
}): AiComputePropagationUnknownBacklogSummary {
  return {
    existing_unknowns: input.unknown_refs.length,
    seeds: input.unknown_backlog_seeds.length,
    by_recommended_review_action: countBy(input.unknown_backlog_seeds, (seed) => seed.recommended_review_action),
    target_scope_refs: uniqueSorted(input.unknown_backlog_seeds.flatMap((seed) => seed.target_scope_refs)),
    source_target_refs: uniqueSorted(input.unknown_backlog_seeds.flatMap((seed) => seed.source_target_refs)),
    truth_store_write_policy: "review_only_no_automatic_write"
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
