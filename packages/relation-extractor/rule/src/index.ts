import { sentenceWindows } from "@supplystrata/parsers-text";
import type {
  CandidateRelation,
  NormalizedDocument,
  RelationType,
} from "@supplystrata/core";

export interface RelationExtractor {
  readonly id: string;
  readonly priority: number;
  readonly relation_types: RelationType[];
  extract(doc: NormalizedDocument): AsyncIterable<CandidateRelation>;
}

const SEC_OFFICIAL_SUPPLY_CHAIN_EXTRACTOR_ID = "rule.sec.official-supply-chain";

interface ExtractSentenceOptions {
  readonly subjectSurface?: string;
  readonly documentType?: NormalizedDocument["document_type"];
  readonly extractorId?: string;
}

interface ComponentClassification {
  readonly component: string;
  readonly componentId?: string;
  readonly specificity: CandidateRelation["component_specificity"];
}

interface CounterpartyPattern {
  readonly surface: string;
  readonly pattern: RegExp;
}

const CUSTOMER_COUNTERPARTIES: readonly CounterpartyPattern[] = [
  { surface: "Microsoft", pattern: /\b(?:microsoft|azure)\b/i },
  {
    surface: "Amazon",
    pattern: /\b(?:amazon|amazon\.com|aws|amazon web services)\b/i,
  },
  { surface: "Alphabet", pattern: /\b(?:alphabet|google|google cloud|gcp)\b/i },
  { surface: "Meta", pattern: /\b(?:meta|meta platforms|facebook)\b/i },
  { surface: "Oracle", pattern: /\b(?:oracle|oci|oracle cloud)\b/i },
  { surface: "CoreWeave", pattern: /\bcoreweave\b/i },
  { surface: "OpenAI", pattern: /\bopenai\b/i },
  { surface: "Apple", pattern: /\bapple\b/i },
  { surface: "Dell", pattern: /\b(?:dell|dell technologies)\b/i },
  { surface: "HPE", pattern: /\b(?:hpe|hewlett packard enterprise)\b/i },
  {
    surface: "Supermicro",
    pattern: /\b(?:supermicro|super micro computer)\b/i,
  },
];

const SUPPLIER_COUNTERPARTIES: readonly CounterpartyPattern[] = [
  {
    surface: "TSMC",
    pattern: /\b(?:tsmc|taiwan semiconductor manufacturing)\b/i,
  },
  { surface: "Samsung", pattern: /\bsamsung\b/i },
  { surface: "SK hynix", pattern: /\bsk\s*hynix\b/i },
  { surface: "Micron", pattern: /\bmicron\b/i },
  { surface: "Intel", pattern: /\bintel\b/i },
  { surface: "ASML", pattern: /\basml\b/i },
  { surface: "Hon Hai", pattern: /\b(?:hon hai|foxconn)\b/i },
  { surface: "Wistron", pattern: /\bwistron\b/i },
  { surface: "Fabrinet", pattern: /\bfabrinet\b/i },
  { surface: "Quanta", pattern: /\bquanta\b/i },
  { surface: "Inventec", pattern: /\binventec\b/i },
];

export const secOfficialSupplyChainExtractor: RelationExtractor = {
  id: SEC_OFFICIAL_SUPPLY_CHAIN_EXTRACTOR_ID,
  priority: 100,
  relation_types: ["USES_FOUNDRY", "BUYS_FROM", "SUPPLIES_TO"],
  async *extract(doc) {
    if (!isSecDisclosure(doc)) return;
    if (doc.primary_entity_id === undefined) return;
    for (const chunk of doc.chunks) {
      for (const sentence of sentenceWindows(chunk.text)) {
        for (const candidate of extractFromSentence(sentence, chunk.locator, {
          subjectSurface: doc.primary_entity_id,
          documentType: doc.document_type,
          extractorId: SEC_OFFICIAL_SUPPLY_CHAIN_EXTRACTOR_ID,
        })) {
          yield candidate;
        }
      }
    }
  },
};

export const ruleExtractors = [secOfficialSupplyChainExtractor] as const;

