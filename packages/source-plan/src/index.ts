import {
  listComponentHsCodes,
  listComponentMaterialObservationTargets,
  listComponentUpstreamLeads,
  type ComponentDependencyCategory,
  type ComponentMaterialExposure,
  type ComponentTradeCode,
  type MaterialObservationTarget,
  type ComponentUpstreamLead
} from "@supplystrata/component-context";
import { getSourceById, type SourceRegistryEntry, type SourceTier } from "@supplystrata/source-registry";
import type {
  MaterialObservationContext,
  OfficialDisclosureContext,
  PlannedOutputLayer,
  ResearchSourcePurpose,
  SourcePlanCheckTargetSuggestion,
  SourcePlanContext,
  SourcePlanDraft,
  SourcePlanForComponentsInput,
  SourcePlanItem,
  SourcePlanOfficialDisclosureTargetNode,
  SourceRelationPolicy,
  TradeObservationContext,
  TradeObservationDirection
} from "./definitions.js";

export * from "./definitions.js";

const CATEGORY_SOURCE_IDS = {
  component: ["sec-edgar", "company-ir", "osh"],
  material: ["usgs-mcs", "iea-critical-minerals", "worldbank-pink", "un-comtrade", "census-trade"],
  equipment: ["asml-ir", "company-ir", "sec-edgar", "edinet", "eu-crma"],
  energy: ["eia", "fred", "worldbank-pink"],
  logistics: ["census-trade", "usitc-dataweb", "noaa-ais", "import-yeti"],
  facility: ["osh", "rmi-facilities"],
  service: ["sec-edgar", "company-ir", "tsmc-ir", "samsung-ir", "dart-kr", "edinet"]
} as const satisfies Record<ComponentDependencyCategory, readonly string[]>;

const SUGGESTION_SOURCE_RULES = [
  { token: "supplier annual reports", sourceIds: ["sec-edgar", "company-ir", "dart-kr", "edinet"] },
  { token: "customer 10-k", sourceIds: ["sec-edgar"] },
  { token: "earnings call", sourceIds: ["company-ir", "sec-edgar"] },
  { token: "memory supplier filings", sourceIds: ["samsung-ir", "skhynix-ir", "micron-ir", "dart-kr", "sec-edgar"] },
  { token: "product qualification", sourceIds: ["company-ir", "sec-edgar"] },
  { token: "foundry annual reports", sourceIds: ["tsmc-ir", "samsung-ir", "dart-kr", "edinet"] },
  { token: "osat annual reports", sourceIds: ["sec-edgar", "company-ir", "edinet"] },
  { token: "official capacity expansion", sourceIds: ["company-ir", "dart-kr", "edinet"] },
  { token: "foundry supplier reports", sourceIds: ["tsmc-ir", "samsung-ir", "dart-kr"] },
  { token: "silicon wafer supplier", sourceIds: ["company-ir", "edinet", "usgs-mcs"] },
  { token: "trade observations", sourceIds: ["un-comtrade", "census-trade", "usitc-dataweb"] },
  { token: "asml annual report", sourceIds: ["asml-ir"] },
  { token: "foundry capex", sourceIds: ["tsmc-ir", "samsung-ir", "dart-kr"] },
  { token: "export control", sourceIds: ["eu-crma", "sec-edgar"] },
  { token: "chemical supplier filings", sourceIds: ["company-ir", "sec-edgar", "edinet"] },
  { token: "facility environmental permits", sourceIds: ["company-ir", "osh"] },
  { token: "facility permits", sourceIds: ["company-ir", "osh"] },
  { token: "regional energy", sourceIds: ["eia", "fred"] },
  { token: "regional energy and logistics", sourceIds: ["eia", "noaa-ais", "census-trade"] },
  { token: "industrial gas supplier", sourceIds: ["company-ir", "sec-edgar"] },
  { token: "substrate supplier", sourceIds: ["company-ir", "edinet"] },
  { token: "supplier lists", sourceIds: ["osh", "apple-suppliers"] },
  { token: "ems annual reports", sourceIds: ["sec-edgar", "company-ir", "edinet"] },
  { token: "facility disclosures", sourceIds: ["apple-suppliers", "osh", "rmi-facilities"] },
  { token: "odm disclosures", sourceIds: ["sec-edgar", "company-ir", "twse-mops", "edinet"] },
  { token: "thermal supplier reports", sourceIds: ["company-ir", "sec-edgar"] },
  { token: "datacenter deployment", sourceIds: ["company-ir", "sec-edgar", "eia"] },
  { token: "procurement notices", sourceIds: ["sam-gov", "usaspending", "eu-ted"] },
  { token: "port statistics", sourceIds: ["noaa-ais", "census-trade"] },
  { token: "manual bol review", sourceIds: ["import-yeti"] }
] as const;

