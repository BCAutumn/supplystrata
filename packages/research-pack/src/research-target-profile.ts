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
  targetCompany("ENT-SAMSUNG-ELECTRONICS", "Samsung Electronics", "P0", ["samsung-ir", "dart-kr"]),
  targetCompany("ENT-SKHYNIX", "SK Hynix", "P0", ["skhynix-ir", "dart-kr"]),
  secTargetCompany("ENT-MICRON", "Micron", "P0", "0000723125", ["micron-ir"]),
  secTargetCompany("ENT-ASML", "ASML", "P0", "0000937966", ["asml-ir"]),
  targetCompany("ENT-FOXCONN", "Foxconn", "P1", ["company-ir"]),
  targetCompany("ENT-QUANTA", "Quanta", "P1", ["company-ir"]),
  targetComponent("COMP-GPU", "GPU", "P0", ["sec-edgar", "company-ir"]),
  targetComponent("COMP-HBM", "HBM", "P0", ["skhynix-ir", "samsung-ir", "micron-ir"]),
  targetComponent("COMP-DRAM", "DRAM", "P0", ["skhynix-ir", "samsung-ir", "micron-ir"]),
  targetComponent("COMP-WAFER", "Wafer", "P1", ["tsmc-ir", "samsung-ir"]),
  targetComponent("COMP-ADVANCED-PACKAGING", "Advanced packaging", "P0", ["tsmc-ir", "samsung-ir"]),
  targetComponent("COMP-SERVER", "AI server", "P0", ["sec-edgar", "company-ir"]),
  targetComponent("COMP-MANUFACTURING-SERVICES", "Manufacturing services", "P1", ["company-ir", "apple-suppliers"]),
  targetComponent("COMP-SILICON-WAFER", "Silicon wafer", "P1", ["company-ir", "edinet"]),
  targetComponent("COMP-EUV-LITHOGRAPHY", "EUV lithography", "P0", ["asml-ir"]),
  targetComponent("COMP-ABF-SUBSTRATE", "ABF substrate", "P1", ["company-ir", "edinet"])
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

function cloneTargetConfig(config: Record<string, string | number | boolean | string[]>): Record<string, string | number | boolean | string[]> {
  const cloned: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(config)) cloned[key] = Array.isArray(value) ? [...value] : value;
  return cloned;
}