export function extractFromSentence(
  sentence: string,
  locator: string,
  options: ExtractSentenceOptions = {},
): CandidateRelation[] {
  const candidates: CandidateRelation[] = [];
  const lower = sentence.toLowerCase();
  const manufacturingContext =
    /(foundr|wafer|fabricat|manufactur|supplier|subcontractor|assembly|test)/i.test(
      sentence,
    );
  const foundryListContext =
    /(foundries?.{0,280}(tsmc|taiwan semiconductor manufacturing|samsung)|produce.{0,120}semiconductor wafers)/i.test(
      sentence,
    );
  const memoryComponent = classifyMemoryComponent(sentence);
  const memoryContext = memoryComponent !== undefined;
  const subjectSurface = options.subjectSurface ?? "ENT-NVIDIA";
  const documentType = options.documentType ?? "10-K";
  const extractorId =
    options.extractorId ?? SEC_OFFICIAL_SUPPLY_CHAIN_EXTRACTOR_ID;

  if (
    (manufacturingContext || foundryListContext) &&
    /(tsmc|taiwan semiconductor manufacturing)/i.test(sentence)
  ) {
    candidates.push(
      buildCandidate({
        subjectSurface,
        documentType,
        extractorId,
        relation: "USES_FOUNDRY",
        objectSurface: "TSMC",
        citeText: sentence,
        locator,
        component: {
          component: "wafer",
          componentId: "COMP-WAFER",
          specificity: "explicit",
        },
      }),
    );
  }
  if (foundryListContext && /\bsamsung\b/i.test(sentence) && !memoryContext) {
    candidates.push(
      buildCandidate({
        subjectSurface,
        documentType,
        extractorId,
        relation: "USES_FOUNDRY",
        objectSurface: "Samsung",
        citeText: sentence,
        locator,
        component: {
          component: "wafer",
          componentId: "COMP-WAFER",
          specificity: "explicit",
        },
      }),
    );
  }
  if (memoryComponent !== undefined && /sk\s*hynix/i.test(sentence)) {
    candidates.push(
      buildCandidate({
        subjectSurface,
        documentType,
        extractorId,
        relation: "BUYS_FROM",
        objectSurface: "SK hynix",
        citeText: sentence,
        locator,
        component: memoryComponent,
      }),
    );
  }
  if (memoryComponent !== undefined && /\bmicron\b/i.test(sentence)) {
    candidates.push(
      buildCandidate({
        subjectSurface,
        documentType,
        extractorId,
        relation: "BUYS_FROM",
        objectSurface: "Micron",
        citeText: sentence,
        locator,
        component: memoryComponent,
      }),
    );
  }
  if (memoryComponent !== undefined && /\bsamsung\b/i.test(sentence)) {
    candidates.push(
      buildCandidate({
        subjectSurface,
        documentType,
        extractorId,
        relation: "BUYS_FROM",
        objectSurface: "Samsung",
        citeText: sentence,
        locator,
        component: memoryComponent,
      }),
    );
  }
  if (
    lower.includes("hon hai") &&
    /(contract manufactur|manufactur|assembly|testing|packaging|subcontractor)/i.test(
      sentence,
    )
  ) {
    candidates.push(
      buildCandidate({
        subjectSurface,
        documentType,
        extractorId,
        relation: "BUYS_FROM",
        objectSurface: "Hon Hai",
        citeText: sentence,
        locator,
        component: {
          component: "manufacturing services",
          componentId: "COMP-MANUFACTURING-SERVICES",
          specificity: "explicit",
        },
      }),
    );
  }
  if (
    lower.includes("wistron") &&
    /(contract manufactur|manufactur|assembly|testing|packaging|subcontractor)/i.test(
      sentence,
    )
  ) {
    candidates.push(
      buildCandidate({
        subjectSurface,
        documentType,
        extractorId,
        relation: "BUYS_FROM",
        objectSurface: "Wistron",
        citeText: sentence,
        locator,
        component: {
          component: "manufacturing services",
          componentId: "COMP-MANUFACTURING-SERVICES",
          specificity: "explicit",
        },
      }),
    );
  }
  if (
    lower.includes("fabrinet") &&
    /(contract manufactur|manufactur|assembly|testing|packaging|subcontractor)/i.test(
      sentence,
    )
  ) {
    candidates.push(
      buildCandidate({
        subjectSurface,
        documentType,
        extractorId,
        relation: "BUYS_FROM",
        objectSurface: "Fabrinet",
        citeText: sentence,
        locator,
        component: {
          component: "manufacturing services",
          componentId: "COMP-MANUFACTURING-SERVICES",
          specificity: "explicit",
        },
      }),
    );
  }
  for (const counterparty of CUSTOMER_COUNTERPARTIES) {
    if (
      counterparty.pattern.test(sentence) &&
      isNamedCustomerDisclosure(sentence)
    ) {
      const component = classifyProductComponent(sentence);
      candidates.push(
        buildCandidate({
          subjectSurface,
          documentType,
          extractorId,
          relation: "SUPPLIES_TO",
          objectSurface: counterparty.surface,
          citeText: sentence,
          locator,
          ...(component === undefined ? {} : { component }),
          confidenceHint: 0.9,
        }),
      );
    }
  }
  for (const counterparty of SUPPLIER_COUNTERPARTIES) {
    if (!counterparty.pattern.test(sentence)) continue;
    const commitmentComponent = classifySupplyCommitmentComponent(sentence);
    if (isPurchaseObligationDisclosure(sentence)) {
      candidates.push(
        buildCandidate({
          subjectSurface,
          documentType,
          extractorId,
          relation: "BUYS_FROM",
          objectSurface: counterparty.surface,
          citeText: sentence,
          locator,
          ...(commitmentComponent === undefined
            ? {}
            : { component: commitmentComponent }),
          confidenceHint: 0.89,
        }),
      );
      continue;
    }
    if (isSingleSourceSupplierDisclosure(sentence)) {
      candidates.push(
        buildCandidate({
          subjectSurface,
          documentType,
          extractorId,
          relation: "BUYS_FROM",
          objectSurface: counterparty.surface,
          citeText: sentence,
          locator,
          ...(commitmentComponent === undefined
            ? {}
            : { component: commitmentComponent }),
          confidenceHint: 0.86,
        }),
      );
    }
  }

  return uniqueCandidates(candidates);
}