// 这里是二/三级链路寻找免费数据源的唯一规划入口；它只返回计划，不抓取、不落库、不升级事实边。
export function planSourcesForComponents(input: SourcePlanForComponentsInput): SourcePlanItem[] {
  const drafts: SourcePlanDraft[] = [];
  const maxTierDepth = input.maxTierDepth ?? 3;
  const context = createContext(input);
  const taxonomyComponentIds = new Set(input.component_ids);
  for (const componentId of input.component_ids) {
    for (const lead of listComponentUpstreamLeads(componentId, maxTierDepth)) {
      taxonomyComponentIds.add(lead.parent_component_id);
      taxonomyComponentIds.add(lead.target_id);
      drafts.push(...draftsForLead(lead, context));
    }
  }
  if (context.tradeObservation !== undefined) drafts.push(...draftsForTradeTaxonomy([...taxonomyComponentIds]));
  if (context.materialObservation !== undefined) drafts.push(...draftsForMaterialTaxonomy([...taxonomyComponentIds]));
  drafts.push(...draftsForOfficialDisclosureTargetNodes(context.officialDisclosureTargetNodes));
  return aggregateDrafts(drafts, context);
}

export function planSourcesForComponent(
  componentId: string,
  maxTierDepth = 3,
  entityIds: readonly string[] = [],
  tradeObservation?: TradeObservationContext
): SourcePlanItem[] {
  return planSourcesForComponents({
    component_ids: [componentId],
    maxTierDepth,
    entity_ids: entityIds,
    ...(tradeObservation === undefined
      ? {}
      : {
          tradeObservationMonth: tradeObservation.month,
          ...(tradeObservation.countryCode === undefined ? {} : { tradeObservationCountryCode: tradeObservation.countryCode }),
          tradeObservationDirections: tradeObservation.directions
        })
  });
}

export function planSourcesForComponentLead(lead: ComponentUpstreamLead, entityIds: readonly string[] = []): SourcePlanItem[] {
  return aggregateDrafts(draftsForLead(lead, createContext({ entity_ids: entityIds })));
}

function draftsForLead(lead: ComponentUpstreamLead, context: SourcePlanContext): SourcePlanDraft[] {
  const sourceIds = new Set<string>(CATEGORY_SOURCE_IDS[lead.category]);
  for (const suggestion of lead.source_suggestions) {
    for (const sourceId of sourceIdsForSuggestion(suggestion)) sourceIds.add(sourceId);
  }
  return [...sourceIds].flatMap((sourceId) => {
    // 计划层引用的来源必须先登记到 source registry；未登记来源静默消失会让研究计划看起来“正常但缺数据”。
    requireSource(sourceId);
    if (!sourceMatchesContext(sourceId, context)) return [];
    return [
      {
        sourceId,
        parentComponentId: lead.parent_component_id,
        targetId: lead.target_id,
        dependencyId: lead.dependency_id,
        reason: `${lead.title}: ${sourceReason(sourceId, lead)}`
      }
    ];
  });
}

function draftsForTradeTaxonomy(componentIds: readonly string[]): SourcePlanDraft[] {
  const drafts: SourcePlanDraft[] = [];
  for (const componentId of componentIds) {
    if (listComponentHsCodes(componentId).length === 0) continue;
    requireSource("census-trade");
    drafts.push({
      sourceId: "census-trade",
      parentComponentId: componentId,
      targetId: componentId,
      dependencyId: `trade-taxonomy:${componentId}`,
      reason: `${componentId}: Census Trade can create observation-only HS proxy checks from component trade taxonomy`
    });
  }
  return drafts;
}

function draftsForMaterialTaxonomy(componentIds: readonly string[]): SourcePlanDraft[] {
  const drafts: SourcePlanDraft[] = [];
  for (const componentId of componentIds) {
    for (const item of listComponentMaterialObservationTargets(componentId)) {
      requireSource(item.target.source_adapter_id);
      drafts.push({
        sourceId: item.target.source_adapter_id,
        parentComponentId: componentId,
        targetId: item.material.material_id,
        dependencyId: `material-taxonomy:${componentId}:${item.material.material_id}`,
        reason: `${componentId} exposes ${item.material.name}: ${item.target.reason}`
      });
    }
  }
  return drafts;
}

