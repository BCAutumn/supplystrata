import type { SourcePlanItem } from "@supplystrata/source-plan";
import type { OfficialDisclosureReadinessReport } from "./official-disclosure-readiness.js";
import type { SourceTargetCoverageReport } from "./source-target-coverage.js";
import type {
  AiComputePropagationSourceTargetGroup,
  AiComputePropagationSourceTargetGroupKind,
  AiComputePropagationSourceTargetStatus,
  AiComputePropagationSourceTargetStatusSummary
} from "./ai-compute-propagation-readiness-definitions.js";
import { buildAiComputePropagationSourceTargetStatusSummary } from "./ai-compute-propagation-source-target-summary.js";

export interface AiComputePropagationSourceTargetScope {
  component_ids: readonly string[];
  material_or_process_prefixes: readonly string[];
}

export interface AiComputePropagationLayerSourceTargets {
  source_target_statuses: AiComputePropagationSourceTargetStatus[];
  source_target_groups: AiComputePropagationSourceTargetGroup[];
  source_target_status_summary: AiComputePropagationSourceTargetStatusSummary;
}

export function buildAiComputePropagationLayerSourceTargets(input: {
  scope: AiComputePropagationSourceTargetScope;
  source_plan_items: readonly SourcePlanItem[];
  source_target_coverage: SourceTargetCoverageReport;
  official_nodes: OfficialDisclosureReadinessReport["nodes"];
}): AiComputePropagationLayerSourceTargets {
  const coverageItems = sourceCoverageItemsFor(input.scope, input.source_plan_items, input.source_target_coverage);
  const statuses = sourceTargetStatusesFor(input.scope, input.source_plan_items, coverageItems, input.official_nodes);
  return {
    source_target_statuses: statuses,
    source_target_groups: sourceTargetGroupsFor(input.source_plan_items, statuses),
    source_target_status_summary: buildAiComputePropagationSourceTargetStatusSummary(statuses)
  };
}

function sourceCoverageItemsFor(
  scope: AiComputePropagationSourceTargetScope,
  sourcePlanItems: readonly SourcePlanItem[],
  coverage: SourceTargetCoverageReport
): SourceTargetCoverageReport["items"] {
  const scopedSuggestedTargets = scopedSuggestedTargetsFor(scope, sourcePlanItems);
  return coverage.items.filter(
    (item) =>
      configMatchesScope(item.expected_target.target_config, scope) ||
      scopedSuggestedTargets.some(
        (target) =>
          target.source_adapter_id === item.expected_target.source_adapter_id &&
          target.target_kind === item.expected_target.target_kind &&
          stableConfigKey(target.target_config) === stableConfigKey(item.expected_target.target_config)
      )
  );
}

function sourceTargetStatusesFor(
  scope: AiComputePropagationSourceTargetScope,
  sourcePlanItems: readonly SourcePlanItem[],
  coverageItems: SourceTargetCoverageReport["items"],
  officialNodes: OfficialDisclosureReadinessReport["nodes"]
): AiComputePropagationSourceTargetStatus[] {
  const scopedSuggestedTargets = scopedSuggestedTargetsFor(scope, sourcePlanItems);
  return uniqueSourceTargetStatuses([
    ...coverageItems.map((item) => ({
      ref: `source_target:${item.matched_check_target_id ?? item.expected_target.check_target_id}:${item.state}`,
      source_adapter_id: item.expected_target.source_adapter_id,
      target_kind: item.expected_target.target_kind,
      state: item.state,
      failure_kind: item.latest_job?.failure_kind ?? null,
      latest_event_type: item.latest_event?.event_type ?? null
    })),
    ...officialNodes.flatMap((node) =>
      node.source_targets
        .filter((target) => officialSourceTargetMatchesScope(target, scope, scopedSuggestedTargets))
        .map((target) => ({
          ref: `source_target:${target.check_target_id ?? target.target_key}:${target.state ?? "planned"}`,
          source_adapter_id: target.source_adapter_id,
          target_kind: target.target_kind,
          state: target.state,
          failure_kind: null,
          latest_event_type: target.latest_event_type
        }))
    )
  ]);
}

function scopedSuggestedTargetsFor(
  scope: AiComputePropagationSourceTargetScope,
  sourcePlanItems: readonly SourcePlanItem[]
): SourcePlanItem["suggested_check_targets"] {
  return sourcePlanItems.filter((item) => sourcePlanItemHasNarrowScope(item, scope)).flatMap((item) => item.suggested_check_targets);
}