function classifyMemoryComponent(
  sentence: string,
): ComponentClassification | undefined {
  if (/\b(?:hbm(?:3e?|4)?|high[-\s]?bandwidth\s+memory)\b/i.test(sentence)) {
    return {
      component: "HBM",
      componentId: "COMP-HBM",
      specificity: "explicit",
    };
  }
  if (/\b(?:dram|dynamic\s+random\s+access\s+memory)\b/i.test(sentence)) {
    return {
      component: "DRAM",
      componentId: "COMP-DRAM",
      specificity: "explicit",
    };
  }
  // 普通 memory 语境只支持父组件，不能替用户推断成 HBM。
  if (/\bmemor(?:y|ies)\b/i.test(sentence)) {
    return {
      component: "memory",
      componentId: "COMP-MEMORY",
      specificity: "unspecified",
    };
  }
  return undefined;
}

function classifyProductComponent(
  sentence: string,
): ComponentClassification | undefined {
  const memory = classifyMemoryComponent(sentence);
  if (memory !== undefined) return memory;
  if (/\b(?:gpu|graphics processing units?|accelerators?)\b/i.test(sentence)) {
    return {
      component: "GPU",
      componentId: "COMP-GPU",
      specificity: "explicit",
    };
  }
  if (/\b(?:ai servers?|gpu servers?|accelerated servers?)\b/i.test(sentence)) {
    return {
      component: "AI server",
      componentId: "COMP-SERVER",
      specificity: "explicit",
    };
  }
  if (/\b(?:advanced packaging|cowos|2\.5d packaging)\b/i.test(sentence)) {
    return {
      component: "advanced packaging",
      componentId: "COMP-ADVANCED-PACKAGING",
      specificity: "explicit",
    };
  }
  if (/\b(?:wafer|foundry|foundries|fabrication)\b/i.test(sentence)) {
    return {
      component: "wafer",
      componentId: "COMP-WAFER",
      specificity: "explicit",
    };
  }
  return undefined;
}

