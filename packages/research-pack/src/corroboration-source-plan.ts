import type { SourcePlanCheckTargetSuggestion, SourcePlanItem } from "@supplystrata/source-plan";
import type { InvestigationBacklog, InvestigationBacklogItem, InvestigationBacklogSourceTargetCoverage } from "./investigation-backlog.js";

export type CorroborationSourcePlanNextAction =
  | "configure_credentials"
  | "fix_target_config"
  | "retry_preflight"
  | "smoke_target"
  | "sync_target"
  | "enable_target"
  | "run_due_target"
  | "wait_for_job"
  | "investigate_source_failure"
  | "review_observations";

export interface CorroborationSourcePlanTargetRef {
  backlog_id: string;
  edge_ids: string[];
  unknown_ids: string[];
  source_adapter_id: string;
  target_kind: string;
  target_config: Record<string, string | number | boolean | string[]>;
  coverage_state: InvestigationBacklogSourceTargetCoverage["state"] | null;
  check_target_id: string | null;
  preflight_status: InvestigationBacklogSourceTargetCoverage["preflight_status"];
  preflight_issue_kind: InvestigationBacklogSourceTargetCoverage["preflight_issue_kind"];
  preflight_missing_credential_env_keys: readonly string[];
  next_action: CorroborationSourcePlanNextAction;
  next_action_reason: string;
}

export interface CorroborationSourcePlan {
  schema_version: "1.0.0";
  generated_at: string;
  company_id: string;
  summary: {
    review_edges: number;
    disposition_only_edges: number;
    source_plan_items: number;
    runnable_targets: number;
    targets_need_sync: number;
    targets_need_enable: number;
    targets_due: number;
    targets_failed_preflight: number;
    targets_missing_credentials: number;
    by_next_action: Record<string, number>;
    by_source: Record<string, number>;
  };
  target_refs: CorroborationSourcePlanTargetRef[];
  source_plan: SourcePlanItem[];
}

export interface CorroborationSourcePlanInput {
  generated_at: string;
  company_id: string;
  source_plan: readonly SourcePlanItem[];
  investigation_backlog: InvestigationBacklog;
}

export function buildCorroborationSourcePlan(input: CorroborationSourcePlanInput): CorroborationSourcePlan {
  const reviews = input.investigation_backlog.items.filter((item) => item.kind === "corroboration_review");
  const targetRefs = buildTargetRefs(reviews);
  const targetRefsByKey = new Map(targetRefs.map((target) => [sourceTargetKey(target), target]));
  const sourcePlan = filterSourcePlan(input.source_plan, targetRefsByKey);
  return {
    schema_version: "1.0.0",
    generated_at: input.generated_at,
    company_id: input.company_id,
    summary: {
      review_edges: uniqueSorted(reviews.flatMap((item) => item.target.edge_ids)).length,
      disposition_only_edges: reviews.filter((item) => item.runnable_check_targets.length === 0).length,
      source_plan_items: sourcePlan.length,
      runnable_targets: targetRefs.length,
      targets_need_sync: targetRefs.filter((target) => target.coverage_state === "not_synced").length,
      targets_need_enable: targetRefs.filter((target) => target.coverage_state === "disabled").length,
      targets_due: targetRefs.filter((target) => target.coverage_state === "due").length,
      targets_failed_preflight: targetRefs.filter((target) => target.preflight_status === "failed").length,
      targets_missing_credentials: targetRefs.filter((target) => target.preflight_issue_kind === "missing_credentials").length,
      by_next_action: countBy(targetRefs, (target) => target.next_action),
      by_source: countBy(targetRefs, (target) => target.source_adapter_id)
    },
    target_refs: targetRefs,
    source_plan: sourcePlan
  };
}

