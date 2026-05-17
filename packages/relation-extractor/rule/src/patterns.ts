import type { CandidateRelation } from "@supplystrata/core";
import { RULE_PATTERN_CATALOG, type ComponentPatternSpec, type CounterpartyPatternSpec, type ManufacturingServiceSupplierSpec } from "./pattern-catalog.js";

export interface ComponentPatternDefinition {
  readonly component: string;
  readonly componentId: string;
  readonly specificity: CandidateRelation["component_specificity"];
  readonly patterns: readonly RegExp[];
}

export interface CounterpartyPatternDefinition {
  readonly surface: string;
  readonly patterns: readonly RegExp[];
}

export interface ManufacturingServiceSupplierDefinition extends CounterpartyPatternDefinition {
  readonly serviceComponent: ComponentPatternDefinition;
}

export const MEMORY_COMPONENT_PATTERNS: readonly ComponentPatternDefinition[] = RULE_PATTERN_CATALOG.memoryComponents.map(compileComponentPattern);

export const PRODUCT_COMPONENT_PATTERNS: readonly ComponentPatternDefinition[] = RULE_PATTERN_CATALOG.productComponents.map(compileComponentPattern);

export const MANUFACTURING_SERVICES_COMPONENT: ComponentPatternDefinition = compileComponentPattern(
  RULE_PATTERN_CATALOG.sharedComponents.manufacturingServices
);

export const FOUNDRY_WAFER_COMPONENT: ComponentPatternDefinition = compileComponentPattern(RULE_PATTERN_CATALOG.sharedComponents.foundryWafer);

export const CUSTOMER_COUNTERPARTY_PATTERNS: readonly CounterpartyPatternDefinition[] =
  RULE_PATTERN_CATALOG.customerCounterparties.map(compileCounterpartyPattern);

export const SUPPLIER_COUNTERPARTY_PATTERNS: readonly CounterpartyPatternDefinition[] =
  RULE_PATTERN_CATALOG.supplierCounterparties.map(compileCounterpartyPattern);

export const MANUFACTURING_SERVICE_SUPPLIER_PATTERNS: readonly ManufacturingServiceSupplierDefinition[] =
  RULE_PATTERN_CATALOG.manufacturingServiceSuppliers.map(compileManufacturingServiceSupplier);

function compileComponentPattern(spec: ComponentPatternSpec): ComponentPatternDefinition {
  return {
    component: spec.component,
    componentId: spec.componentId,
    specificity: spec.specificity,
    patterns: compileRegexes(spec.patternSources)
  };
}

function compileCounterpartyPattern(spec: CounterpartyPatternSpec): CounterpartyPatternDefinition {
  return {
    surface: spec.surface,
    patterns: compileRegexes(spec.patternSources)
  };
}

function compileManufacturingServiceSupplier(spec: ManufacturingServiceSupplierSpec): ManufacturingServiceSupplierDefinition {
  return {
    ...compileCounterpartyPattern(spec),
    serviceComponent: compileComponentPattern(RULE_PATTERN_CATALOG.sharedComponents[spec.serviceComponentKey])
  };
}

function compileRegexes(patternSources: readonly string[]): RegExp[] {
  return patternSources.map((source) => new RegExp(source, "i"));
}
