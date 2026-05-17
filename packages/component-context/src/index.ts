import { readFileSync } from "node:fs";
import type { ChainEndpointKind } from "@supplystrata/core";

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

const CATALOG_URL = new URL("../patterns/upstream-dependencies.json", import.meta.url);

let cachedCatalog: ComponentUpstreamLead[] | undefined;

export function listComponentUpstreamLeads(componentId: string, maxTierDepth = 2): ComponentUpstreamLead[] {
  const normalizedDepth = clampTierDepth(maxTierDepth);
  return loadCatalog()
    .filter((entry) => entry.parent_component_id === componentId && entry.tier_depth <= normalizedDepth)
    .sort((left, right) => left.tier_depth - right.tier_depth || left.target_name.localeCompare(right.target_name));
}

export function listKnownComponentContextIds(): string[] {
  return [...new Set(loadCatalog().flatMap((entry) => [entry.parent_component_id, entry.target_id]))].sort();
}

function loadCatalog(): ComponentUpstreamLead[] {
  if (cachedCatalog !== undefined) return cachedCatalog;
  const parsed: unknown = JSON.parse(readFileSync(CATALOG_URL, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Component upstream dependency catalog must be a JSON array");
  cachedCatalog = parsed.map(parseCatalogEntry);
  return cachedCatalog;
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

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`Component catalog field ${key} must be a non-empty string`);
  return value;
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
