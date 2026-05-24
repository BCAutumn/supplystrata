import type { SourcePlanCheckTargetSuggestion, SourcePlanItem } from "@supplystrata/source-plan";
import type { InvestigationBacklogItem, InvestigationBacklogSourceTargetCoverage } from "./investigation-backlog.js";
import type { CorroborationSourcePlanNextAction, CorroborationSourcePlanTargetRef } from "./corroboration-source-plan-definitions.js";

export function buildCorroborationTargetRefs(reviews: readonly InvestigationBacklogItem[]): CorroborationSourcePlanTargetRef[] {
  const byKey = new Map<string, CorroborationSourcePlanTargetRef>();
  for (const review of reviews) {
    for (const target of review.runnable_check_targets) {
      const coverage = coverageForTarget(review.source_target_coverage, target);
      const nextAction = nextActionForTarget(coverage);
      const ref: CorroborationSourcePlanTargetRef = {
        backlog_id: review.backlog_id,
        edge_ids: review.target.edge_ids,
        unknown_ids: review.target.unknown_ids,
        source_adapter_id: target.source_adapter_id,
        target_kind: target.target_kind,
        target_config: copyTargetConfig(target.target_config),
        coverage_state: coverage?.state ?? null,
        check_target_id: coverage?.check_target_id ?? null,
        preflight_status: coverage?.preflight_status ?? null,
        preflight_issue_kind: coverage?.preflight_issue_kind ?? null,
        preflight_missing_credential_env_keys: coverage?.preflight_missing_credential_env_keys ?? [],
        next_action: nextAction.next_action,
        next_action_reason: nextAction.next_action_reason
      };
      byKey.set(sourceTargetKey(ref), mergeTargetRef(byKey.get(sourceTargetKey(ref)), ref));
    }
  }
  return [...byKey.values()].sort(compareTargetRefs);
}

export function filterCorroborationSourcePlan(
  sourcePlan: readonly SourcePlanItem[],
  targetRefsByKey: ReadonlyMap<string, CorroborationSourcePlanTargetRef>,
  options: { annotate: boolean }
): SourcePlanItem[] {
  return sourcePlan
    .map((item) => {
      const suggestedTargets = item.suggested_check_targets
        .filter((target) => target.runnable)
        .flatMap((target) => {
          const ref = targetRefsByKey.get(sourceTargetKey(target));
          if (ref === undefined) return [];
          return [options.annotate ? annotateTargetForCorroboration(target, ref) : cloneTargetSuggestion(target)];
        });
      return {
        ...item,
        reasons: uniqueSorted([...item.reasons, ...suggestedTargets.map((target) => target.reason)]),
        suggested_check_targets: suggestedTargets
      };
    })
    .filter((item) => item.suggested_check_targets.length > 0)
    .sort((left, right) => left.source_id.localeCompare(right.source_id));
}

export function sourceTargetKey(target: { source_adapter_id: string; target_kind: string; target_config: Record<string, unknown> }): string {
  return `${target.source_adapter_id}:${target.target_kind}:${stableConfigKey(target.target_config)}`;
}

function mergeTargetRef(left: CorroborationSourcePlanTargetRef | undefined, right: CorroborationSourcePlanTargetRef): CorroborationSourcePlanTargetRef {
  if (left === undefined) return right;
  return {
    ...left,
    edge_ids: uniqueSorted([...left.edge_ids, ...right.edge_ids]),
    unknown_ids: uniqueSorted([...left.unknown_ids, ...right.unknown_ids]),
    preflight_missing_credential_env_keys: uniqueSorted([...left.preflight_missing_credential_env_keys, ...right.preflight_missing_credential_env_keys]),
    ...higherPriorityNextAction(left, right)
  };
}

interface CorroborationNextActionRule {
  matches(coverage: InvestigationBacklogSourceTargetCoverage | undefined): boolean;
  resolve(coverage: InvestigationBacklogSourceTargetCoverage | undefined): {
    next_action: CorroborationSourcePlanNextAction;
    next_action_reason: string;
  };
}

const FIX_TARGET_CONFIG_ISSUES = ["target_config_invalid", "connector_unsupported"] as const;
const WAIT_FOR_JOB_STATES = ["scheduled", "active_job", "retry_wait"] as const;
const INVESTIGATE_FAILURE_STATES = ["degraded", "dead"] as const;