function draftsForOfficialDisclosureTargetNodes(targetNodes: readonly SourcePlanOfficialDisclosureTargetNode[]): SourcePlanDraft[] {
  const drafts: SourcePlanDraft[] = [];
  for (const node of targetNodes) {
    const sourceIds = officialDisclosureSourceIdsForNode(node);
    for (const sourceId of sourceIds) {
      requireSource(sourceId);
      drafts.push({
        sourceId,
        parentComponentId: node.node_kind === "component" ? node.node_id : null,
        targetId: node.node_id,
        dependencyId: `official-target:${node.node_id}:${sourceId}`,
        reason: officialDisclosureTargetReason(node, sourceId)
      });
    }
  }
  return drafts;
}

function officialDisclosureSourceIdsForNode(node: SourcePlanOfficialDisclosureTargetNode): string[] {
  return uniqueSorted([...(node.expected_source_ids ?? []), ...(node.expected_source_targets ?? []).map((target) => target.source_id)]);
}

function officialDisclosureTargetReason(node: SourcePlanOfficialDisclosureTargetNode, sourceId: string): string {
  const name = node.name === undefined ? node.node_id : `${node.name} [${node.node_id}]`;
  return `${name}: target profile expects ${sourceId} official disclosure coverage; planning does not create fact edges.`;
}

function createContext(
  input: Pick<
    SourcePlanForComponentsInput,
    | "entity_ids"
    | "officialDisclosureTargetNodes"
    | "tradeObservationMonth"
    | "tradeObservationCountryCode"
    | "tradeObservationDirections"
    | "officialDisclosureYear"
    | "materialObservationYear"
    | "commodityObservationMonth"
  >
): SourcePlanContext {
  return {
    entityIds: new Set(input.entity_ids ?? []),
    officialDisclosureTargetNodes: input.officialDisclosureTargetNodes ?? [],
    ...(input.officialDisclosureYear === undefined
      ? {}
      : {
          officialDisclosure: {
            year: normalizeOfficialDisclosureYear(input.officialDisclosureYear)
          }
        }),
    ...(input.tradeObservationMonth === undefined
      ? {}
      : {
          tradeObservation: {
            month: normalizeTradeObservationMonth(input.tradeObservationMonth),
            ...(input.tradeObservationCountryCode === undefined ? {} : { countryCode: input.tradeObservationCountryCode.trim() }),
            directions: normalizeTradeObservationDirections(input.tradeObservationDirections)
          }
        }),
    ...(input.materialObservationYear === undefined && input.commodityObservationMonth === undefined
      ? {}
      : {
          materialObservation: {
            ...(input.materialObservationYear === undefined ? {} : { year: normalizeMaterialObservationYear(input.materialObservationYear) }),
            ...(input.commodityObservationMonth === undefined ? {} : { month: normalizeTradeObservationMonth(input.commodityObservationMonth) })
          }
        })
  };
}

function sourceMatchesContext(sourceId: string, context: SourcePlanContext): boolean {
  // Apple Supplier List 是 Apple 官方披露，不是任意公司的通用供应商名单。
  // 任意上市公司的入口应走 entity resolver + SEC/监管披露/可发现 IR target，
  // 不能为每个研究对象新增 `<company>-suppliers` 这种公司专属工作流。
  if (sourceId === "apple-suppliers") return context.entityIds.has("ENT-APPLE");
  return true;
}

function sourceIdsForSuggestion(suggestion: string): string[] {
  const normalized = suggestion.toLowerCase();
  const sourceIds: string[] = [];
  for (const rule of SUGGESTION_SOURCE_RULES) {
    if (!normalized.includes(rule.token)) continue;
    for (const sourceId of rule.sourceIds) sourceIds.push(sourceId);
  }
  return sourceIds;
}

function aggregateDrafts(drafts: readonly SourcePlanDraft[], context?: SourcePlanContext): SourcePlanItem[] {
  const grouped = new Map<string, SourcePlanDraft[]>();
  for (const draft of drafts) {
    const current = grouped.get(draft.sourceId) ?? [];
    current.push(draft);
    grouped.set(draft.sourceId, current);
  }
  return [...grouped.entries()].map(([sourceId, sourceDrafts]) => toPlanItem(sourceId, sourceDrafts, context)).sort(comparePlanItems);
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
      ...explicitOfficialDisclosureSuggestionsForTargetNodes(sourceId, drafts, context.officialDisclosureTargetNodes, context.officialDisclosure)
    );
  }
  if (context?.officialDisclosure !== undefined) {
    suggestions.push(
      ...periodicOfficialDisclosureSuggestionsForTargetNodes(sourceId, drafts, context.officialDisclosure, context.officialDisclosureTargetNodes)
    );
    const suggestion = officialDisclosureSuggestionForSource(sourceId, context.officialDisclosure);
    if (suggestion !== undefined) suggestions.push(suggestion);
  }
  return dedupeSuggestions(suggestions);
}

