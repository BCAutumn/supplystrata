import type { DocumentType, EvidenceLevel } from "@supplystrata/core";

export type SourceTier = "P0" | "P1" | "P2" | "manual";
export type SourceStatus = "implemented" | "preview" | "planned" | "scoped" | "manual_only" | "rejected";
export type AutomationPolicy = "allowed" | "semi_auto" | "manual_only";
export type SourceCategory =
  | "official_disclosure"
  | "entity_resolution"
  | "supplier_list"
  | "facility"
  | "trade"
  | "commodity"
  | "macro"
  | "logistics"
  | "procurement_news"
  | "policy"
  | "manual";
export type PublisherType =
  | "regulator"
  | "company_official"
  | "government_registry"
  | "official_supplier_list"
  | "macro_statistical_agency"
  | "news"
  | "manual";
export type RelationAuthority = "self_disclosure" | "counterparty_disclosure" | "registry_fact" | "facility_claim" | "macro_trend" | "lead_only";

export interface SourceRegistryEntry {
  id: string;
  tier: SourceTier;
  name: string;
  category: SourceCategory;
  evidence_level_cap: EvidenceLevel;
  publisher_type: PublisherType;
  relation_authority: RelationAuthority;
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
    publisher_type: "regulator",
    relation_authority: "self_disclosure",
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
    evidence_level_cap: 4,
    publisher_type: "company_official",
    relation_authority: "self_disclosure",
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
    evidence_level_cap: 4,
    publisher_type: "company_official",
    relation_authority: "self_disclosure",
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
    evidence_level_cap: 4,
    publisher_type: "company_official",
    relation_authority: "self_disclosure",
    automation: "allowed",
    status: "preview",
    implemented_package: "@supplystrata/sources-skhynix-ir",
    requires_key: false,
    official_url: "https://www.skhynix.com/eng/irMain.do",
    tos_url: "https://www.skhynix.com/eng/irMain.do",
    notes: "当前预览抓 2025 官方业绩披露/新闻页，用于 HBM/DRAM 供应侧背景；韩文/DART 留后续。"
  },
  {
    id: "micron-ir",
    tier: "P1",
    name: "Micron Investor Relations",
    category: "official_disclosure",
    evidence_level_cap: 4,
    publisher_type: "company_official",
    relation_authority: "self_disclosure",
    automation: "semi_auto",
    status: "scoped",
    requires_key: false,
    official_url: "https://investors.micron.com/",
    tos_url: "https://www.micron.com/about/legal",
    notes: "Micron 官方披露源位；用于 memory supplier filings 的后续交叉验证，接 adapter 前只能进入 source plan。"
  },
  {
    id: "asml-ir",
    tier: "P0",
    name: "ASML Investor Relations",
    category: "official_disclosure",
    evidence_level_cap: 4,
    publisher_type: "company_official",
    relation_authority: "self_disclosure",
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
    publisher_type: "official_supplier_list",
    relation_authority: "facility_claim",
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
    publisher_type: "government_registry",
    relation_authority: "registry_fact",
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
    publisher_type: "government_registry",
    relation_authority: "registry_fact",
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
    publisher_type: "manual",
    relation_authority: "registry_fact",
    automation: "manual_only",
    status: "implemented",
    implemented_package: "@supplystrata/db",
    requires_key: false,
    official_url: "file://seeds/entities.csv",
    tos_url: "manual://curated-seeds",
    notes: "项目内维护的核心公司和高频供应商事实标识；只用于实体解析，不作为关系证据。"
  },
  {
    id: "company-ir",
    tier: "P1",
    name: "Company Investor Relations",
    category: "official_disclosure",
    evidence_level_cap: 4,
    publisher_type: "company_official",
    relation_authority: "self_disclosure",
    automation: "semi_auto",
    status: "planned",
    requires_key: false,
    official_url: "manual://company-ir-adapter-template",
    tos_url: "manual://company-ir-adapter-template",
    notes: "通用公司 IR 源位；真正抓取必须落到具体公司 adapter，不能用该占位 ID 直接 fetch。"
  },
  {
    id: "dart-kr",
    tier: "P1",
    name: "Korea DART",
    category: "official_disclosure",
    evidence_level_cap: 5,
    publisher_type: "regulator",
    relation_authority: "self_disclosure",
    automation: "allowed",
    status: "scoped",
    requires_key: true,
    official_url: "https://opendart.fss.or.kr/",
    tos_url: "https://opendart.fss.or.kr/",
    notes: "韩国监管披露；用于 Samsung / SK Hynix 等韩股公司交叉验证，韩文解析进入 P1。"
  },
  {
    id: "edinet",
    tier: "P1",
    name: "Japan EDINET",
    category: "official_disclosure",
    evidence_level_cap: 5,
    publisher_type: "regulator",
    relation_authority: "self_disclosure",
    automation: "allowed",
    status: "scoped",
    requires_key: false,
    official_url: "https://disclosure2.edinet-fsa.go.jp/",
    tos_url: "https://disclosure2.edinet-fsa.go.jp/",
    notes: "日本监管披露；用于日本设备、材料、电子制造节点的官方交叉验证。"
  },
  {
    id: "un-comtrade",
    tier: "P1",
    name: "UN Comtrade",
    category: "trade",
    evidence_level_cap: 2,
    publisher_type: "macro_statistical_agency",
    relation_authority: "macro_trend",
    automation: "allowed",
    status: "scoped",
    requires_key: true,
    official_url: "https://comtradeplus.un.org/",
    tos_url: "https://comtradeplus.un.org/",
    notes: "国家/商品贸易流；只能进入 observation，不能直接生成公司级供应链边。"
  },
  {
    id: "census-trade",
    tier: "P1",
    name: "U.S. Census International Trade",
    category: "trade",
    evidence_level_cap: 2,
    publisher_type: "macro_statistical_agency",
    relation_authority: "macro_trend",
    automation: "allowed",
    status: "preview",
    implemented_package: "@supplystrata/sources-census-trade",
    requires_key: true,
    official_url: "https://www.census.gov/data/developers/data-sets/international-trade.html",
    tos_url: "https://www.census.gov/data/developers/about/terms-of-service.html",
    notes: "美国进出口观测；需要免费 Census API key；只写 TRADE_FLOW_OBSERVATION，不证明公司-公司关系。"
  },
  {
    id: "usitc-dataweb",
    tier: "P1",
    name: "USITC DataWeb",
    category: "trade",
    evidence_level_cap: 2,
    publisher_type: "macro_statistical_agency",
    relation_authority: "macro_trend",
    automation: "semi_auto",
    status: "scoped",
    requires_key: false,
    official_url: "https://dataweb.usitc.gov/",
    tos_url: "https://www.usitc.gov/",
    notes: "美国官方贸易/关税数据；作为 trade observation，不直接入事实图。"
  },
  {
    id: "eia",
    tier: "P1",
    name: "U.S. Energy Information Administration",
    category: "macro",
    evidence_level_cap: 2,
    publisher_type: "macro_statistical_agency",
    relation_authority: "macro_trend",
    automation: "allowed",
    status: "scoped",
    requires_key: true,
    official_url: "https://www.eia.gov/opendata/",
    tos_url: "https://www.eia.gov/about/copyrights_reuse.php",
    notes: "能源和电力观测；用于工厂、数据中心、冶炼链背景，不生成供应链事实边。"
  },
  {
    id: "fred",
    tier: "P1",
    name: "FRED",
    category: "macro",
    evidence_level_cap: 2,
    publisher_type: "macro_statistical_agency",
    relation_authority: "macro_trend",
    automation: "allowed",
    status: "scoped",
    requires_key: true,
    official_url: "https://fred.stlouisfed.org/docs/api/fred/",
    tos_url: "https://fred.stlouisfed.org/docs/api/terms_of_use.html",
    notes: "宏观时间序列；只作为 observation 背景，不生成公司级边。"
  },
  {
    id: "worldbank-pink",
    tier: "P1",
    name: "World Bank Pink Sheet",
    category: "commodity",
    evidence_level_cap: 2,
    publisher_type: "macro_statistical_agency",
    relation_authority: "macro_trend",
    automation: "allowed",
    status: "scoped",
    requires_key: false,
    official_url: "https://www.worldbank.org/en/research/commodity-markets",
    tos_url: "https://www.worldbank.org/en/about/legal/terms-and-conditions",
    notes: "公开商品价格；作为 commodity observation，不证明公司采购关系。"
  },
  {
    id: "usgs-mcs",
    tier: "P1",
    name: "USGS Mineral Commodity Summaries",
    category: "commodity",
    evidence_level_cap: 2,
    publisher_type: "macro_statistical_agency",
    relation_authority: "macro_trend",
    automation: "semi_auto",
    status: "scoped",
    requires_key: false,
    official_url: "https://www.usgs.gov/centers/national-minerals-information-center/mineral-commodity-summaries",
    tos_url: "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits",
    notes: "矿产产量、储量和主要国家；只进入 commodity/material observation。"
  },
  {
    id: "iea-critical-minerals",
    tier: "P1",
    name: "IEA Critical Minerals Data Explorer",
    category: "commodity",
    evidence_level_cap: 2,
    publisher_type: "macro_statistical_agency",
    relation_authority: "macro_trend",
    automation: "semi_auto",
    status: "scoped",
    requires_key: false,
    official_url: "https://www.iea.org/data-and-statistics/data-tools/critical-minerals-data-explorer",
    tos_url: "https://www.iea.org/terms",
    notes: "关键矿物供应/需求情景；只作长期材料约束 observation。"
  },
  {
    id: "rmi-facilities",
    tier: "P1",
    name: "Responsible Minerals Initiative Facility Lists",
    category: "facility",
    evidence_level_cap: 3,
    publisher_type: "official_supplier_list",
    relation_authority: "facility_claim",
    automation: "semi_auto",
    status: "scoped",
    requires_key: false,
    official_url: "https://www.responsiblemineralsinitiative.org/facilities-lists/",
    tos_url: "https://www.responsiblemineralsinitiative.org/",
    notes: "冶炼/精炼设施候选；必须和公司 responsible sourcing 报告交叉后才能升级。"
  },
  {
    id: "eu-crma",
    tier: "P1",
    name: "EU Critical Raw Materials Act",
    category: "policy",
    evidence_level_cap: 2,
    publisher_type: "regulator",
    relation_authority: "macro_trend",
    automation: "semi_auto",
    status: "scoped",
    requires_key: false,
    official_url: "https://single-market-economy.ec.europa.eu/sectors/raw-materials/areas-specific-interest/critical-raw-materials_en",
    tos_url: "https://commission.europa.eu/legal-notice_en",
    notes: "关键原材料政策与风险背景；作为 policy observation，不生成公司级供应链边。"
  },
  {
    id: "osh",
    tier: "P1",
    name: "Open Supply Hub",
    category: "facility",
    evidence_level_cap: 3,
    publisher_type: "official_supplier_list",
    relation_authority: "facility_claim",
    automation: "allowed",
    status: "preview",
    implemented_package: "@supplystrata/sources-osh",
    requires_key: true,
    official_url: "https://opensupplyhub.org/",
    tos_url: "https://info.opensupplyhub.org/terms-of-use",
    notes: "全球设施候选与 contributor 声明；需要 OSH API token；只写 FACILITY_PROFILE_OBSERVATION，与官方供应商名单交叉后才升级。"
  },
  {
    id: "noaa-ais",
    tier: "P2",
    name: "NOAA AccessAIS",
    category: "logistics",
    evidence_level_cap: 2,
    publisher_type: "macro_statistical_agency",
    relation_authority: "macro_trend",
    automation: "semi_auto",
    status: "scoped",
    requires_key: false,
    official_url: "https://coast.noaa.gov/digitalcoast/tools/ais.html",
    tos_url: "https://coast.noaa.gov/digitalcoast/tools/ais.html",
    notes: "船舶/港口活动背景；不能证明货物归属或公司级运输关系。"
  },
  {
    id: "sam-gov",
    tier: "P2",
    name: "SAM.gov Contract Opportunities",
    category: "procurement_news",
    evidence_level_cap: 2,
    publisher_type: "regulator",
    relation_authority: "lead_only",
    automation: "semi_auto",
    status: "scoped",
    requires_key: true,
    official_url: "https://sam.gov/content/opportunities",
    tos_url: "https://sam.gov/content/terms-of-use",
    notes: "美国联邦采购机会；默认进入 lead/hypothesis queue。"
  },
  {
    id: "usaspending",
    tier: "P2",
    name: "USAspending.gov",
    category: "procurement_news",
    evidence_level_cap: 2,
    publisher_type: "regulator",
    relation_authority: "lead_only",
    automation: "allowed",
    status: "scoped",
    requires_key: false,
    official_url: "https://api.usaspending.gov/",
    tos_url: "https://www.usaspending.gov/about",
    notes: "美国联邦合同/拨款；只能作为采购线索或需求侧 observation。"
  },
  {
    id: "eu-ted",
    tier: "P2",
    name: "EU TED",
    category: "procurement_news",
    evidence_level_cap: 2,
    publisher_type: "regulator",
    relation_authority: "lead_only",
    automation: "allowed",
    status: "scoped",
    requires_key: false,
    official_url: "https://ted.europa.eu/",
    tos_url: "https://ted.europa.eu/en/legal-notice",
    notes: "欧洲公共采购；默认进入 lead，不直接写供应链事实边。"
  },
  {
    id: "gdelt",
    tier: "P2",
    name: "GDELT",
    category: "procurement_news",
    evidence_level_cap: 1,
    publisher_type: "news",
    relation_authority: "lead_only",
    automation: "allowed",
    status: "scoped",
    requires_key: false,
    official_url: "https://www.gdeltproject.org/",
    tos_url: "https://www.gdeltproject.org/",
    notes: "新闻事件线索；只能进入 lead/hypothesis queue，不能直接升级事实边。"
  },
  {
    id: "manual",
    tier: "manual",
    name: "Manual Evidence",
    category: "manual",
    evidence_level_cap: 2,
    publisher_type: "manual",
    relation_authority: "lead_only",
    automation: "manual_only",
    status: "planned",
    requires_key: false,
    official_url: "manual://evidence",
    tos_url: "manual://evidence",
    notes: "人工录入本身不是原始来源；没有 underlying official source 时只能作为 lead，不能生成高等级事实边。"
  },
  {
    id: "import-yeti",
    tier: "manual",
    name: "ImportYeti",
    category: "trade",
    evidence_level_cap: 3,
    publisher_type: "manual",
    relation_authority: "lead_only",
    automation: "manual_only",
    status: "manual_only",
    requires_key: false,
    official_url: "https://www.importyeti.com/",
    tos_url: "https://www.importyeti.com/terms",
    notes: "不做 adapter，不自动抓取；仅允许研究员手工摘录少量证据。"
  }
] as const satisfies readonly SourceRegistryEntry[];

