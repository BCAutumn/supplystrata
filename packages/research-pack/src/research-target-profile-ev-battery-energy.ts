import type { OfficialDisclosureReadinessTargetNode } from "./official-disclosure-readiness.js";
import type { ResearchTargetProfile } from "./research-target-profile-definitions.js";
import { secTargetCompany, targetCompany, targetComponent } from "./research-target-profile-nodes.js";

const EV_BATTERY_ENERGY_TARGET_NODES = [
  secTargetCompany("ENT-TESLA", "Tesla", "P0", "0001318605"),
  secTargetCompany("ENT-GM", "General Motors", "P1", "0001467858"),
  secTargetCompany("ENT-FORD", "Ford", "P1", "0000037996"),
  secTargetCompany("ENT-RIVIAN", "Rivian", "P1", "0001874178"),
  secTargetCompany("ENT-LUCID", "Lucid", "P2", "0001811210"),
  secTargetCompany("ENT-CATL", "CATL", "P0", "0002070829"),
  targetCompany("ENT-PANASONIC", "Panasonic", "P0", ["company-ir"]),
  targetCompany("ENT-LG-ENERGY-SOLUTION", "LG Energy Solution", "P0", ["company-ir"]),
  targetCompany("ENT-BYD", "BYD", "P1", ["company-ir"]),
  targetCompany("ENT-TALON-METALS", "Talon Metals", "P1", ["company-ir"]),
  targetCompany("ENT-SYRAH-RESOURCES", "Syrah Resources", "P1", ["company-ir"]),
  targetComponent("COMP-BATTERY-CELL", "Battery cell", "P0", ["sec-edgar", "company-ir"]),
  targetComponent("COMP-BATTERY-PACK", "Battery pack", "P0", ["sec-edgar", "company-ir"]),
  targetComponent("COMP-ENERGY-STORAGE-SYSTEM", "Energy storage system", "P0", ["sec-edgar", "company-ir"]),
  targetComponent("COMP-EV-COMPONENT", "Electric vehicle component", "P1", ["sec-edgar", "company-ir"]),
  targetComponent("COMP-POWER-ELECTRONICS", "Power electronics", "P1", ["sec-edgar", "company-ir"]),
  targetComponent("COMP-AUTOMOTIVE-SEMICONDUCTOR", "Automotive semiconductor", "P1", ["sec-edgar", "company-ir"]),
  targetComponent("COMP-CATHODE-MATERIAL", "Cathode active material", "P0", ["company-ir", "usgs-mcs", "iea-critical-minerals"]),
  targetComponent("COMP-ANODE-MATERIAL", "Anode material", "P0", ["company-ir", "usgs-mcs", "iea-critical-minerals", "rmi-facilities"]),
  targetComponent("COMP-LITHIUM-REFINING", "Lithium refining", "P0", ["sec-edgar", "company-ir", "usgs-mcs", "iea-critical-minerals"]),
  targetComponent("COMP-NICKEL", "Nickel", "P1", ["company-ir", "usgs-mcs", "worldbank-pink", "iea-critical-minerals"]),
  targetComponent("COMP-GRAPHITE", "Battery-grade graphite", "P1", ["company-ir", "usgs-mcs", "iea-critical-minerals", "rmi-facilities"]),
  targetComponent("COMP-BATTERY-RECYCLING", "Battery recycling", "P2", ["company-ir", "rmi-facilities"]),
  targetComponent("COMP-BATTERY-MANUFACTURING-EQUIPMENT", "Battery manufacturing equipment", "P1", ["company-ir", "sec-edgar"])
] as const satisfies readonly OfficialDisclosureReadinessTargetNode[];

export const EV_BATTERY_ENERGY_PROFILE: ResearchTargetProfile = {
  profile_id: "ev-battery-energy.v0",
  version: "0.1.0",
  title: "EV battery / energy storage baseline",
  description:
    "Built-in deterministic baseline for electric vehicles, battery cells, storage systems, critical battery materials, and related manufacturing constraints. It is a reusable coverage target, not a Tesla-only supplier graph.",
  applies_to_company_ids: EV_BATTERY_ENERGY_TARGET_NODES.filter((node) => node.node_kind === "company")
    .map((node) => node.node_id)
    .sort(),
  applies_to_component_ids: EV_BATTERY_ENERGY_TARGET_NODES.filter((node) => node.node_kind === "component")
    .map((node) => node.node_id)
    .sort(),
  target_nodes: [...EV_BATTERY_ENERGY_TARGET_NODES]
};
