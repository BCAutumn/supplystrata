import type {
  CorroborationSourcePlan,
  CorroborationSourcePlanActionBatch,
  CorroborationSourcePlanActionBatchDefinition
} from "./corroboration-source-plan-definitions.js";
import type { CorroborationSourcePlanInput, CorroborationSourcePlanNextAction } from "./corroboration-source-plan-definitions.js";
import { buildCorroborationTargetRefs, filterCorroborationSourcePlan, sourceTargetKey } from "./corroboration-source-plan-targets.js";

export {
  CORROBORATION_SOURCE_PLAN_ACTION_BATCHES,
  type CorroborationSourcePlan,
  type CorroborationSourcePlanActionBatch,
  type CorroborationSourcePlanActionBatchDefinition,
  type CorroborationSourcePlanActionBatchKind,
  type CorroborationSourcePlanInput,
  type CorroborationSourcePlanNextAction,
  type CorroborationSourcePlanTargetRef
} from "./corroboration-source-plan-definitions.js";
export { renderCorroborationSourcePlanMarkdown } from "./corroboration-source-plan-render.js";

export function buildCorroborationSourcePlan(input: CorroborationSourcePlanInput): CorroborationSourcePlan {
  const reviews = input.investigation_backlog.items.filter((item) => item.kind === "corroboration_review");
  const targetRefs = buildCorroborationTargetRefs(reviews);
  const targetRefsByKey = new Map(targetRefs.map((target) => [sourceTargetKey(target), target]));
  const sourcePlan = filterCorroborationSourcePlan(input.source_plan, targetRefsByKey, { annotate: true });
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
      targets_need_enable: targetRefs.filter(hasDisabledSourceTargetCoverage).length,
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

export function buildCorroborationSourcePlanActionBatch(
  plan: CorroborationSourcePlan,
  definition: CorroborationSourcePlanActionBatchDefinition
): CorroborationSourcePlanActionBatch {
  const nextActions = new Set<CorroborationSourcePlanNextAction>(definition.next_actions);
  const targetRefs = plan.target_refs.filter((target) => nextActions.has(target.next_action));
  const targetRefsByKey = new Map(targetRefs.map((target) => [sourceTargetKey(target), target]));
  const sourcePlan = filterCorroborationSourcePlan(plan.source_plan, targetRefsByKey, { annotate: false });
  return {
    schema_version: "1.0.0",
    generated_at: plan.generated_at,
    company_id: plan.company_id,
    batch_kind: definition.kind,
    next_actions: definition.next_actions,
    check_target_ids: uniqueSorted(targetRefs.flatMap((target) => (target.check_target_id === null ? [] : [target.check_target_id]))),
    summary: {
      source_plan_items: sourcePlan.length,
      runnable_targets: sourcePlan.reduce((count, item) => count + item.suggested_check_targets.length, 0),
      target_refs: targetRefs.length,
      review_edges: uniqueSorted(targetRefs.flatMap((target) => target.edge_ids)).length,
      by_source: countBy(targetRefs, (target) => target.source_adapter_id)
    },
    source_plan: sourcePlan
  };
}

function hasDisabledSourceTargetCoverage(target: { coverage_state: string | null }): boolean {
  return target.coverage_state === "disabled" || target.coverage_state === "policy_disabled";
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

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
