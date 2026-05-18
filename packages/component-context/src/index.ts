import { readFileSync } from "node:fs";
import type { ChainEndpointKind, ObservationType } from "@supplystrata/core";

export type ComponentDependencyCategory = "component" | "material" | "equipment" | "energy" | "logistics" | "facility" | "service";

export interface ComponentUpstreamLead {
  dependency_id: string;
  parent_component_id: string;
  target_kind: ChainEndpointKind;
  target_id: string;
  target_name: string;
  tier_depth: 1 | 2 | 3;
  category: ComponentDependencyCategory;
  title: string;
  summary: string;
  confidence: number;
  source_suggestions: string[];
  unknowns: string[];
}

export type ComponentTradeCodeSystem = "HS" | "HTS" | "SITC" | "CENSUS";

export interface ComponentTradeCode {
  system: ComponentTradeCodeSystem;
  code: string;
  description: string;
  confidence: number;
  proxy_only: boolean;
  notes: string;
}

export interface ComponentMaterialExposure {
  material_id: string;
  name: string;
  role: string;
  confidence: number;
  source_suggestions: string[];
}

export interface ComponentTradeTaxonomy {
  component_id: string;
  hs_codes: ComponentTradeCode[];
  materials: ComponentMaterialExposure[];
}

export type MaterialCategory = "mineral" | "metal" | "chemical" | "industrial_gas";
export type MaterialObservationRequiredPeriod = "year" | "month" | "none";

export interface MaterialObservationTarget {
  source_adapter_id: string;
  target_kind: string;
  runnable: boolean;
  observation_type: ObservationType;
  required_period: MaterialObservationRequiredPeriod;
  target_config_template: Record<string, string | number | boolean | string[]>;
  reason: string;
}

export interface MaterialTaxonomy {
  material_id: string;
  name: string;
  aliases: string[];
  category: MaterialCategory;
  observation_targets: MaterialObservationTarget[];
}

const CATALOG_URL = new URL("../patterns/upstream-dependencies.json", import.meta.url);
const TRADE_TAXONOMY_URL = new URL("../patterns/trade-taxonomy.json", import.meta.url);
const MATERIAL_TAXONOMY_URL = new URL("../patterns/material-taxonomy.json", import.meta.url);

let cachedCatalog: ComponentUpstreamLead[] | undefined;
let cachedTradeTaxonomy: ComponentTradeTaxonomy[] | undefined;
let cachedMaterialTaxonomy: MaterialTaxonomy[] | undefined;

export function listComponentUpstreamLeads(componentId: string, maxTierDepth = 2): ComponentUpstreamLead[] {
  const normalizedDepth = clampTierDepth(maxTierDepth);
  return loadCatalog()
    .filter((entry) => entry.parent_component_id === componentId && entry.tier_depth <= normalizedDepth)
    .sort((left, right) => left.tier_depth - right.tier_depth || left.target_name.localeCompare(right.target_name));
}

export function listKnownComponentContextIds(): string[] {
  return [...new Set(loadCatalog().flatMap((entry) => [entry.parent_component_id, entry.target_id]))].sort();
}

export function listComponentTradeTaxonomies(): ComponentTradeTaxonomy[] {
  return [...loadTradeTaxonomy()].sort((left, right) => left.component_id.localeCompare(right.component_id));
}

export function getComponentTradeTaxonomy(componentId: string): ComponentTradeTaxonomy | undefined {
  return loadTradeTaxonomy().find((entry) => entry.component_id === componentId);
}

export function listComponentHsCodes(componentId: string): ComponentTradeCode[] {
  return [...(getComponentTradeTaxonomy(componentId)?.hs_codes ?? [])];
}

export function listComponentMaterialExposures(componentId: string): ComponentMaterialExposure[] {
  return [...(getComponentTradeTaxonomy(componentId)?.materials ?? [])];
}

export function findComponentTradeCode(componentId: string, code: string): ComponentTradeCode | undefined {
  return getComponentTradeTaxonomy(componentId)?.hs_codes.find((entry) => entry.code === code);
}

export function listKnownComponentTradeTaxonomyIds(): string[] {
  return listComponentTradeTaxonomies().map((entry) => entry.component_id);
}

export function listMaterialTaxonomies(): MaterialTaxonomy[] {
  return [...loadMaterialTaxonomy()].sort((left, right) => left.material_id.localeCompare(right.material_id));
}

export function getMaterialTaxonomy(materialId: string): MaterialTaxonomy | undefined {
  return loadMaterialTaxonomy().find((entry) => entry.material_id === materialId);
}

export function listMaterialObservationTargets(materialId: string): MaterialObservationTarget[] {
  return [...(getMaterialTaxonomy(materialId)?.observation_targets ?? [])];
}

export function listComponentMaterialObservationTargets(componentId: string): { material: ComponentMaterialExposure; target: MaterialObservationTarget }[] {
  return listComponentMaterialExposures(componentId).flatMap((material) =>
    listMaterialObservationTargets(material.material_id).map((target) => ({ material, target }))
  );
}

