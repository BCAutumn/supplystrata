import {
  listComponentHsCodes,
  listComponentMaterialObservationTargets,
  type ComponentMaterialExposure,
  type ComponentTradeCode,
  type MaterialObservationTarget
} from "@supplystrata/component-context";
import { getSourceById, type RelationAuthority, type SourceCategory, type SourceRegistryEntry, type SourceTier } from "@supplystrata/source-registry";
import type {
  MaterialObservationContext,
  PlannedOutputLayer,
  ResearchSourcePurpose,
  SourcePlanCheckTargetSuggestion,
  SourcePlanContext,
  SourcePlanDraft,
  SourcePlanItem,
  SourceRelationPolicy,
  TradeObservationContext,
  TradeObservationDirection
} from "./definitions.js";
import { buildOfficialDisclosureCheckTargetSuggestions } from "./official-disclosure-targets.js";

const RELATION_AUTHORITY_POLICY_OVERRIDES: Partial<Record<RelationAuthority, SourceRelationPolicy>> = {
  registry_fact: "entity_only",
  macro_trend: "observation_only",
  lead_only: "lead_only"
};

const POLICY_OUTPUT_LAYERS = {
  can_create_fact_edge: "edge",
  observation_only: "observation",
  entity_only: "entity",
  lead_only: "lead"
} as const satisfies Record<SourceRelationPolicy, PlannedOutputLayer>;

const SOURCE_CATEGORY_PURPOSES = {
  official_disclosure: "official_disclosure",
  entity_resolution: "entity_resolution",
  supplier_list: "facility",
  facility: "facility",
  trade: "trade",
  commodity: "commodity",
  macro: "macro",
  logistics: "logistics",
  procurement_news: "procurement",
  policy: "policy",
  manual: "manual_review"
} as const satisfies Record<SourceCategory, ResearchSourcePurpose>;

const SOURCE_TIER_RANKS = {
  P0: 0,
  P1: 1,
  P2: 2,
  manual: 3
} as const satisfies Record<SourceTier, number>;

const OUTPUT_LAYER_RANKS = {
  edge: 0,
  entity: 1,
  observation: 2,
  lead: 3
} as const satisfies Record<PlannedOutputLayer, number>;

const MATERIAL_PERIOD_CONTEXT_KEYS = {
  year: "year",
  month: "month",
  none: "none"
} as const satisfies Record<MaterialObservationTarget["required_period"], keyof MaterialObservationContext | "none">;

export function aggregateDrafts(drafts: readonly SourcePlanDraft[], context?: SourcePlanContext): SourcePlanItem[] {
  const grouped = new Map<string, SourcePlanDraft[]>();
  for (const draft of drafts) {
    const current = grouped.get(draft.sourceId) ?? [];
    current.push(draft);
    grouped.set(draft.sourceId, current);
  }
  return [...grouped.entries()].map(([sourceId, sourceDrafts]) => toPlanItem(sourceId, sourceDrafts, context)).sort(comparePlanItems);
}

export function requireSource(sourceId: string): SourceRegistryEntry {
  const source = getSourceById(sourceId);
  if (source === undefined) throw new Error(`Source plan references unregistered source: ${sourceId}`);
  return source;
}

function toPlanItem(sourceId: string, drafts: readonly SourcePlanDraft[], context?: SourcePlanContext): SourcePlanItem {
  const source = requireSource(sourceId);
  return {
    source_id: source.id,
    source_name: source.name,
    purpose: purposeForSource(source),
    priority: source.tier,
    status: source.status,
    automation: source.automation,
    requires_key: source.requires_key,
    expected_output_layer: outputLayerForSource(source),
    relation_policy: relationPolicyForSource(source),
    parent_component_ids: uniqueSorted(drafts.map((draft) => draft.parentComponentId).filter(nonNullString)),
    target_ids: uniqueSorted(drafts.map((draft) => draft.targetId)),
    trigger_dependency_ids: uniqueSorted(drafts.map((draft) => draft.dependencyId)),
    reasons: uniqueSorted(drafts.map((draft) => draft.reason)),
    suggested_check_targets: buildSuggestedCheckTargets(sourceId, drafts, context)
  };
}