const CORROBORATION_NEXT_ACTION_RULES: readonly CorroborationNextActionRule[] = [
  {
    matches: (coverage) => coverage?.preflight_issue_kind === "missing_credentials",
    resolve: (coverage) => {
      const checked = requireCoverageForNextAction(coverage, "configure_credentials");
      return {
        next_action: "configure_credentials",
        next_action_reason: `Configure required credential env keys: ${checked.preflight_missing_credential_env_keys.join(", ")}.`
      };
    }
  },
  {
    matches: (coverage) =>
      coverage?.preflight_issue_kind !== null &&
      coverage?.preflight_issue_kind !== undefined &&
      stringSetIncludes(FIX_TARGET_CONFIG_ISSUES, coverage.preflight_issue_kind),
    resolve: (coverage) => {
      const checked = requireCoverageForNextAction(coverage, "fix_target_config");
      return {
        next_action: "fix_target_config",
        next_action_reason: `Fix preflight issue ${checked.preflight_issue_kind ?? "unknown_issue"} before syncing this target.`
      };
    }
  },
  {
    matches: (coverage) => coverage?.preflight_status === "failed",
    resolve: (coverage) => {
      const checked = requireCoverageForNextAction(coverage, "retry_preflight");
      return {
        next_action: "retry_preflight",
        next_action_reason: `Preflight failed with ${checked.preflight_issue_kind ?? "unknown_issue"}; rerun smoke after the source or target issue is fixed.`
      };
    }
  },
  {
    matches: (coverage) => coverage === undefined || coverage.preflight_status === null,
    resolve: () => ({
      next_action: "smoke_target",
      next_action_reason: "Run source-plan smoke for this filtered target before syncing it into continuous monitoring."
    })
  },
  {
    matches: (coverage) => coverage?.state === "not_synced",
    resolve: () => ({
      next_action: "sync_target",
      next_action_reason: "Preflight context exists; sync this target into source_check_targets with the selected namespace."
    })
  },
  {
    matches: (coverage) => coverage?.state === "disabled" || coverage?.state === "policy_disabled",
    resolve: () => ({
      next_action: "enable_target",
      next_action_reason: "The target is synced but disabled; enable it through source-management before due processing."
    })
  },
  {
    matches: (coverage) => coverage?.state === "due",
    resolve: () => ({
      next_action: "run_due_target",
      next_action_reason: "The target is enabled and due; run the due source-check worker path."
    })
  },
  {
    matches: (coverage) => coverage !== undefined && stringSetIncludes(WAIT_FOR_JOB_STATES, coverage.state),
    resolve: (coverage) => {
      const checked = requireCoverageForNextAction(coverage, "wait_for_job");
      return {
        next_action: "wait_for_job",
        next_action_reason: `The target is ${checked.state}; wait for the scheduled, active, or retrying job to finish before review.`
      };
    }
  },
  {
    matches: (coverage) => coverage !== undefined && stringSetIncludes(INVESTIGATE_FAILURE_STATES, coverage.state),
    resolve: (coverage) => {
      const checked = requireCoverageForNextAction(coverage, "investigate_source_failure");
      return {
        next_action: "investigate_source_failure",
        next_action_reason: `The target is ${checked.state}; inspect latest source event/job failure before drawing corroboration conclusions.`
      };
    }
  },
  {
    matches: () => true,
    resolve: () => ({
      next_action: "review_observations",
      next_action_reason: "The target has completed source-check coverage; review observations or normalized output before changing fact evidence."
    })
  }
];

function nextActionForTarget(coverage: InvestigationBacklogSourceTargetCoverage | undefined): {
  next_action: CorroborationSourcePlanNextAction;
  next_action_reason: string;
} {
  const rule = CORROBORATION_NEXT_ACTION_RULES.find((candidate) => candidate.matches(coverage));
  if (rule === undefined) throw new Error("Corroboration next action rules must include a fallback rule");
  return rule.resolve(coverage);
}

function requireCoverageForNextAction(
  coverage: InvestigationBacklogSourceTargetCoverage | undefined,
  action: CorroborationSourcePlanNextAction
): InvestigationBacklogSourceTargetCoverage {
  if (coverage !== undefined) return coverage;
  throw new Error(`Corroboration next action ${action} requires source target coverage`);
}

function stringSetIncludes(values: readonly string[], value: string): boolean {
  return values.includes(value);
}

function higherPriorityNextAction(
  left: CorroborationSourcePlanTargetRef,
  right: CorroborationSourcePlanTargetRef
): Pick<CorroborationSourcePlanTargetRef, "next_action" | "next_action_reason"> {
  return nextActionRank(right.next_action) < nextActionRank(left.next_action)
    ? { next_action: right.next_action, next_action_reason: right.next_action_reason }
    : { next_action: left.next_action, next_action_reason: left.next_action_reason };
}

function nextActionRank(action: CorroborationSourcePlanNextAction): number {
  return [
    "configure_credentials",
    "fix_target_config",
    "retry_preflight",
    "smoke_target",
    "sync_target",
    "enable_target",
    "run_due_target",
    "wait_for_job",
    "investigate_source_failure",
    "review_observations"
  ].indexOf(action);
}

function cloneTargetSuggestion(target: SourcePlanCheckTargetSuggestion): SourcePlanCheckTargetSuggestion {
  return {
    ...target,
    target_config: copyTargetConfig(target.target_config)
  };
}

function annotateTargetForCorroboration(target: SourcePlanCheckTargetSuggestion, ref: CorroborationSourcePlanTargetRef): SourcePlanCheckTargetSuggestion {
  const unknownText = ref.unknown_ids.length === 0 ? "none" : ref.unknown_ids.join(",");
  return {
    ...target,
    target_config: copyTargetConfig(target.target_config),
    reason: `${target.reason} Corroboration review ${ref.backlog_id} for edges ${ref.edge_ids.join(",")}; unknowns ${unknownText}.`
  };
}

function coverageForTarget(
  coverage: readonly InvestigationBacklogSourceTargetCoverage[],
  target: SourcePlanCheckTargetSuggestion
): InvestigationBacklogSourceTargetCoverage | undefined {
  const targetKey = sourceTargetKey(target);
  return coverage.find((item) => sourceTargetKey(item) === targetKey);
}

function copyTargetConfig(config: Record<string, string | number | boolean | string[]>): Record<string, string | number | boolean | string[]> {
  const output: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(config).sort(([left], [right]) => left.localeCompare(right))) {
    output[key] = Array.isArray(value) ? [...value] : value;
  }
  return output;
}

function stableConfigKey(config: Record<string, unknown>): string {
  return Object.entries(config)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${stableConfigValue(value)}`)
    .join(";");
}

function stableConfigValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableConfigValue).join(",")}]`;
  if (isRecord(value)) return `{${stableConfigKey(value)}}`;
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareTargetRefs(left: CorroborationSourcePlanTargetRef, right: CorroborationSourcePlanTargetRef): number {
  return (
    left.source_adapter_id.localeCompare(right.source_adapter_id) ||
    left.target_kind.localeCompare(right.target_kind) ||
    stableConfigKey(left.target_config).localeCompare(stableConfigKey(right.target_config))
  );
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
