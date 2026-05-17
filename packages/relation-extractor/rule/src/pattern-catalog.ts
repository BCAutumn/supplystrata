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

export const RULE_PATTERN_CATALOG: RulePatternCatalog = {
  memoryComponents: [
    {
      component: "HBM",
      componentId: "COMP-HBM",
      specificity: "explicit",
      patternSources: ["\\b(?:hbm(?:3e?|4)?|high[-\\s]?bandwidth\\s+memory)\\b"]
    },
    {
      component: "DRAM",
      componentId: "COMP-DRAM",
      specificity: "explicit",
      patternSources: ["\\b(?:dram|dynamic\\s+random\\s+access\\s+memory)\\b"]
    },
    {
      component: "memory",
      componentId: "COMP-MEMORY",
      specificity: "unspecified",
      patternSources: ["\\bmemor(?:y|ies)\\b"]
    }
  ],
  productComponents: [
    {
      component: "GPU",
      componentId: "COMP-GPU",
      specificity: "explicit",
      patternSources: ["\\b(?:gpu|graphics processing units?|accelerators?)\\b"]
    },
    {
      component: "AI server",
      componentId: "COMP-SERVER",
      specificity: "explicit",
      patternSources: ["\\b(?:ai servers?|gpu servers?|accelerated servers?)\\b"]
    },
    {
      component: "advanced packaging",
      componentId: "COMP-ADVANCED-PACKAGING",
      specificity: "explicit",
      patternSources: ["\\b(?:advanced packaging|cowos|2\\.5d packaging)\\b"]
    },
    {
      component: "wafer",
      componentId: "COMP-WAFER",
      specificity: "explicit",
      patternSources: ["\\b(?:wafer|foundry|foundries|fabrication)\\b"]
    }
  ],
  sharedComponents: {
    manufacturingServices: {
      component: "manufacturing services",
      componentId: "COMP-MANUFACTURING-SERVICES",
      specificity: "explicit",
      patternSources: ["\\b(?:assembly|testing|packaging|contract manufactur)\\b"]
    },
    foundryWafer: {
      component: "wafer",
      componentId: "COMP-WAFER",
      specificity: "explicit",
      patternSources: ["\\b(?:wafer|foundry|foundries|fabrication)\\b"]
    }
  },
  customerCounterparties: [
    { surface: "Microsoft", patternSources: ["\\b(?:microsoft|azure)\\b"] },
    { surface: "Amazon", patternSources: ["\\b(?:amazon|amazon\\.com|aws|amazon web services)\\b"] },
    { surface: "Alphabet", patternSources: ["\\b(?:alphabet|google|google cloud|gcp)\\b"] },
    { surface: "Meta", patternSources: ["\\b(?:meta|meta platforms|facebook)\\b"] },
    { surface: "Oracle", patternSources: ["\\b(?:oracle|oci|oracle cloud)\\b"] },
    { surface: "CoreWeave", patternSources: ["\\bcoreweave\\b"] },
    { surface: "OpenAI", patternSources: ["\\bopenai\\b"] },
    { surface: "Apple", patternSources: ["\\bapple\\b"] },
    { surface: "Dell", patternSources: ["\\b(?:dell|dell technologies)\\b"] },
    { surface: "HPE", patternSources: ["\\b(?:hpe|hewlett packard enterprise)\\b"] },
    { surface: "Supermicro", patternSources: ["\\b(?:supermicro|super micro computer)\\b"] }
  ],
  supplierCounterparties: [
    { surface: "TSMC", patternSources: ["\\b(?:tsmc|taiwan semiconductor manufacturing)\\b"] },
    { surface: "Samsung", patternSources: ["\\bsamsung\\b"] },
    { surface: "SK hynix", patternSources: ["\\bsk\\s*hynix\\b"] },
    { surface: "Micron", patternSources: ["\\bmicron\\b"] },
    { surface: "Intel", patternSources: ["\\bintel\\b"] },
    { surface: "ASML", patternSources: ["\\basml\\b"] },
    { surface: "Hon Hai", patternSources: ["\\b(?:hon hai|foxconn)\\b"] },
    { surface: "Wistron", patternSources: ["\\bwistron\\b"] },
    { surface: "Fabrinet", patternSources: ["\\bfabrinet\\b"] },
    { surface: "Quanta", patternSources: ["\\bquanta\\b"] },
    { surface: "Inventec", patternSources: ["\\binventec\\b"] }
  ],
  manufacturingServiceSuppliers: [
    { surface: "Hon Hai", patternSources: ["\\b(?:hon hai|foxconn)\\b"], serviceComponentKey: "manufacturingServices" },
    { surface: "Wistron", patternSources: ["\\bwistron\\b"], serviceComponentKey: "manufacturingServices" },
    { surface: "Fabrinet", patternSources: ["\\bfabrinet\\b"], serviceComponentKey: "manufacturingServices" }
  ]
};