function loadCatalog(): ComponentUpstreamLead[] {
  if (cachedCatalog !== undefined) return cachedCatalog;
  const parsed: unknown = JSON.parse(readFileSync(CATALOG_URL, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Component upstream dependency catalog must be a JSON array");
  cachedCatalog = parsed.map(parseCatalogEntry);
  return cachedCatalog;
}

function loadTradeTaxonomy(): ComponentTradeTaxonomy[] {
  if (cachedTradeTaxonomy !== undefined) return cachedTradeTaxonomy;
  const parsed: unknown = JSON.parse(readFileSync(TRADE_TAXONOMY_URL, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Component trade taxonomy catalog must be a JSON array");
  cachedTradeTaxonomy = parsed.map(parseTradeTaxonomyEntry);
  return cachedTradeTaxonomy;
}

function loadMaterialTaxonomy(): MaterialTaxonomy[] {
  if (cachedMaterialTaxonomy !== undefined) return cachedMaterialTaxonomy;
  const parsed: unknown = JSON.parse(readFileSync(MATERIAL_TAXONOMY_URL, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Material taxonomy catalog must be a JSON array");
  cachedMaterialTaxonomy = parsed.map(parseMaterialTaxonomyEntry);
  return cachedMaterialTaxonomy;
}

function parseCatalogEntry(value: unknown): ComponentUpstreamLead {
  if (!isRecord(value)) throw new Error("Component upstream dependency catalog entry must be an object");
  const output: ComponentUpstreamLead = {
    dependency_id: readString(value, "dependency_id"),
    parent_component_id: readString(value, "parent_component_id"),
    target_kind: readChainEndpointKind(value, "target_kind"),
    target_id: readString(value, "target_id"),
    target_name: readString(value, "target_name"),
    tier_depth: readTierDepth(value, "tier_depth"),
    category: readCategory(value, "category"),
    title: readString(value, "title"),
    summary: readString(value, "summary"),
    confidence: readConfidence(value, "confidence"),
    source_suggestions: readStringArray(value, "source_suggestions"),
    unknowns: readStringArray(value, "unknowns")
  };
  if (output.dependency_id.trim().length === 0) throw new Error("dependency_id cannot be empty");
  return output;
}

function parseTradeTaxonomyEntry(value: unknown): ComponentTradeTaxonomy {
  if (!isRecord(value)) throw new Error("Component trade taxonomy entry must be an object");
  const output: ComponentTradeTaxonomy = {
    component_id: readString(value, "component_id"),
    hs_codes: readTradeCodeArray(value, "hs_codes"),
    materials: readMaterialExposureArray(value, "materials")
  };
  if (output.hs_codes.length === 0 && output.materials.length === 0) {
    throw new Error(`Component trade taxonomy entry must include hs_codes or materials: ${output.component_id}`);
  }
  return output;
}

function parseMaterialTaxonomyEntry(value: unknown): MaterialTaxonomy {
  if (!isRecord(value)) throw new Error("Material taxonomy entry must be an object");
  const output: MaterialTaxonomy = {
    material_id: readString(value, "material_id"),
    name: readString(value, "name"),
    aliases: readStringArray(value, "aliases"),
    category: readMaterialCategory(value, "category"),
    observation_targets: readMaterialObservationTargetArray(value, "observation_targets")
  };
  return output;
}

function readMaterialObservationTargetArray(record: Record<string, unknown>, key: string): MaterialObservationTarget[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`Material taxonomy field ${key} must be an array`);
  return value.map((item) => {
    if (!isRecord(item)) throw new Error(`Material taxonomy field ${key} contains a non-object item`);
    return {
      source_adapter_id: readString(item, "source_adapter_id"),
      target_kind: readString(item, "target_kind"),
      runnable: readBoolean(item, "runnable"),
      observation_type: readObservationType(item, "observation_type"),
      required_period: readRequiredPeriod(item, "required_period"),
      target_config_template: readTargetConfigTemplate(item, "target_config_template"),
      reason: readString(item, "reason")
    };
  });
}

function readTargetConfigTemplate(record: Record<string, unknown>, key: string): Record<string, string | number | boolean | string[]> {
  const value = record[key];
  if (!isRecord(value)) throw new Error(`Material taxonomy field ${key} must be an object`);
  const output: Record<string, string | number | boolean | string[]> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (typeof entryValue === "string" || typeof entryValue === "number" || typeof entryValue === "boolean") {
      output[entryKey] = entryValue;
      continue;
    }
    if (Array.isArray(entryValue) && entryValue.every((item) => typeof item === "string")) {
      output[entryKey] = entryValue;
      continue;
    }
    throw new Error(`Material taxonomy target_config_template.${entryKey} has unsupported value type`);
  }
  return output;
}

function readTradeCodeArray(record: Record<string, unknown>, key: string): ComponentTradeCode[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`Component trade taxonomy field ${key} must be an array`);
  return value.map((item) => {
    if (!isRecord(item)) throw new Error(`Component trade taxonomy field ${key} contains a non-object item`);
    return {
      system: readTradeCodeSystem(item, "system"),
      code: readTradeCodeValue(item, "code"),
      description: readString(item, "description"),
      confidence: readConfidence(item, "confidence"),
      proxy_only: readBoolean(item, "proxy_only"),
      notes: readString(item, "notes")
    };
  });
}

function readMaterialExposureArray(record: Record<string, unknown>, key: string): ComponentMaterialExposure[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`Component trade taxonomy field ${key} must be an array`);
  return value.map((item) => {
    if (!isRecord(item)) throw new Error(`Component trade taxonomy field ${key} contains a non-object item`);
    return {
      material_id: readString(item, "material_id"),
      name: readString(item, "name"),
      role: readString(item, "role"),
      confidence: readConfidence(item, "confidence"),
      source_suggestions: readStringArray(item, "source_suggestions")
    };
  });
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`Component catalog field ${key} must be a non-empty string`);
  return value;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") throw new Error(`Component catalog field ${key} must be a boolean`);
  return value;
}

function readTradeCodeValue(record: Record<string, unknown>, key: string): string {
  const value = readString(record, key);
  if (!/^[0-9]{4,10}$/.test(value)) throw new Error(`Component trade taxonomy code must be 4-10 digits: ${value}`);
  return value;
}

function readTradeCodeSystem(record: Record<string, unknown>, key: string): ComponentTradeCodeSystem {
  const value = record[key];
  if (value === "HS" || value === "HTS" || value === "SITC" || value === "CENSUS") return value;
  throw new Error(`Component trade taxonomy field ${key} has unsupported code system: ${String(value)}`);
}

function readMaterialCategory(record: Record<string, unknown>, key: string): MaterialCategory {
  const value = record[key];
  if (value === "mineral" || value === "metal" || value === "chemical" || value === "industrial_gas") return value;
  throw new Error(`Material taxonomy field ${key} has unsupported category: ${String(value)}`);
}

function readObservationType(record: Record<string, unknown>, key: string): ObservationType {
  const value = record[key];
  if (
    value === "TRADE_FLOW_OBSERVATION" ||
    value === "PORT_ACTIVITY_OBSERVATION" ||
    value === "ROUTE_OBSERVATION" ||
    value === "ENERGY_PRICE_OBSERVATION" ||
    value === "COMMODITY_PRICE_OBSERVATION" ||
    value === "MINERAL_SUPPLY_OBSERVATION" ||
    value === "CAPEX_OBSERVATION" ||
    value === "INVENTORY_OBSERVATION" ||
    value === "BACKLOG_OBSERVATION" ||
    value === "CUSTOMER_CONCENTRATION_OBSERVATION" ||
    value === "POLICY_OBSERVATION" ||
    value === "PROCUREMENT_OBSERVATION" ||
    value === "FACILITY_PROFILE_OBSERVATION"
  ) {
    return value;
  }
  throw new Error(`Material taxonomy field ${key} has unsupported observation type: ${String(value)}`);
}

function readRequiredPeriod(record: Record<string, unknown>, key: string): MaterialObservationRequiredPeriod {
  const value = record[key];
  if (value === "year" || value === "month" || value === "none") return value;
  throw new Error(`Material taxonomy field ${key} has unsupported required_period: ${String(value)}`);
}

function readStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`Component catalog field ${key} must be an array`);
  const items = value.map((item) => {
    if (typeof item !== "string" || item.trim().length === 0) throw new Error(`Component catalog field ${key} contains a non-string item`);
    return item;
  });
  return items;
}

