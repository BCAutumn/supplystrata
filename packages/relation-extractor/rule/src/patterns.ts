import type { CandidateRelation } from "@supplystrata/core";

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

export const MEMORY_COMPONENT_PATTERNS: readonly ComponentPatternDefinition[] = [
  {
    component: "HBM",
    componentId: "COMP-HBM",
    specificity: "explicit",
    patterns: [/\b(?:hbm(?:3e?|4)?|high[-\s]?bandwidth\s+memory)\b/i]
  },
  {
    component: "DRAM",
    componentId: "COMP-DRAM",
    specificity: "explicit",
    patterns: [/\b(?:dram|dynamic\s+random\s+access\s+memory)\b/i]
  },
  {
    component: "memory",
    componentId: "COMP-MEMORY",
    specificity: "unspecified",
    // 普通 memory 只落到父组件，避免把未明说的内存关系升级成 HBM。
    patterns: [/\bmemor(?:y|ies)\b/i]
  }
];

export const PRODUCT_COMPONENT_PATTERNS: readonly ComponentPatternDefinition[] = [
  {
    component: "GPU",
    componentId: "COMP-GPU",
    specificity: "explicit",
    patterns: [/\b(?:gpu|graphics processing units?|accelerators?)\b/i]
  },
  {
    component: "AI server",
    componentId: "COMP-SERVER",
    specificity: "explicit",
    patterns: [/\b(?:ai servers?|gpu servers?|accelerated servers?)\b/i]
  },
  {
    component: "advanced packaging",
    componentId: "COMP-ADVANCED-PACKAGING",
    specificity: "explicit",
    patterns: [/\b(?:advanced packaging|cowos|2\.5d packaging)\b/i]
  },
  {
    component: "wafer",
    componentId: "COMP-WAFER",
    specificity: "explicit",
    patterns: [/\b(?:wafer|foundry|foundries|fabrication)\b/i]
  }
];

export const MANUFACTURING_SERVICES_COMPONENT: ComponentPatternDefinition = {
  component: "manufacturing services",
  componentId: "COMP-MANUFACTURING-SERVICES",
  specificity: "explicit",
  patterns: [/\b(?:assembly|testing|packaging|contract manufactur)\b/i]
};

export const FOUNDRY_WAFER_COMPONENT: ComponentPatternDefinition = {
  component: "wafer",
  componentId: "COMP-WAFER",
  specificity: "explicit",
  patterns: [/\b(?:wafer|foundry|foundries|fabrication)\b/i]
};

export const CUSTOMER_COUNTERPARTY_PATTERNS: readonly CounterpartyPatternDefinition[] = [
  { surface: "Microsoft", patterns: [/\b(?:microsoft|azure)\b/i] },
  { surface: "Amazon", patterns: [/\b(?:amazon|amazon\.com|aws|amazon web services)\b/i] },
  { surface: "Alphabet", patterns: [/\b(?:alphabet|google|google cloud|gcp)\b/i] },
  { surface: "Meta", patterns: [/\b(?:meta|meta platforms|facebook)\b/i] },
  { surface: "Oracle", patterns: [/\b(?:oracle|oci|oracle cloud)\b/i] },
  { surface: "CoreWeave", patterns: [/\bcoreweave\b/i] },
  { surface: "OpenAI", patterns: [/\bopenai\b/i] },
  { surface: "Apple", patterns: [/\bapple\b/i] },
  { surface: "Dell", patterns: [/\b(?:dell|dell technologies)\b/i] },
  { surface: "HPE", patterns: [/\b(?:hpe|hewlett packard enterprise)\b/i] },
  { surface: "Supermicro", patterns: [/\b(?:supermicro|super micro computer)\b/i] }
];

export const SUPPLIER_COUNTERPARTY_PATTERNS: readonly CounterpartyPatternDefinition[] = [
  { surface: "TSMC", patterns: [/\b(?:tsmc|taiwan semiconductor manufacturing)\b/i] },
  { surface: "Samsung", patterns: [/\bsamsung\b/i] },
  { surface: "SK hynix", patterns: [/\bsk\s*hynix\b/i] },
  { surface: "Micron", patterns: [/\bmicron\b/i] },
  { surface: "Intel", patterns: [/\bintel\b/i] },
  { surface: "ASML", patterns: [/\basml\b/i] },
  { surface: "Hon Hai", patterns: [/\b(?:hon hai|foxconn)\b/i] },
  { surface: "Wistron", patterns: [/\bwistron\b/i] },
  { surface: "Fabrinet", patterns: [/\bfabrinet\b/i] },
  { surface: "Quanta", patterns: [/\bquanta\b/i] },
  { surface: "Inventec", patterns: [/\binventec\b/i] }
];

export const MANUFACTURING_SERVICE_SUPPLIER_PATTERNS: readonly ManufacturingServiceSupplierDefinition[] = [
  { surface: "Hon Hai", patterns: [/\b(?:hon hai|foxconn)\b/i], serviceComponent: MANUFACTURING_SERVICES_COMPONENT },
  { surface: "Wistron", patterns: [/\bwistron\b/i], serviceComponent: MANUFACTURING_SERVICES_COMPONENT },
  { surface: "Fabrinet", patterns: [/\bfabrinet\b/i], serviceComponent: MANUFACTURING_SERVICES_COMPONENT }
];