function explicitOfficialDisclosureSuggestionsForTargetNodes(
  sourceId: string,
  drafts: readonly SourcePlanDraft[],
  targetNodes: readonly SourcePlanOfficialDisclosureTargetNode[],
  officialDisclosure: OfficialDisclosureContext | undefined
): SourcePlanCheckTargetSuggestion[] {
  const targetIds = new Set(drafts.map((draft) => draft.targetId));
  const suggestions: SourcePlanCheckTargetSuggestion[] = [];
  for (const node of targetNodes) {
    if (!targetIds.has(node.node_id)) continue;
    const explicitTarget = node.expected_source_targets?.find((target) => target.source_id === sourceId);
    if (explicitTarget === undefined) continue;
    const targetConfig = explicitOfficialDisclosureTargetConfig(explicitTarget.target_config, officialDisclosure);
    if (targetConfig === undefined) continue;
    suggestions.push({
      source_adapter_id: sourceId,
      target_kind: explicitTarget.target_kind,
      runnable: true,
      target_config: targetConfig,
      reason: explicitTarget.reason ?? `${node.node_id} has explicit ${sourceId} target config from the research target profile.`
    });
  }
  return suggestions;
}

function explicitOfficialDisclosureTargetConfig(
  config: Record<string, string | number | boolean | string[]>,
  officialDisclosure: OfficialDisclosureContext | undefined
): Record<string, string | number | boolean | string[]> | undefined {
  const cloned = cloneTargetConfig(config);
  const hasAnnualYearTemplate = Object.hasOwn(cloned, "year");
  const hasAnnualDateTemplate = Object.hasOwn(cloned, "date");
  if (!hasAnnualYearTemplate && !hasAnnualDateTemplate) return cloned;
  // research target profile 里带 year/date 的显式 target 表示“按年度滚动的官方披露模板”，没有调用方给出的 officialDisclosureYear 就不应伪装成 runnable。
  if (officialDisclosure === undefined) return undefined;
  if (hasAnnualYearTemplate) cloned["year"] = Number.parseInt(officialDisclosure.year, 10);
  if (hasAnnualDateTemplate) {
    const dateTemplate = cloned["date"];
    if (typeof dateTemplate !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateTemplate)) {
      throw new Error("Official disclosure target date template must use YYYY-MM-DD format.");
    }
    cloned["date"] = `${officialDisclosure.year}${dateTemplate.slice(4)}`;
  }
  return cloned;
}

function periodicOfficialDisclosureSuggestionsForTargetNodes(
  sourceId: string,
  drafts: readonly SourcePlanDraft[],
  context: OfficialDisclosureContext,
  targetNodes: readonly SourcePlanOfficialDisclosureTargetNode[]
): SourcePlanCheckTargetSuggestion[] {
  const targetIds = new Set(drafts.map((draft) => draft.targetId));
  const suggestions: SourcePlanCheckTargetSuggestion[] = [];
  for (const node of targetNodes) {
    if (!targetIds.has(node.node_id)) continue;
    if (!officialDisclosureSourceIdsForNode(node).includes(sourceId)) continue;
    if (node.expected_source_targets?.some((target) => target.source_id === sourceId) === true) continue;
    const suggestion = officialDisclosureSuggestionForTargetNodeSource(sourceId, node, context);
    if (suggestion !== undefined) suggestions.push(suggestion);
  }
  return suggestions;
}

function officialDisclosureSuggestionForTargetNodeSource(
  sourceId: string,
  node: SourcePlanOfficialDisclosureTargetNode,
  context: OfficialDisclosureContext
): SourcePlanCheckTargetSuggestion | undefined {
  const entityId = officialDisclosureEntityId(sourceId);
  if (entityId === undefined) return undefined;
  return {
    source_adapter_id: sourceId,
    target_kind: "official-html-disclosure",
    runnable: true,
    target_config: {
      entity_id: entityId,
      year: Number.parseInt(context.year, 10)
    },
    reason: `${node.node_id} expects ${sourceId}; ${sourceId} has a registered official disclosure connector for ${context.year}. Outputs remain observation/review context until evidence is reviewed.`
  };
}

function officialDisclosureSuggestionForSource(sourceId: string, context: OfficialDisclosureContext): SourcePlanCheckTargetSuggestion | undefined {
  const entityId = officialDisclosureEntityId(sourceId);
  if (entityId === undefined) return undefined;
  return {
    source_adapter_id: sourceId,
    target_kind: "official-html-disclosure",
    runnable: true,
    target_config: {
      entity_id: entityId,
      year: Number.parseInt(context.year, 10)
    },
    reason: `${sourceId} has a registered official disclosure connector for ${context.year}; output must remain observation/review context until evidence is reviewed.`
  };
}

