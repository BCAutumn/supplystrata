import { listComponentUpstreamLeads, type ComponentDependencyCategory, type ComponentUpstreamLead } from "@supplystrata/component-context";
import {
  getSourceById,
  type AutomationPolicy,
  type SourceCategory,
  type SourceRegistryEntry,
  type SourceStatus,
  type SourceTier
} from "@supplystrata/source-registry";

export type ResearchSourcePurpose =
  | "official_disclosure"
  | "entity_resolution"
  | "facility"
  | "commodity"
  | "macro"
  | "trade"
  | "logistics"
  | "procurement"
  | "policy"
  | "manual_review";

export type PlannedOutputLayer = "edge" | "observation" | "lead" | "entity";
export type SourceRelationPolicy = "can_create_fact_edge" | "observation_only" | "lead_only" | "entity_only";

export interface SourcePlanItem {
  source_id: string;
  source_name: string;
  purpose: ResearchSourcePurpose;
  priority: SourceTier;
  status: SourceStatus;
  automation: AutomationPolicy;
  requires_key: boolean;
  expected_output_layer: PlannedOutputLayer;
  relation_policy: SourceRelationPolicy;
  parent_component_ids: string[];
  target_ids: string[];
  trigger_dependency_ids: string[];
  reasons: string[];
}

export interface SourcePlanForComponentsInput {
  component_ids: readonly string[];
  entity_ids?: readonly string[];
  maxTierDepth?: number;
}

interface SourcePlanDraft {
  sourceId: string;
  parentComponentId: string;
  targetId: string;
  dependencyId: string;
  reason: string;
}

interface SourcePlanContext {
  entityIds: ReadonlySet<string>;
}

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
  { token: "odm disclosures", sourceIds: ["sec-edgar", "company-ir", "edinet"] },
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
  for (const componentId of input.component_ids) {
    for (const lead of listComponentUpstreamLeads(componentId, maxTierDepth)) {
      drafts.push(...draftsForLead(lead, context));
    }
  }
  return aggregateDrafts(drafts);
}

export function planSourcesForComponent(componentId: string, maxTierDepth = 3, entityIds: readonly string[] = []): SourcePlanItem[] {
  return planSourcesForComponents({ component_ids: [componentId], maxTierDepth, entity_ids: entityIds });
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

function createContext(input: Pick<SourcePlanForComponentsInput, "entity_ids">): SourcePlanContext {
  return { entityIds: new Set(input.entity_ids ?? []) };
}

function sourceMatchesContext(sourceId: string, context: SourcePlanContext): boolean {
  // Apple Supplier List 是 Apple 官方披露，不是任意公司的通用供应商名单。没有公司上下文时必须排除，防止通用链路被 Apple 耦合。
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

function aggregateDrafts(drafts: readonly SourcePlanDraft[]): SourcePlanItem[] {
  const grouped = new Map<string, SourcePlanDraft[]>();
  for (const draft of drafts) {
    const current = grouped.get(draft.sourceId) ?? [];
    current.push(draft);
    grouped.set(draft.sourceId, current);
  }
  return [...grouped.entries()].map(([sourceId, sourceDrafts]) => toPlanItem(sourceId, sourceDrafts)).sort(comparePlanItems);
}

function toPlanItem(sourceId: string, drafts: readonly SourcePlanDraft[]): SourcePlanItem {
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
    parent_component_ids: uniqueSorted(drafts.map((draft) => draft.parentComponentId)),
    target_ids: uniqueSorted(drafts.map((draft) => draft.targetId)),
    trigger_dependency_ids: uniqueSorted(drafts.map((draft) => draft.dependencyId)),
    reasons: uniqueSorted(drafts.map((draft) => draft.reason))
  };
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