export interface SourceAuthority {
  source_adapter_id: string;
  document_type: DocumentType;
  publisher_type: PublisherType;
  relation_authority: RelationAuthority;
  max_evidence_level: EvidenceLevel;
}

export function listSources(): SourceRegistryEntry[] {
  return [...SOURCE_REGISTRY];
}

export function getSourceById(sourceAdapterId: string): SourceRegistryEntry | undefined {
  return sourceById(sourceAdapterId);
}

// 来源权威矩阵的唯一入口：scorer 只能通过这里判断“这个来源最多能证明什么”。
export function sourceAuthorityFor(input: { source_adapter_id: string; document_type: DocumentType }): SourceAuthority {
  const source = sourceById(input.source_adapter_id);
  if (source !== undefined) {
    return {
      source_adapter_id: input.source_adapter_id,
      document_type: input.document_type,
      publisher_type: source.publisher_type,
      relation_authority: source.relation_authority,
      max_evidence_level: source.evidence_level_cap
    };
  }
  return fallbackAuthority(input);
}

function sourceById(sourceAdapterId: string): SourceRegistryEntry | undefined {
  if (sourceAdapterId === "sec-edgar-fixture") return SOURCE_REGISTRY.find((source) => source.id === "sec-edgar");
  return SOURCE_REGISTRY.find((source) => source.id === sourceAdapterId);
}

function fallbackAuthority(input: { source_adapter_id: string; document_type: DocumentType }): SourceAuthority {
  // 未注册来源不能只靠 document_type 获得高证据等级；先降级成 lead，直到 source_registry 显式登记权威。
  return {
    source_adapter_id: input.source_adapter_id,
    document_type: input.document_type,
    publisher_type: "manual",
    relation_authority: "lead_only",
    max_evidence_level: 2
  };
}

export function sourceStatusSummary(): {
  total: number;
  implemented: number;
  preview: number;
  planned: number;
  scoped: number;
  manualOnly: number;
  requiresKey: number;
} {
  const sources = listSources();
  return {
    total: sources.length,
    implemented: sources.filter((source) => source.status === "implemented").length,
    preview: sources.filter((source) => source.status === "preview").length,
    planned: sources.filter((source) => source.status === "planned").length,
    scoped: sources.filter((source) => source.status === "scoped").length,
    manualOnly: sources.filter((source) => source.status === "manual_only").length,
    requiresKey: sources.filter((source) => source.requires_key).length
  };
}