export function renderCorroborationSourcePlanMarkdown(plan: CorroborationSourcePlan): string {
  const lines = [
    `# Corroboration Source Plan ${plan.company_id}`,
    "",
    `Generated at: ${plan.generated_at}`,
    "",
    "This file is a filtered source-plan for edge-level corroboration reviews. It is executable by the existing source target commands, but it does not fetch sources, write observations, or create fact edges by itself.",
    "",
    "## Summary",
    "",
    `- Review edges: ${plan.summary.review_edges}`,
    `- Disposition-only edges: ${plan.summary.disposition_only_edges}`,
    `- Source-plan items: ${plan.summary.source_plan_items}`,
    `- Runnable targets: ${plan.summary.runnable_targets}`,
    `- Need sync: ${plan.summary.targets_need_sync}`,
    `- Need enable: ${plan.summary.targets_need_enable}`,
    `- Due: ${plan.summary.targets_due}`,
    `- Failed preflight: ${plan.summary.targets_failed_preflight}`,
    `- Missing credentials: ${plan.summary.targets_missing_credentials}`,
    `- By next action: ${formatCountMap(plan.summary.by_next_action)}`,
    `- By source: ${formatCountMap(plan.summary.by_source)}`,
    "",
    "## Targets",
    ""
  ];
  if (plan.target_refs.length === 0) {
    lines.push("No runnable corroboration source targets. Record explicit single-source disposition for disposition-only edges.");
    return lines.join("\n");
  }
  for (const target of plan.target_refs) {
    const coverage = target.coverage_state === null ? "no coverage" : target.coverage_state;
    const preflight =
      target.preflight_status === null
        ? "no preflight"
        : `${target.preflight_status}${target.preflight_issue_kind === null ? "" : `/${target.preflight_issue_kind}`}`;
    lines.push(`- ${target.source_adapter_id}/${target.target_kind}: ${coverage}; ${preflight}`);
    lines.push(`  Next action: ${target.next_action} — ${target.next_action_reason}`);
    lines.push(
      `  Backlog: ${target.backlog_id}; edges=${target.edge_ids.join(",")}; unknowns=${target.unknown_ids.length === 0 ? "none" : target.unknown_ids.join(",")}`
    );
    if (target.check_target_id !== null) lines.push(`  Source target: ${target.check_target_id}`);
    if (target.preflight_missing_credential_env_keys.length > 0) {
      lines.push(`  Missing credentials: ${target.preflight_missing_credential_env_keys.join(", ")}`);
    }
  }
  return lines.join("\n");
}

function buildTargetRefs(reviews: readonly InvestigationBacklogItem[]): CorroborationSourcePlanTargetRef[] {
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

function nextActionForTarget(coverage: InvestigationBacklogSourceTargetCoverage | undefined): {
  next_action: CorroborationSourcePlanNextAction;
  next_action_reason: string;
} {
  if (coverage?.preflight_issue_kind === "missing_credentials") {
    return {
      next_action: "configure_credentials",
      next_action_reason: `Configure required credential env keys: ${coverage.preflight_missing_credential_env_keys.join(", ")}.`
    };
  }
  if (coverage?.preflight_issue_kind === "target_config_invalid" || coverage?.preflight_issue_kind === "connector_unsupported") {
    return {
      next_action: "fix_target_config",
      next_action_reason: `Fix preflight issue ${coverage.preflight_issue_kind} before syncing this target.`
    };
  }
  if (coverage?.preflight_status === "failed") {
    return {
      next_action: "retry_preflight",
      next_action_reason: `Preflight failed with ${coverage.preflight_issue_kind ?? "unknown_issue"}; rerun smoke after the source or target issue is fixed.`
    };
  }
  if (coverage === undefined || coverage.preflight_status === null) {
    return {
      next_action: "smoke_target",
      next_action_reason: "Run source-plan smoke for this filtered target before syncing it into continuous monitoring."
    };
  }
  if (coverage.state === "not_synced") {
    return {
      next_action: "sync_target",
      next_action_reason: "Preflight context exists; sync this target into source_check_targets with the selected namespace."
    };
  }
  if (coverage.state === "disabled" || coverage.state === "policy_disabled") {
    return {
      next_action: "enable_target",
      next_action_reason: "The target is synced but disabled; enable it through source-management before due processing."
    };
  }
  if (coverage.state === "due") {
    return {
      next_action: "run_due_target",
      next_action_reason: "The target is enabled and due; run the due source-check worker path."
    };
  }
  if (coverage.state === "scheduled" || coverage.state === "active_job" || coverage.state === "retry_wait") {
    return {
      next_action: "wait_for_job",
      next_action_reason: `The target is ${coverage.state}; wait for the scheduled, active, or retrying job to finish before review.`
    };
  }
  if (coverage.state === "degraded" || coverage.state === "dead") {
    return {
      next_action: "investigate_source_failure",
      next_action_reason: `The target is ${coverage.state}; inspect latest source event/job failure before drawing corroboration conclusions.`
    };
  }
  return {
    next_action: "review_observations",
    next_action_reason: "The target has completed source-check coverage; review observations or normalized output before changing fact evidence."
  };
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

function filterSourcePlan(sourcePlan: readonly SourcePlanItem[], targetRefsByKey: ReadonlyMap<string, CorroborationSourcePlanTargetRef>): SourcePlanItem[] {
  return sourcePlan
    .map((item) => {
      const suggestedTargets = item.suggested_check_targets
        .filter((target) => target.runnable)
        .flatMap((target) => {
          const ref = targetRefsByKey.get(sourceTargetKey(target));
          return ref === undefined ? [] : [annotateTargetForCorroboration(target, ref)];
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

function sourceTargetKey(target: { source_adapter_id: string; target_kind: string; target_config: Record<string, unknown> }): string {
  return `${target.source_adapter_id}:${target.target_kind}:${stableConfigKey(target.target_config)}`;
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

function countBy<T>(items: readonly T[], keyFn: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const sorted: Record<string, number> = {};
  for (const [key, count] of Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))) sorted[key] = count;
  return sorted;
}

function formatCountMap(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) return "none";
  return entries.map(([key, count]) => `${key}=${count}`).join(", ");
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
