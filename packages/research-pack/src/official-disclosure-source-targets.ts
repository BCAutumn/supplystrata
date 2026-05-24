import type { SourcePlanItem } from "@supplystrata/source-plan";
import type { OfficialDisclosureReadinessSourcePlanItem, OfficialDisclosureReadinessSourceTarget } from "./official-disclosure-readiness-definitions.js";
import type { SourceTargetCoverageReport } from "./source-target-coverage.js";

export function summarizeOfficialSourcePlan(
  sourcePlan: readonly SourcePlanItem[],
  coverage: SourceTargetCoverageReport | undefined
): OfficialDisclosureReadinessSourcePlanItem[] {
  return sourcePlan
    .filter(isOfficialDisclosurePlanItem)
    .map((item) => ({
      source_id: item.source_id,
      source_name: item.source_name,
      priority: item.priority,
      expected_output_layer: item.expected_output_layer,
      relation_policy: item.relation_policy,
      component_ids: uniqueSorted(item.parent_component_ids),
      target_ids: uniqueSorted(item.target_ids),
      reasons: item.reasons.slice(0, 5),
      source_targets: item.suggested_check_targets.map((target) => summarizeSourceTarget(target, coverage)).sort(compareSourceTargets)
    }))
    .sort((left, right) => left.source_id.localeCompare(right.source_id));
}

export function actionForOfficialTargets(targets: readonly OfficialDisclosureReadinessSourceTarget[]): string {
  if (targets.some((target) => target.state === "not_synced")) return "Sync runnable official disclosure targets into source_check_targets first.";
  if (targets.some((target) => target.state === "disabled")) return "Enable synced official disclosure targets after cadence/retry policy review.";
  if (targets.some((target) => target.state === "due")) return "Run due official disclosure targets through the shared source-check worker path.";
  if (targets.some((target) => target.state === "active_job")) return "Wait for active official disclosure source-check jobs before changing conclusions.";
  if (targets.some((target) => target.state === "retry_wait" || target.state === "dead" || target.state === "degraded"))
    return "Inspect failed or degraded official disclosure checks before relying on the latest source state.";
  if (targets.some((target) => (target.observations ?? 0) > 0))
    return "Review produced official disclosure observations and keep any fact-edge promotion behind evidence review.";
  return "Review configured official disclosure targets and collect traceable evidence candidates before expanding to weaker signal sources.";
}

export function uniqueSourceTargets(targets: readonly OfficialDisclosureReadinessSourceTarget[]): OfficialDisclosureReadinessSourceTarget[] {
  const byKey = new Map<string, OfficialDisclosureReadinessSourceTarget>();
  for (const target of targets) byKey.set(target.target_key, target);
  return [...byKey.values()].sort(compareSourceTargets);
}

export function sourceTargetsForNode(
  nodeId: string,
  nodeKind: "company" | "component",
  item: OfficialDisclosureReadinessSourcePlanItem
): OfficialDisclosureReadinessSourceTarget[] {
  return item.source_targets.filter((target) => {
    if (target.target_component_id !== null) return target.target_component_id === nodeId;
    if (target.target_entity_id !== null) {
      if (nodeKind === "company") return target.target_entity_id === nodeId;
      return item.target_ids.includes(nodeId);
    }
    return item.target_ids.includes(nodeId);
  });
}

export function compareSourceTargets(left: OfficialDisclosureReadinessSourceTarget, right: OfficialDisclosureReadinessSourceTarget): number {
  return left.source_adapter_id.localeCompare(right.source_adapter_id) || left.target_kind.localeCompare(right.target_kind);
}

function isOfficialDisclosurePlanItem(item: SourcePlanItem): boolean {
  return item.purpose === "official_disclosure" || (item.expected_output_layer === "edge" && item.relation_policy === "can_create_fact_edge");
}

function summarizeSourceTarget(
  target: SourcePlanItem["suggested_check_targets"][number],
  coverage: SourceTargetCoverageReport | undefined
): OfficialDisclosureReadinessSourceTarget {
  const matched = coverage?.items.find((item) => sourceTargetKey(item.expected_target) === sourceTargetKey(target));
  return {
    source_adapter_id: target.source_adapter_id,
    target_kind: target.target_kind,
    runnable: target.runnable,
    target_key: sourceTargetKey(target),
    target_entity_id: stringConfigValue(target.target_config, "entity_id"),
    target_component_id: stringConfigValue(target.target_config, "component_id"),
    check_target_id: matched?.matched_check_target_id ?? matched?.expected_target.check_target_id ?? null,
    state: matched?.state ?? null,
    synced: matched?.synced ?? null,
    observations: matched?.observations ?? null,
    latest_event_type: matched?.latest_event?.event_type ?? null
  };
}

function sourceTargetKey(target: { source_adapter_id: string; target_kind: string; target_config: Record<string, unknown> }): string {
  return `${target.source_adapter_id}:${target.target_kind}:${stableConfigKey(target.target_config)}`;
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

function stringConfigValue(config: Record<string, unknown>, key: string): string | null {
  const value = config[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