function officialDisclosureEntityId(sourceId: string): string | undefined {
  if (sourceId === "tsmc-ir") return "ENT-TSMC";
  if (sourceId === "samsung-ir") return "ENT-SAMSUNG-ELECTRONICS";
  if (sourceId === "skhynix-ir") return "ENT-SKHYNIX";
  if (sourceId === "micron-ir") return "ENT-MICRON";
  if (sourceId === "asml-ir") return "ENT-ASML";
  return undefined;
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
  if (target.required_period === "year") return context.year;
  if (target.required_period === "month") return context.month;
  return "none";
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

function cloneTargetConfig(config: Record<string, string | number | boolean | string[]>): Record<string, string | number | boolean | string[]> {
  const cloned: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(config)) cloned[key] = Array.isArray(value) ? [...value] : value;
  return cloned;
}

function relationPolicyForSource(source: SourceRegistryEntry): SourceRelationPolicy {
  if (source.relation_authority === "registry_fact") return "entity_only";
  if (source.relation_authority === "macro_trend") return "observation_only";
  if (source.relation_authority === "lead_only") return "lead_only";
  if (source.evidence_level_cap >= 4) return "can_create_fact_edge";
  return "observation_only";
}

function outputLayerForSource(source: SourceRegistryEntry): PlannedOutputLayer {
  const policy = relationPolicyForSource(source);
  if (policy === "can_create_fact_edge") return "edge";
  if (policy === "observation_only") return "observation";
  if (policy === "entity_only") return "entity";
  return "lead";
}

function purposeForSource(source: SourceRegistryEntry): ResearchSourcePurpose {
  if (source.category === "supplier_list" || source.category === "facility") return "facility";
  if (source.category === "commodity") return "commodity";
  if (source.category === "trade") return "trade";
  if (source.category === "logistics") return "logistics";
  if (source.category === "procurement_news") return "procurement";
  if (source.category === "policy") return "policy";
  if (source.category === "manual") return "manual_review";
  return source.category;
}

function sourceReason(sourceId: string, lead: ComponentUpstreamLead): string {
  const suggestions = lead.source_suggestions.length === 0 ? "source coverage gap" : lead.source_suggestions.join(", ");
  return `${sourceId} covers ${lead.category} research from ${suggestions}`;
}

function requireSource(sourceId: string): SourceRegistryEntry {
  const source = getSourceById(sourceId);
  if (source === undefined) throw new Error(`Source plan references unregistered source: ${sourceId}`);
  return source;
}

function comparePlanItems(left: SourcePlanItem, right: SourcePlanItem): number {
  return (
    tierRank(left.priority) - tierRank(right.priority) ||
    outputLayerRank(left.expected_output_layer) - outputLayerRank(right.expected_output_layer) ||
    left.source_id.localeCompare(right.source_id)
  );
}

function tierRank(tier: SourceTier): number {
  if (tier === "P0") return 0;
  if (tier === "P1") return 1;
  if (tier === "P2") return 2;
  return 3;
}

function outputLayerRank(layer: PlannedOutputLayer): number {
  if (layer === "edge") return 0;
  if (layer === "entity") return 1;
  if (layer === "observation") return 2;
  return 3;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function nonNullString(value: string | null): value is string {
  return value !== null;
}

function normalizeTradeObservationMonth(value: string): string {
  const trimmed = value.trim();
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(trimmed)) throw new Error(`trade observation month must use YYYY-MM format: ${value}`);
  return trimmed;
}

function normalizeTradeObservationDirections(value: readonly TradeObservationDirection[] | undefined): TradeObservationDirection[] {
  const directions = value ?? ["imports", "exports"];
  const unique = [...new Set(directions)];
  if (unique.length === 0) throw new Error("trade observation directions must include imports or exports");
  for (const direction of unique) {
    if (direction !== "imports" && direction !== "exports") throw new Error(`unsupported trade observation direction: ${String(direction)}`);
  }
  return unique.sort();
}

function normalizeMaterialObservationYear(value: string): string {
  const trimmed = value.trim();
  if (!/^[0-9]{4}$/.test(trimmed)) throw new Error(`material observation year must use YYYY format: ${value}`);
  return trimmed;
}

function normalizeOfficialDisclosureYear(value: string): string {
  const trimmed = value.trim();
  if (!/^[0-9]{4}$/.test(trimmed)) throw new Error(`official disclosure year must use YYYY format: ${value}`);
  return trimmed;
}