function readConfidence(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Component catalog field ${key} must be a number between 0 and 1`);
  }
  return value;
}

function readTierDepth(record: Record<string, unknown>, key: string): 1 | 2 | 3 {
  const value = record[key];
  if (value === 1 || value === 2 || value === 3) return value;
  throw new Error(`Component catalog field ${key} must be 1, 2, or 3`);
}

function readChainEndpointKind(record: Record<string, unknown>, key: string): ChainEndpointKind {
  const value = record[key];
  if (
    value === "company" ||
    value === "entity" ||
    value === "facility" ||
    value === "component" ||
    value === "country" ||
    value === "port" ||
    value === "vessel" ||
    value === "carrier" ||
    value === "mineral" ||
    value === "route" ||
    value === "document"
  ) {
    return value;
  }
  throw new Error(`Component catalog field ${key} has unsupported endpoint kind: ${String(value)}`);
}

function readCategory(record: Record<string, unknown>, key: string): ComponentDependencyCategory {
  const value = record[key];
  if (
    value === "component" ||
    value === "material" ||
    value === "equipment" ||
    value === "energy" ||
    value === "logistics" ||
    value === "facility" ||
    value === "service"
  ) {
    return value;
  }
  throw new Error(`Component catalog field ${key} has unsupported dependency category: ${String(value)}`);
}

function clampTierDepth(value: number): number {
  if (!Number.isInteger(value)) throw new Error(`maxTierDepth must be an integer: ${value}`);
  return Math.min(Math.max(value, 1), 3);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
