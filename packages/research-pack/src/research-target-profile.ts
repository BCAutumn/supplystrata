import type { OfficialDisclosureReadinessTargetNode } from "./official-disclosure-readiness.js";

export type ResearchTargetProfileId = "ai-compute-memory.v0";

export interface ResearchTargetProfile {
  profile_id: ResearchTargetProfileId;
  version: "0.1.0";
  title: string;
  description: string;
  applies_to_company_ids: string[];
  applies_to_component_ids: string[];
  target_nodes: OfficialDisclosureReadinessTargetNode[];
}

export interface ResearchTargetProfileSelection {
  profile: ResearchTargetProfile | null;
  reason: string;
}

export type ResearchTargetProfileOption = ResearchTargetProfileId | "none";
type ResearchTargetNodePriority = NonNullable<OfficialDisclosureReadinessTargetNode["priority"]>;

const SEC_COMPANY_FACT_OBSERVATION_METRICS = [
  "inventory",
  "cost_of_revenue",
  "capital_expenditures",
  "accounts_payable",
  "purchase_obligations",
  "revenue"
] as const;

const AI_COMPUTE_MEMORY_TARGET_NODES = [
  secTargetCompany("ENT-MICROSOFT", "Microsoft", "P0", "0000789019"),
  secTargetCompany("ENT-AMAZON", "Amazon", "P0", "0001018724"),
  secTargetCompany("ENT-ALPHABET", "Alphabet", "P1", "0001652044"),
  secTargetCompany("ENT-META", "Meta", "P1", "0001326801"),
  secTargetCompany("ENT-ORACLE", "Oracle", "P1", "0001341439"),
  secTargetCompany("ENT-NVIDIA", "NVIDIA", "P0", "0001045810"),
  secTargetCompany("ENT-AMD", "AMD", "P0", "0000002488"),
  secTargetCompany("ENT-BROADCOM", "Broadcom", "P1", "0001730168"),
  targetCompany("ENT-TSMC", "TSMC", "P0", ["tsmc-ir"]),
  dartKrTargetCompany("ENT-SAMSUNG-ELECTRONICS", "Samsung Electronics", "P0", "00126380", ["samsung-ir"]),
  dartKrTargetCompany("ENT-SKHYNIX", "SK Hynix", "P0", "00164779", ["skhynix-ir"]),
  secTargetCompany("ENT-MICRON", "Micron", "P0", "0000723125", ["micron-ir"]),
  secTargetCompany("ENT-ASML", "ASML", "P0", "0000937966", ["asml-ir"]),
  twseMopsTargetCompany("ENT-FOXCONN", "Foxconn", "P1", "2317", ["company-ir"]),
  twseMopsTargetCompany("ENT-QUANTA", "Quanta", "P1", "2382", ["company-ir"]),
  targetComponent("COMP-GPU", "GPU", "P0", ["sec-edgar", "company-ir"]),
  targetComponent("COMP-HBM", "HBM", "P0", ["skhynix-ir", "samsung-ir", "micron-ir"]),
  targetComponent("COMP-DRAM", "DRAM", "P0", ["skhynix-ir", "samsung-ir", "micron-ir"]),
  targetComponent("COMP-WAFER", "Wafer", "P1", ["tsmc-ir", "samsung-ir"]),
  targetComponent("COMP-ADVANCED-PACKAGING", "Advanced packaging", "P0", ["tsmc-ir", "samsung-ir"]),
  targetComponent("COMP-SERVER", "AI server", "P0", ["sec-edgar", "company-ir"]),
  targetComponent("COMP-PCB", "PCB", "P0", ["company-ir", "twse-mops", "edinet"]),
  targetComponent("COMP-OPTICAL-MODULE", "Optical module", "P1", ["company-ir", "sec-edgar"]),
  targetComponent("COMP-POWER-SUPPLY", "Power supply", "P1", ["company-ir", "sec-edgar", "twse-mops"]),
  targetComponent("COMP-COOLING", "Cooling", "P1", ["company-ir", "sec-edgar"]),
  appleSupplierListTargetComponent("COMP-MANUFACTURING-SERVICES", "Manufacturing services", "P1", ["company-ir", "apple-suppliers"]),
  targetComponent("COMP-CCL", "Copper clad laminate", "P1", ["company-ir", "twse-mops", "edinet"]),
  targetComponent("COMP-COPPER-FOIL", "Copper foil", "P1", ["company-ir", "twse-mops", "edinet"]),
  targetComponent("COMP-ELECTRONIC-GLASS-CLOTH", "Electronic glass cloth", "P2", ["company-ir", "edinet"]),
  targetComponent("COMP-LAMINATE-RESIN", "Laminate resin", "P2", ["company-ir", "edinet"]),
  targetComponent("COMP-CLEANROOM", "Cleanroom", "P1", ["company-ir"]),
  edinetDailyFilingsTargetComponent("COMP-SILICON-WAFER", "Silicon wafer", "P1", ["company-ir", "edinet"]),
  targetComponent("COMP-EUV-LITHOGRAPHY", "EUV lithography", "P0", ["asml-ir"]),
  edinetDailyFilingsTargetComponent("COMP-ABF-SUBSTRATE", "ABF substrate", "P1", ["company-ir", "edinet"])
] as const satisfies readonly OfficialDisclosureReadinessTargetNode[];

