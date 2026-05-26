import type { AiComputePropagationSourceTargetStatusSummary } from "./ai-compute-propagation-readiness-definitions.js";

export interface AiComputePropagationSourceTargetStatusLike {
  state: string | null;
  failure_kind: string | null;
  latest_event_type: string | null;
}

export function buildAiComputePropagationSourceTargetStatusSummary(
  values: readonly AiComputePropagationSourceTargetStatusLike[]
): AiComputePropagationSourceTargetStatusSummary {
  return {
    targets: values.length,
    runnable_targets: values.filter(isRunnableSourceTarget).length,
    blocked_targets: values.filter(isBlockedSourceTarget).length,
    degraded_targets: values.filter((value) => value.state === "degraded").length,
    missing_credentials: values.filter((value) => value.failure_kind === "missing_credentials").length,
    source_failed_targets: values.filter((value) => value.latest_event_type === "SOURCE_FAILED").length,
    by_state: countBy(values, (value) => value.state ?? "unknown"),
    by_failure_kind: countBy(
      values.filter((value) => value.failure_kind !== null),
      (value) => value.failure_kind ?? "unknown_failure"
    )
  };
}

function isRunnableSourceTarget(value: AiComputePropagationSourceTargetStatusLike): boolean {
  if (value.failure_kind !== null || value.latest_event_type === "SOURCE_FAILED") return false;
  return value.state === "not_synced" || value.state === "due" || value.state === "scheduled" || value.state === "succeeded";
}

function isBlockedSourceTarget(value: AiComputePropagationSourceTargetStatusLike): boolean {
  if (value.failure_kind !== null || value.latest_event_type === "SOURCE_FAILED") return true;
  return (
    value.state === "retry_wait" || value.state === "degraded" || value.state === "dead" || value.state === "disabled" || value.state === "policy_disabled"
  );
}

function countBy<T>(values: readonly T[], keyFor: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = keyFor(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