function classifySupplyCommitmentComponent(
  sentence: string,
): ComponentClassification | undefined {
  const product = classifyProductComponent(sentence);
  if (product !== undefined) return product;
  if (
    /\b(?:assembly|testing|packaging|contract manufactur)\b/i.test(sentence)
  ) {
    return {
      component: "manufacturing services",
      componentId: "COMP-MANUFACTURING-SERVICES",
      specificity: "explicit",
    };
  }
  return undefined;
}

function isNamedCustomerDisclosure(sentence: string): boolean {
  if (
    /\b(?:accounted for|represented|contributed|comprised).{0,120}\b(?:revenue|net sales|sales)\b/i.test(
      sentence,
    )
  ) {
    return true;
  }
  return /\b(?:sales to|net sales to|revenue from|derive revenue from|derived revenue from)\b/i.test(
    sentence,
  );
}

function uniqueCandidates(
  candidates: readonly CandidateRelation[],
): CandidateRelation[] {
  const seen = new Set<string>();
  const unique: CandidateRelation[] = [];
  for (const candidate of candidates) {
    const key = [
      candidate.subject_resolve.surface,
      candidate.relation,
      candidate.object_resolve.surface,
      candidate.component_id ?? candidate.component ?? "",
      candidate.cite_text,
    ].join("\u0001");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

function isPurchaseObligationDisclosure(sentence: string): boolean {
  return /\b(?:purchase obligations?|purchase commitments?|long[-\s]?term supply agreements?|wafer supply agreements?|capacity reservations?|prepayments?|take[-\s]?or[-\s]?pay)\b/i.test(
    sentence,
  );
}

function isSingleSourceSupplierDisclosure(sentence: string): boolean {
  return /\b(?:sole source|single source|single-source|sole supplier|limited number of suppliers|limited suppliers)\b/i.test(
    sentence,
  );
}

interface CandidateBuildInput {
  readonly subjectSurface: string;
  readonly documentType: NormalizedDocument["document_type"];
  readonly extractorId: string;
  readonly relation: RelationType;
  readonly objectSurface: string;
  readonly citeText: string;
  readonly locator: string;
  readonly component?: ComponentClassification;
  readonly confidenceHint?: number;
}

function buildCandidate(input: CandidateBuildInput): CandidateRelation {
  return {
    subject_resolve: {
      surface: input.subjectSurface,
      context: {
        nearby_text: input.citeText,
        document_type: input.documentType,
      },
    },
    object_resolve: {
      surface: input.objectSurface,
      context: {
        nearby_text: input.citeText,
        document_type: input.documentType,
      },
    },
    relation: input.relation,
    ...(input.component === undefined
      ? {}
      : { component: input.component.component }),
    ...(input.component?.componentId === undefined
      ? {}
      : { component_id: input.component.componentId }),
    ...(input.component?.specificity === undefined
      ? {}
      : { component_specificity: input.component.specificity }),
    cite_text: input.citeText,
    cite_locator: input.locator,
    extractor_id: input.extractorId,
    raw_evidence_level_hint: 5,
    raw_confidence_hint: input.confidenceHint ?? 0.92,
  };
}

function isSecDisclosure(doc: NormalizedDocument): boolean {
  return (
    isSecSourceAdapter(doc.source_adapter_id) &&
    ["10-K", "10-Q", "8-K"].includes(doc.document_type)
  );
}

function isSecSourceAdapter(sourceAdapterId: string): boolean {
  // sec-edgar-fixture 是离线测试镜像，业务规则仍按 sec-edgar 官方披露处理。
  return (
    sourceAdapterId === "sec-edgar" || sourceAdapterId === "sec-edgar-fixture"
  );
}