const AI_COMPUTE_MEMORY_PROFILE: ResearchTargetProfile = {
  profile_id: "ai-compute-memory.v0",
  version: "0.1.0",
  title: "AI compute / memory baseline",
  description:
    "Built-in deterministic baseline for the AI accelerator, memory, foundry, equipment, and AI server supply-chain slice. It is a coverage target, not a claim of global completeness.",
  applies_to_company_ids: AI_COMPUTE_MEMORY_TARGET_NODES.filter((node) => node.node_kind === "company")
    .map((node) => node.node_id)
    .sort(),
  applies_to_component_ids: AI_COMPUTE_MEMORY_TARGET_NODES.filter((node) => node.node_kind === "component")
    .map((node) => node.node_id)
    .sort(),
  target_nodes: [...AI_COMPUTE_MEMORY_TARGET_NODES]
};

const BUILT_IN_RESEARCH_TARGET_PROFILES = [AI_COMPUTE_MEMORY_PROFILE] as const satisfies readonly ResearchTargetProfile[];

export function listBuiltInResearchTargetProfiles(): ResearchTargetProfile[] {
  return BUILT_IN_RESEARCH_TARGET_PROFILES.map(cloneResearchTargetProfile);
}

export function getBuiltInResearchTargetProfile(profileId: ResearchTargetProfileId): ResearchTargetProfile {
  const profile = BUILT_IN_RESEARCH_TARGET_PROFILES.find((item) => item.profile_id === profileId);
  if (profile === undefined) throw new Error(`Unknown research target profile: ${profileId}`);
  return cloneResearchTargetProfile(profile);
}

export function selectResearchTargetProfile(input: {
  profile_id?: ResearchTargetProfileOption;
  company_id: string;
  component_ids: readonly string[];
}): ResearchTargetProfileSelection {
  if (input.profile_id === "none") return { profile: null, reason: "Research target profile disabled by caller." };
  if (input.profile_id !== undefined) {
    const profile = getBuiltInResearchTargetProfile(input.profile_id);
    return { profile, reason: `Research target profile explicitly selected: ${profile.profile_id}.` };
  }

  for (const profile of BUILT_IN_RESEARCH_TARGET_PROFILES) {
    if (profile.applies_to_company_ids.includes(input.company_id)) {
      return { profile: cloneResearchTargetProfile(profile), reason: `Selected ${profile.profile_id} because company ${input.company_id} is in scope.` };
    }
    if (input.component_ids.some((componentId) => profile.applies_to_component_ids.includes(componentId))) {
      return {
        profile: cloneResearchTargetProfile(profile),
        reason: `Selected ${profile.profile_id} because at least one requested component is in scope.`
      };
    }
  }

  return { profile: null, reason: "No built-in research target profile matched this company/component scope." };
}

function cloneResearchTargetProfile(profile: ResearchTargetProfile): ResearchTargetProfile {
  return {
    ...profile,
    applies_to_company_ids: [...profile.applies_to_company_ids],
    applies_to_component_ids: [...profile.applies_to_component_ids],
    target_nodes: profile.target_nodes.map((node) => ({
      ...node,
      ...(node.expected_source_ids === undefined ? {} : { expected_source_ids: [...node.expected_source_ids] }),
      ...(node.expected_source_targets === undefined
        ? {}
        : {
            expected_source_targets: node.expected_source_targets.map((target) => ({
              ...target,
              target_config: cloneTargetConfig(target.target_config)
            }))
          })
    }))
  };
}

function secTargetCompany(
  nodeId: string,
  name: string,
  priority: ResearchTargetNodePriority,
  cik: string,
  additionalExpectedSourceIds: readonly string[] = []
): OfficialDisclosureReadinessTargetNode {
  return {
    ...targetCompany(nodeId, name, priority, ["sec-edgar", ...additionalExpectedSourceIds]),
    expected_source_targets: [
      {
        source_id: "sec-edgar",
        target_kind: "sec-company-filings",
        target_config: {
          cik,
          entity_id: nodeId,
          form_types: ["10-K", "10-Q", "20-F", "8-K"],
          limit: 3
        },
        reason: `${name} has a curated SEC CIK in seeds/entities.csv; monitor official filings as Gate 1 source coverage.`
      },
      {
        source_id: "sec-edgar",
        target_kind: "sec-company-facts",
        target_config: {
          cik,
          entity_id: nodeId,
          metrics: [...SEC_COMPANY_FACT_OBSERVATION_METRICS],
          max_periods: 12
        },
        reason: `${name} has a curated SEC CIK in seeds/entities.csv; monitor SEC company facts as observation-only financial signals for Gate 1.`
      }
    ]
  };
}

