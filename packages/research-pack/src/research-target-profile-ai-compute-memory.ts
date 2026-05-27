import type { OfficialDisclosureReadinessTargetNode } from "./official-disclosure-readiness.js";
import type { ResearchTargetProfile } from "./research-target-profile-definitions.js";
import {
  appleSupplierListTargetComponent,
  dartKrTargetCompany,
  edinetDailyFilingsTargetComponent,
  secTargetCompany,
  targetCompany,
  targetComponent,
  twseMopsTargetCompany
} from "./research-target-profile-nodes.js";

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
  targetComponent("COMP-SEMICONDUCTOR-EQUIPMENT", "Semiconductor equipment", "P1", ["asml-ir", "company-ir", "sec-edgar", "edinet"]),
  targetComponent("COMP-PHOTORESIST", "Photoresist", "P1", ["company-ir", "edinet"]),
  targetComponent("COMP-TARGET", "Sputtering target", "P1", ["company-ir", "edinet"]),
  targetComponent("COMP-CMP", "CMP consumables", "P1", ["company-ir", "edinet"]),
  targetComponent("COMP-SPECIALTY-GASES", "Specialty gases", "P1", ["company-ir", "edinet"]),
  edinetDailyFilingsTargetComponent("COMP-ABF-SUBSTRATE", "ABF substrate", "P1", ["company-ir", "edinet"])
] as const satisfies readonly OfficialDisclosureReadinessTargetNode[];

export const AI_COMPUTE_MEMORY_PROFILE: ResearchTargetProfile = {
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
