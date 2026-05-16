export type SourceTier = "P0" | "P1" | "P2" | "manual";
export type SourceStatus = "implemented" | "preview" | "planned" | "scoped" | "manual_only" | "rejected";
export type AutomationPolicy = "allowed" | "semi_auto" | "manual_only";

export interface SourceRegistryEntry {
  id: string;
  tier: SourceTier;
  name: string;
  category: "official_disclosure" | "entity_resolution" | "supplier_list" | "trade" | "macro" | "logistics" | "procurement_news" | "manual";
  evidence_level_cap: 1 | 2 | 3 | 4 | 5;
  automation: AutomationPolicy;
  status: SourceStatus;
  implemented_package?: string;
  requires_key: boolean;
  official_url: string;
  tos_url: string;
  notes: string;
}

export const SOURCE_REGISTRY = [
  {
    id: "sec-edgar",
    tier: "P0",
    name: "SEC EDGAR",
    category: "official_disclosure",
    evidence_level_cap: 5,
    automation: "allowed",
    status: "implemented",
    implemented_package: "@supplystrata/sources-sec-edgar",
    requires_key: false,
    official_url: "https://www.sec.gov/edgar/search-and-access",
    tos_url: "https://www.sec.gov/os/accessing-edgar-data",
    notes: "官方 API；必须带 User-Agent；当前支持 submissions + filing HTML。"
  },
  {
    id: "tsmc-ir",
    tier: "P0",
    name: "TSMC Investor Relations",
    category: "official_disclosure",
    evidence_level_cap: 5,
    automation: "allowed",
    status: "preview",
    implemented_package: "@supplystrata/sources-tsmc-ir",
    requires_key: false,
    official_url: "https://investor.tsmc.com/english/annual-reports",
    tos_url: "https://investor.tsmc.com/english/annual-reports",
    notes: "当前预览抓 2025 Annual Report HTML，用作 foundry/AI/HPC/advanced packaging 背景证据。"
  },
  {
    id: "samsung-ir",
    tier: "P0",
    name: "Samsung Electronics Investor Relations",
    category: "official_disclosure",
    evidence_level_cap: 5,
    automation: "allowed",
    status: "preview",
    implemented_package: "@supplystrata/sources-samsung-ir",
    requires_key: false,
    official_url: "https://www.samsung.com/global/ir/",
    tos_url: "https://www.samsung.com/global/ir/",
    notes: "当前预览抓 2025 官方业绩披露/新闻稿，用于 Memory / Foundry 背景；Business Report PDF 留后续。"
  },
  {
    id: "skhynix-ir",
    tier: "P0",
    name: "SK hynix Investor Relations",
    category: "official_disclosure",
    evidence_level_cap: 5,
    automation: "allowed",
    status: "preview",
    implemented_package: "@supplystrata/sources-skhynix-ir",
    requires_key: false,
    official_url: "https://www.skhynix.com/eng/irMain.do",
    tos_url: "https://www.skhynix.com/eng/irMain.do",
    notes: "当前预览抓 2025 官方业绩披露/新闻页，用于 HBM/DRAM 供应侧背景；韩文/DART 留后续。"
  },
  {
    id: "asml-ir",
    tier: "P0",
    name: "ASML Investor Relations",
    category: "official_disclosure",
    evidence_level_cap: 5,
    automation: "allowed",
    status: "preview",
    implemented_package: "@supplystrata/sources-asml-ir",
    requires_key: false,
    official_url: "https://www.asml.com/en/investors/annual-report",
    tos_url: "https://www.asml.com/en/investors/annual-report",
    notes: "当前预览抓 2025 Annual Report 页面，用于半导体设备链条背景。"
  },
  {
    id: "apple-suppliers",
    tier: "P0",
    name: "Apple Supplier List and Supply Chain Reports",
    category: "supplier_list",
    evidence_level_cap: 4,
    automation: "semi_auto",
    status: "preview",
    implemented_package: "@supplystrata/sources-apple-suppliers",
    requires_key: false,
    official_url: "https://www.apple.com/supplier-responsibility/",
    tos_url: "https://www.apple.com/legal/",
    notes: "官方 PDF；当前预览支持下载 FY22 Supplier List 并输出人工 review CSV，不自动 apply。"
  },
  {
    id: "opencorporates",
    tier: "P0",
    name: "OpenCorporates",
    category: "entity_resolution",
    evidence_level_cap: 4,
    automation: "allowed",
    status: "preview",
    implemented_package: "@supplystrata/sources-opencorporates",
    requires_key: true,
    official_url: "https://api.opencorporates.com/documentation/API-Reference",
    tos_url: "https://opencorporates.com/info/licence",
    notes: "用于实体消歧；官方 API 当前要求 token，CLI lookup 只输出候选，不自动合并实体。"
  },
  {
    id: "companies-house",
    tier: "P0",
    name: "UK Companies House",
    category: "entity_resolution",
    evidence_level_cap: 4,
    automation: "allowed",
    status: "preview",
    implemented_package: "@supplystrata/sources-companies-house",
    requires_key: true,
    official_url: "https://developer.company-information.service.gov.uk/",
    tos_url: "https://developer.company-information.service.gov.uk/",
    notes: "用于英国法人登记；官方 API key + Basic Auth，CLI lookup 只输出候选，不自动合并实体。"
  },
  {
    id: "seed-entities",
    tier: "P0",
    name: "Curated Seed Entities",
    category: "entity_resolution",
    evidence_level_cap: 4,
    automation: "manual_only",
    status: "implemented",
    implemented_package: "@supplystrata/db",
    requires_key: false,
    official_url: "file://seeds/entities.csv",
    tos_url: "manual://curated-seeds",
    notes: "项目内维护的核心公司和高频供应商事实标识；只用于实体解析，不作为关系证据。"
  },
  {
    id: "manual",
    tier: "manual",
    name: "Manual Evidence",
    category: "manual",
    evidence_level_cap: 5,
    automation: "manual_only",
    status: "planned",
    requires_key: false,
    official_url: "manual://evidence",
    tos_url: "manual://evidence",
    notes: "用于无法自动化或不应自动化的数据源；必须人工录入 cite_text 和 URL。"
  },
  {
    id: "import-yeti",
    tier: "manual",
    name: "ImportYeti",
    category: "trade",
    evidence_level_cap: 3,
    automation: "manual_only",
    status: "manual_only",
    requires_key: false,
    official_url: "https://www.importyeti.com/",
    tos_url: "https://www.importyeti.com/terms",
    notes: "不做 adapter，不自动抓取；仅允许研究员手工摘录少量证据。"
  }
] as const satisfies readonly SourceRegistryEntry[];

export function listSources(): SourceRegistryEntry[] {
  return [...SOURCE_REGISTRY];
}

export function sourceStatusSummary(): { total: number; implemented: number; preview: number; planned: number; manualOnly: number; requiresKey: number } {
  const sources = listSources();
  return {
    total: sources.length,
    implemented: sources.filter((source) => source.status === "implemented").length,
    preview: sources.filter((source) => source.status === "preview").length,
    planned: sources.filter((source) => source.status === "planned").length,
    manualOnly: sources.filter((source) => source.status === "manual_only").length,
    requiresKey: sources.filter((source) => source.requires_key).length
  };
}