function targetCompany(
  nodeId: string,
  name: string,
  priority: ResearchTargetNodePriority,
  expectedSourceIds: readonly string[]
): OfficialDisclosureReadinessTargetNode {
  return { node_id: nodeId, node_kind: "company", name, priority, expected_source_ids: expectedSourceIds };
}

function targetComponent(
  nodeId: string,
  name: string,
  priority: ResearchTargetNodePriority,
  expectedSourceIds: readonly string[]
): OfficialDisclosureReadinessTargetNode {
  return { node_id: nodeId, node_kind: "component", name, priority, expected_source_ids: expectedSourceIds };
}

function appleSupplierListTargetComponent(
  nodeId: string,
  name: string,
  priority: ResearchTargetNodePriority,
  expectedSourceIds: readonly string[]
): OfficialDisclosureReadinessTargetNode {
  return {
    ...targetComponent(nodeId, name, priority, expectedSourceIds),
    expected_source_targets: [
      {
        source_id: "apple-suppliers",
        target_kind: "supplier-list-review",
        target_config: {
          fiscal_year: 2022,
          entity_id: "ENT-APPLE",
          scope_kind: "component",
          scope_id: nodeId,
          component_id: nodeId
        },
        reason:
          "Apple Supplier List FY2022 is an official supplier-list review path for manufacturing-services coverage; it enqueues review candidates and facility leads, not fact edges."
      }
    ]
  };
}

function edinetDailyFilingsTargetComponent(
  nodeId: string,
  name: string,
  priority: ResearchTargetNodePriority,
  expectedSourceIds: readonly string[]
): OfficialDisclosureReadinessTargetNode {
  return {
    ...targetComponent(nodeId, name, priority, expectedSourceIds),
    expected_source_targets: [
      {
        source_id: "edinet",
        target_kind: "daily-filings",
        target_config: {
          date: "2025-06-30",
          type: 2,
          scope_kind: "component",
          scope_id: nodeId,
          component_id: nodeId,
          doc_type_codes: ["120"]
        },
        reason:
          "EDINET daily documents list is a Japanese official disclosure directory seed for annual securities reports; it only monitors metadata and does not download ZIP/PDF/XBRL or create fact edges."
      }
    ]
  };
}

function twseMopsTargetCompany(
  nodeId: string,
  name: string,
  priority: ResearchTargetNodePriority,
  stockCode: string,
  additionalExpectedSourceIds: readonly string[] = []
): OfficialDisclosureReadinessTargetNode {
  return {
    ...targetCompany(nodeId, name, priority, [...additionalExpectedSourceIds, "twse-mops"]),
    expected_source_targets: [
      {
        source_id: "twse-mops",
        target_kind: "electronic-documents",
        target_config: {
          stock_code: stockCode,
          entity_id: nodeId,
          year: 2025,
          document_kind: "F",
          limit: 50
        },
        reason:
          `${name} has a curated TWSE/MOPS stock code; monitor the official electronic documents directory as Gate 1 coverage. ` +
          "This target records directory metadata only and must not download PDF files or create fact edges."
      }
    ]
  };
}

function dartKrTargetCompany(
  nodeId: string,
  name: string,
  priority: ResearchTargetNodePriority,
  corpCode: string,
  additionalExpectedSourceIds: readonly string[] = []
): OfficialDisclosureReadinessTargetNode {
  return {
    ...targetCompany(nodeId, name, priority, [...additionalExpectedSourceIds, "dart-kr"]),
    expected_source_targets: [
      {
        source_id: "dart-kr",
        target_kind: "company-filings",
        target_config: {
          corp_code: corpCode,
          entity_id: nodeId,
          disclosure_types: ["A", "B"],
          corp_cls: "Y",
          year: 2025,
          final_reports_only: "Y",
          limit: 20
        },
        reason: `${name} has a curated OpenDART corp_code; source-plan should treat this as a periodic official disclosure target template and override year at call time.`
      }
    ]
  };
}

function cloneTargetConfig(config: Record<string, string | number | boolean | string[]>): Record<string, string | number | boolean | string[]> {
  const cloned: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(config)) cloned[key] = Array.isArray(value) ? [...value] : value;
  return cloned;
}
