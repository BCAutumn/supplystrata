import { readFileSync } from "node:fs";
import type { CandidateRelation } from "@supplystrata/core";

export type ComponentPatternKey = "manufacturingServices" | "foundryWafer";

export interface ComponentPatternSpec {
  readonly component: string;
  readonly componentId: string;
  readonly specificity: CandidateRelation["component_specificity"];
  readonly patternSources: readonly string[];
}

export interface CounterpartyPatternSpec {
  readonly surface: string;
  readonly patternSources: readonly string[];
}

export interface ManufacturingServiceSupplierSpec extends CounterpartyPatternSpec {
  readonly serviceComponentKey: ComponentPatternKey;
}

export interface RulePatternCatalog {
  readonly memoryComponents: readonly ComponentPatternSpec[];
  readonly productComponents: readonly ComponentPatternSpec[];
  readonly sharedComponents: Record<ComponentPatternKey, ComponentPatternSpec>;
  readonly customerCounterparties: readonly CounterpartyPatternSpec[];
  readonly supplierCounterparties: readonly CounterpartyPatternSpec[];
  readonly manufacturingServiceSuppliers: readonly ManufacturingServiceSupplierSpec[];
}

const DEFAULT_PATTERN_CATALOG_URL = new URL("../patterns/sec-official-supply-chain.json", import.meta.url);

export const RULE_PATTERN_CATALOG: RulePatternCatalog = loadRulePatternCatalog(DEFAULT_PATTERN_CATALOG_URL);

export function loadRulePatternCatalog(url: URL): RulePatternCatalog {
  const parsed: unknown = JSON.parse(readFileSync(url, "utf8"));
  return parseRulePatternCatalog(parsed, url.toString());
}

function parseRulePatternCatalog(value: unknown, path: string): RulePatternCatalog {
  const record = expectRecord(value, path);
  const shared = expectRecord(readField(record, "sharedComponents", path), `${path}.sharedComponents`);
  return {
    memoryComponents: parseComponentPatternSpecs(readField(record, "memoryComponents", path), `${path}.memoryComponents`),
    productComponents: parseComponentPatternSpecs(readField(record, "productComponents", path), `${path}.productComponents`),
    sharedComponents: {
      manufacturingServices: parseComponentPatternSpec(readField(shared, "manufacturingServices", `${path}.sharedComponents`), `${path}.sharedComponents.manufacturingServices`),
      foundryWafer: parseComponentPatternSpec(readField(shared, "foundryWafer", `${path}.sharedComponents`), `${path}.sharedComponents.foundryWafer`)
    },
    customerCounterparties: parseCounterpartyPatternSpecs(readField(record, "customerCounterparties", path), `${path}.customerCounterparties`),
    supplierCounterparties: parseCounterpartyPatternSpecs(readField(record, "supplierCounterparties", path), `${path}.supplierCounterparties`),
    manufacturingServiceSuppliers: parseManufacturingServiceSupplierSpecs(readField(record, "manufacturingServiceSuppliers", path), `${path}.manufacturingServiceSuppliers`)
  };
}

function parseComponentPatternSpecs(value: unknown, path: string): ComponentPatternSpec[] {
  return expectArray(value, path).map((item, index) => parseComponentPatternSpec(item, `${path}[${index}]`));
}

function parseComponentPatternSpec(value: unknown, path: string): ComponentPatternSpec {
  const record = expectRecord(value, path);
  return {
    component: expectString(readField(record, "component", path), `${path}.component`),
    componentId: expectString(readField(record, "componentId", path), `${path}.componentId`),
    specificity: parseSpecificity(readField(record, "specificity", path), `${path}.specificity`),
    patternSources: parsePatternSources(readField(record, "patternSources", path), `${path}.patternSources`)
  };
}

function parseCounterpartyPatternSpecs(value: unknown, path: string): CounterpartyPatternSpec[] {
  return expectArray(value, path).map((item, index) => parseCounterpartyPatternSpec(item, `${path}[${index}]`));
}

function parseCounterpartyPatternSpec(value: unknown, path: string): CounterpartyPatternSpec {
  const record = expectRecord(value, path);
  return {
    surface: expectString(readField(record, "surface", path), `${path}.surface`),
    patternSources: parsePatternSources(readField(record, "patternSources", path), `${path}.patternSources`)
  };
}

function parseManufacturingServiceSupplierSpecs(value: unknown, path: string): ManufacturingServiceSupplierSpec[] {
  return expectArray(value, path).map((item, index) => parseManufacturingServiceSupplierSpec(item, `${path}[${index}]`));
}

function parseManufacturingServiceSupplierSpec(value: unknown, path: string): ManufacturingServiceSupplierSpec {
  const record = expectRecord(value, path);
  return {
    surface: expectString(readField(record, "surface", path), `${path}.surface`),
    patternSources: parsePatternSources(readField(record, "patternSources", path), `${path}.patternSources`),
    serviceComponentKey: parseComponentPatternKey(readField(record, "serviceComponentKey", path), `${path}.serviceComponentKey`)
  };
}

function parsePatternSources(value: unknown, path: string): string[] {
  return expectArray(value, path).map((item, index) => expectString(item, `${path}[${index}]`));
}

function parseSpecificity(value: unknown, path: string): CandidateRelation["component_specificity"] {
  const text = expectString(value, path);
  if (text === "explicit" || text === "inferred" || text === "unspecified") return text;
  throw new Error(`Invalid component specificity at ${path}: ${text}`);
}

function parseComponentPatternKey(value: unknown, path: string): ComponentPatternKey {
  const text = expectString(value, path);
  if (text === "manufacturingServices" || text === "foundryWafer") return text;
  throw new Error(`Invalid component pattern key at ${path}: ${text}`);
}

function readField(record: Record<string, unknown>, key: string, path: string): unknown {
  if (!(key in record)) throw new Error(`Missing required field ${path}.${key}`);
  return record[key];
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) record[key] = field;
    return record;
  }
  throw new Error(`Expected object at ${path}`);
}

function expectArray(value: unknown, path: string): unknown[] {
  if (Array.isArray(value)) return value;
  throw new Error(`Expected array at ${path}`);
}

function expectString(value: unknown, path: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`Expected non-empty string at ${path}`);
}
