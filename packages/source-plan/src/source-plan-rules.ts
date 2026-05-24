import type { ComponentDependencyCategory, ComponentUpstreamLead } from "@supplystrata/component-context";
import type { SourcePlanContext } from "./definitions.js";

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

export function sourceIdsForLead(lead: ComponentUpstreamLead): string[] {
  const sourceIds = new Set<string>(CATEGORY_SOURCE_IDS[lead.category]);
  for (const suggestion of lead.source_suggestions) {
    for (const sourceId of sourceIdsForSuggestion(suggestion)) sourceIds.add(sourceId);
  }
  return [...sourceIds];
}

export function sourceMatchesContext(sourceId: string, context: SourcePlanContext): boolean {
  // Apple Supplier List 是 Apple 官方披露，不是任意公司的通用供应商名单。
  // 任意上市公司的入口应走 entity resolver + SEC/监管披露/可发现 IR target，
  // 不能为每个研究对象新增 `<company>-suppliers` 这种公司专属工作流。
  if (sourceId === "apple-suppliers") return context.entityIds.has("ENT-APPLE");
  return true;
}

export function sourceReason(sourceId: string, lead: ComponentUpstreamLead): string {
  const suggestions = lead.source_suggestions.length === 0 ? "source coverage gap" : lead.source_suggestions.join(", ");
  return `${sourceId} covers ${lead.category} research from ${suggestions}`;
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