function sourcePlanItemHasNarrowScope(item: SourcePlanItem, scope: AiComputePropagationSourceTargetScope): boolean {
  const scopedIds = uniqueSorted(item.target_ids.filter(isComponentOrMaterialRef));
  return scopedIds.length > 0 && scopedIds.every((value) => valueMatchesScope(value, scope));
}

function officialSourceTargetMatchesScope(
  target: OfficialDisclosureReadinessReport["nodes"][number]["source_targets"][number],
  scope: AiComputePropagationSourceTargetScope,
  scopedSuggestedTargets: SourcePlanItem["suggested_check_targets"]
): boolean {
  if (target.target_component_id !== null && valueMatchesScope(target.target_component_id, scope)) return true;
  return scopedSuggestedTargets.some(
    (suggested) =>
      suggested.source_adapter_id === target.source_adapter_id &&
      suggested.target_kind === target.target_kind &&
      stableConfigKey(suggested.target_config) === targetConfigKeyFromOfficialTarget(target)
  );
}

function targetConfigKeyFromOfficialTarget(target: OfficialDisclosureReadinessReport["nodes"][number]["source_targets"][number]): string {
  const pairs = target.target_key.split(":").slice(2).join(":");
  if (pairs.length === 0) return "{}";
  const config: Record<string, string | number | boolean | string[]> = {};
  for (const pair of pairs.split(";")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const key = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    config[key] = parseTargetConfigValue(value);
  }
  return stableConfigKey(config);
}

function parseTargetConfigValue(value: string): string | number | boolean | string[] {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]"))
    return value
      .slice(1, -1)
      .split(",")
      .filter((item) => item.length > 0);
  return value;
}

function configMatchesScope(config: Record<string, unknown>, scope: AiComputePropagationSourceTargetScope): boolean {
  const text = stableConfigKey(config);
  return scope.component_ids.some((componentId) => text.includes(componentId)) || scope.material_or_process_prefixes.some((prefix) => text.includes(prefix));
}

function valueMatchesScope(value: string, scope: AiComputePropagationSourceTargetScope): boolean {
  if (scope.component_ids.includes(value)) return true;
  return scope.material_or_process_prefixes.some((prefix) => value.startsWith(prefix) || value.includes(`:${prefix}`));
}

function isComponentOrMaterialRef(value: string): boolean {
  return value.startsWith("COMP-") || value.startsWith("MAT-") || value.includes(":MAT-");
}

function sourceTargetGroupsFor(
  sourcePlanItems: readonly SourcePlanItem[],
  statuses: readonly AiComputePropagationSourceTargetStatus[]
): AiComputePropagationSourceTargetGroup[] {
  const groups = new Map<AiComputePropagationSourceTargetGroupKind, MutableSourceTargetGroup>();
  for (const item of sourcePlanItems) {
    const kind = sourceTargetGroupKindFor(item);
    const group = getMutableSourceTargetGroup(groups, kind);
    group.source_plan_refs.push(`source_plan:${item.source_id}`);
    for (const target of sourceTargetsForSourcePlanItem(item)) {
      group.source_adapters.push(target.source_adapter_id);
      if (target.target_kind !== null) group.target_kinds.push(target.target_kind);
    }
  }

  for (const status of statuses) {
    const matchingGroups = [...groups.values()].filter((group) => sourceTargetStatusMatchesGroup(status, group));
    const targets = matchingGroups.length === 0 ? [getMutableSourceTargetGroup(groups, sourceTargetGroupKindForStatus(status))] : matchingGroups;
    for (const group of targets) {
      group.source_adapters.push(status.source_adapter_id);
      if (status.target_kind !== null) group.target_kinds.push(status.target_kind);
      group.source_target_refs.push(status.ref);
      if (status.state !== null) group.states.push(status.state);
      if (status.failure_kind !== null) group.failure_kinds.push(status.failure_kind);
    }
  }

  return GROUP_ORDER.flatMap((kind) => {
    const group = groups.get(kind);
    if (group === undefined) return [];
    return [
      {
        group_kind: kind,
        source_plan_refs: uniqueSorted(group.source_plan_refs),
        source_target_refs: uniqueSorted(group.source_target_refs),
        source_adapters: uniqueSorted(group.source_adapters),
        target_kinds: uniqueSorted(group.target_kinds),
        states: uniqueSorted(group.states),
        failure_kinds: uniqueSorted(group.failure_kinds)
      }
    ];
  });
}