function buildSuggestedCheckTargets(
  sourceId: string,
  drafts: readonly SourcePlanDraft[],
  context: SourcePlanContext | undefined
): SourcePlanCheckTargetSuggestion[] {
  const suggestions: SourcePlanCheckTargetSuggestion[] = [];
  if (sourceId === "census-trade" && context?.tradeObservation !== undefined) {
    const componentIds = uniqueSorted(drafts.flatMap((draft) => [draft.parentComponentId, draft.targetId].filter(nonNullString)));
    for (const componentId of componentIds) {
      for (const code of listComponentHsCodes(componentId)) {
        for (const direction of context.tradeObservation.directions) {
          suggestions.push(toCensusTradeSuggestion(componentId, code, direction, context.tradeObservation));
        }
      }
    }
  }
  if (context?.materialObservation !== undefined) {
    for (const draft of drafts) {
      if (draft.parentComponentId === null) continue;
      for (const item of listComponentMaterialObservationTargets(draft.parentComponentId)) {
        if (item.target.source_adapter_id !== sourceId || item.material.material_id !== draft.targetId) continue;
        const suggestion = toMaterialObservationSuggestion(draft.parentComponentId, item.material, item.target, context.materialObservation);
        if (suggestion !== undefined) suggestions.push(suggestion);
      }
    }
  }
  if (context !== undefined) {
    suggestions.push(
      ...buildOfficialDisclosureCheckTargetSuggestions({
        sourceId,
        drafts,
        targetNodes: context.officialDisclosureTargetNodes,
        ...(context.officialDisclosure === undefined ? {} : { officialDisclosure: context.officialDisclosure })
      })
    );
  }
  return dedupeSuggestions(suggestions);
}

function toCensusTradeSuggestion(
  componentId: string,
  code: ComponentTradeCode,
  direction: TradeObservationDirection,
  context: TradeObservationContext
): SourcePlanCheckTargetSuggestion {
  return {
    source_adapter_id: "census-trade",
    target_kind: "trade-flow-observation",
    runnable: true,
    target_config: {
      direction,
      time: context.month,
      commodity_code: code.code,
      component_id: componentId,
      scope_kind: "component",
      scope_id: componentId,
      ...(context.countryCode === undefined ? {} : { country_code: context.countryCode })
    },
    reason: `${componentId} uses ${code.system} ${code.code} as an observation-only trade proxy: ${code.notes}`
  };
}

function toMaterialObservationSuggestion(
  componentId: string,
  material: ComponentMaterialExposure,
  target: MaterialObservationTarget,
  context: MaterialObservationContext
): SourcePlanCheckTargetSuggestion | undefined {
  const period = materialPeriodForTarget(target, context);
  if (period === undefined) return undefined;
  return {
    source_adapter_id: target.source_adapter_id,
    target_kind: target.target_kind,
    runnable: target.runnable,
    target_config: {
      ...target.target_config_template,
      component_id: componentId,
      scope_kind: "component",
      scope_id: componentId,
      period
    },
    reason: `${componentId} exposes ${material.name} [${material.material_id}]: ${target.reason}`
  };
}

function materialPeriodForTarget(target: MaterialObservationTarget, context: MaterialObservationContext): string | undefined {
  const key = MATERIAL_PERIOD_CONTEXT_KEYS[target.required_period];
  return key === "none" ? "none" : context[key];
}

function dedupeSuggestions(suggestions: readonly SourcePlanCheckTargetSuggestion[]): SourcePlanCheckTargetSuggestion[] {
  const byKey = new Map<string, SourcePlanCheckTargetSuggestion>();
  for (const suggestion of suggestions) {
    const key = `${suggestion.source_adapter_id}:${suggestion.target_kind}:${stableConfigKey(suggestion.target_config)}`;
    byKey.set(key, suggestion);
  }
  return [...byKey.values()].sort((left, right) => left.source_adapter_id.localeCompare(right.source_adapter_id) || left.reason.localeCompare(right.reason));
}

function stableConfigKey(config: Record<string, string | number | boolean | string[]>): string {
  return Object.entries(config)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join("|") : String(value)}`)
    .join(";");
}

function relationPolicyForSource(source: SourceRegistryEntry): SourceRelationPolicy {
  const override = RELATION_AUTHORITY_POLICY_OVERRIDES[source.relation_authority];
  if (override !== undefined) return override;
  if (source.evidence_level_cap >= 4) return "can_create_fact_edge";
  return "observation_only";
}

function outputLayerForSource(source: SourceRegistryEntry): PlannedOutputLayer {
  return POLICY_OUTPUT_LAYERS[relationPolicyForSource(source)];
}

function purposeForSource(source: SourceRegistryEntry): ResearchSourcePurpose {
  return SOURCE_CATEGORY_PURPOSES[source.category];
}

function comparePlanItems(left: SourcePlanItem, right: SourcePlanItem): number {
  return (
    tierRank(left.priority) - tierRank(right.priority) ||
    outputLayerRank(left.expected_output_layer) - outputLayerRank(right.expected_output_layer) ||
    left.source_id.localeCompare(right.source_id)
  );
}

function tierRank(tier: SourceTier): number {
  return SOURCE_TIER_RANKS[tier];
}

function outputLayerRank(layer: PlannedOutputLayer): number {
  return OUTPUT_LAYER_RANKS[layer];
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function nonNullString(value: string | null): value is string {
  return value !== null;
}