const GROUP_ORDER: readonly AiComputePropagationSourceTargetGroupKind[] = [
  "official_evidence",
  "observation_proxy",
  "entity_or_facility_context",
  "lead_or_manual_review"
];

interface MutableSourceTargetGroup {
  source_plan_refs: string[];
  source_target_refs: string[];
  source_adapters: string[];
  target_kinds: string[];
  states: string[];
  failure_kinds: string[];
}

function getMutableSourceTargetGroup(
  groups: Map<AiComputePropagationSourceTargetGroupKind, MutableSourceTargetGroup>,
  kind: AiComputePropagationSourceTargetGroupKind
): MutableSourceTargetGroup {
  const existing = groups.get(kind);
  if (existing !== undefined) return existing;
  const group = { source_plan_refs: [], source_target_refs: [], source_adapters: [], target_kinds: [], states: [], failure_kinds: [] };
  groups.set(kind, group);
  return group;
}

function sourceTargetGroupKindFor(item: SourcePlanItem): AiComputePropagationSourceTargetGroupKind {
  if (item.relation_policy === "can_create_fact_edge" || item.expected_output_layer === "edge" || item.purpose === "official_disclosure") {
    return "official_evidence";
  }
  if (
    item.relation_policy === "entity_only" ||
    item.expected_output_layer === "entity" ||
    item.purpose === "entity_resolution" ||
    item.purpose === "facility"
  ) {
    return "entity_or_facility_context";
  }
  if (item.relation_policy === "lead_only" || item.expected_output_layer === "lead" || item.purpose === "manual_review" || item.purpose === "logistics") {
    return "lead_or_manual_review";
  }
  return "observation_proxy";
}

function sourceTargetStatusMatchesGroup(status: AiComputePropagationSourceTargetStatus, group: MutableSourceTargetGroup): boolean {
  if (!group.source_adapters.includes(status.source_adapter_id)) return false;
  return status.target_kind === null || group.target_kinds.length === 0 || group.target_kinds.includes(status.target_kind);
}

function sourceTargetGroupKindForStatus(status: AiComputePropagationSourceTargetStatus): AiComputePropagationSourceTargetGroupKind {
  const targetKind = status.target_kind ?? "";
  if (targetKind.includes("trade") || targetKind.includes("commodity") || targetKind.includes("metric") || targetKind.includes("observation")) {
    return "observation_proxy";
  }
  if (targetKind.includes("entity") || targetKind.includes("facility")) return "entity_or_facility_context";
  if (targetKind.includes("manual") || targetKind.includes("lead") || targetKind.includes("logistics")) return "lead_or_manual_review";
  return "official_evidence";
}

function sourceTargetsForSourcePlanItem(item: SourcePlanItem): { source_adapter_id: string; target_kind: string | null }[] {
  if (item.suggested_check_targets.length === 0) return [{ source_adapter_id: item.source_id, target_kind: null }];
  return item.suggested_check_targets.map((target) => ({
    source_adapter_id: target.source_adapter_id,
    target_kind: target.target_kind
  }));
}

function stableConfigKey(config: Record<string, unknown>): string {
  return stableConfigValue(config);
}

function stableConfigValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableConfigValue).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${stableConfigValue(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort((left, right) => left.localeCompare(right));
}

function uniqueSourceTargetStatuses(values: readonly AiComputePropagationSourceTargetStatus[]): AiComputePropagationSourceTargetStatus[] {
  const byRef = new Map<string, AiComputePropagationSourceTargetStatus>();
  for (const value of values) {
    const existing = byRef.get(value.ref);
    byRef.set(value.ref, existing === undefined ? value : mergeSourceTargetStatus(existing, value));
  }
  return [...byRef.values()].sort((left, right) => left.ref.localeCompare(right.ref));
}

function mergeSourceTargetStatus(
  left: AiComputePropagationSourceTargetStatus,
  right: AiComputePropagationSourceTargetStatus
): AiComputePropagationSourceTargetStatus {
  return {
    ref: left.ref,
    source_adapter_id: left.source_adapter_id,
    target_kind: left.target_kind ?? right.target_kind,
    state: left.state ?? right.state,
    failure_kind: left.failure_kind ?? right.failure_kind,
    latest_event_type: left.latest_event_type ?? right.latest_event_type
  };
}
