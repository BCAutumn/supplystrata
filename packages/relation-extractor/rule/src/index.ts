import { sentenceWindows } from "@supplystrata/parsers-text";
import type { CandidateRelation, NormalizedDocument, RelationType } from "@supplystrata/core";
import {
  CUSTOMER_COUNTERPARTY_PATTERNS,
  FOUNDRY_WAFER_COMPONENT,
  MANUFACTURING_SERVICES_COMPONENT,
  MANUFACTURING_SERVICE_SUPPLIER_PATTERNS,
  MEMORY_COMPONENT_PATTERNS,
  PRODUCT_COMPONENT_PATTERNS,
  SUPPLIER_COUNTERPARTY_PATTERNS,
  type ComponentPatternDefinition,
  type CounterpartyPatternDefinition
} from "./patterns.js";

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
          extractorId: SEC_OFFICIAL_SUPPLY_CHAIN_EXTRACTOR_ID
        })) {
          yield candidate;
        }
      }
    }
  }
};

export const ruleExtractors = [secOfficialSupplyChainExtractor] as const;

export function extractFromSentence(sentence: string, locator: string, options: ExtractSentenceOptions = {}): CandidateRelation[] {
  const candidates: CandidateRelation[] = [];
  const manufacturingContext = /(foundr|wafer|fabricat|manufactur|supplier|subcontractor|assembly|test)/i.test(sentence);
  const foundryListContext = /(foundries?.{0,280}(tsmc|taiwan semiconductor manufacturing|samsung)|produce.{0,120}semiconductor wafers)/i.test(sentence);
  const memoryComponent = classifyMemoryComponent(sentence);
  const memoryContext = memoryComponent !== undefined;
  const subjectSurface = options.subjectSurface ?? "ENT-NVIDIA";
  const documentType = options.documentType ?? "10-K";
  const extractorId = options.extractorId ?? SEC_OFFICIAL_SUPPLY_CHAIN_EXTRACTOR_ID;

  if (
    (manufacturingContext || foundryListContext) &&
    matchesAnyCounterparty(sentence, { surface: "TSMC", patterns: [/\b(?:tsmc|taiwan semiconductor manufacturing)\b/i] })
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
        component: componentFromDefinition(FOUNDRY_WAFER_COMPONENT)
      })
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
        component: componentFromDefinition(FOUNDRY_WAFER_COMPONENT)
      })
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
        component: memoryComponent
      })
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
        component: memoryComponent
      })
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
        component: memoryComponent
      })
    );
  }
  for (const supplier of MANUFACTURING_SERVICE_SUPPLIER_PATTERNS) {
    if (matchesAnyCounterparty(sentence, supplier) && /(contract manufactur|manufactur|assembly|testing|packaging|subcontractor)/i.test(sentence)) {
      candidates.push(
        buildCandidate({
          subjectSurface,
          documentType,
          extractorId,
          relation: "BUYS_FROM",
          objectSurface: supplier.surface,
          citeText: sentence,
          locator,
          component: componentFromDefinition(supplier.serviceComponent)
        })
      );
    }
  }
  for (const counterparty of CUSTOMER_COUNTERPARTY_PATTERNS) {
    if (matchesAnyCounterparty(sentence, counterparty) && isNamedCustomerDisclosure(sentence)) {
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
          confidenceHint: 0.9
        })
      );
    }
  }
  for (const counterparty of SUPPLIER_COUNTERPARTY_PATTERNS) {
    if (!matchesAnyCounterparty(sentence, counterparty)) continue;
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
          ...(commitmentComponent === undefined ? {} : { component: commitmentComponent }),
          confidenceHint: 0.89
        })
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
          ...(commitmentComponent === undefined ? {} : { component: commitmentComponent }),
          confidenceHint: 0.86
        })
      );
    }
  }

  return uniqueCandidates(candidates);
}

function classifyMemoryComponent(sentence: string): ComponentClassification | undefined {
  return classifyComponent(sentence, MEMORY_COMPONENT_PATTERNS);
}

function classifyProductComponent(sentence: string): ComponentClassification | undefined {
  const memory = classifyMemoryComponent(sentence);
  if (memory !== undefined) return memory;
  return classifyComponent(sentence, PRODUCT_COMPONENT_PATTERNS);
}

function classifySupplyCommitmentComponent(sentence: string): ComponentClassification | undefined {
  const product = classifyProductComponent(sentence);
  if (product !== undefined) return product;
  if (MANUFACTURING_SERVICES_COMPONENT.patterns.some((pattern) => pattern.test(sentence))) {
    return componentFromDefinition(MANUFACTURING_SERVICES_COMPONENT);
  }
  return undefined;
}

function classifyComponent(sentence: string, definitions: readonly ComponentPatternDefinition[]): ComponentClassification | undefined {
  const definition = definitions.find((item) => item.patterns.some((pattern) => pattern.test(sentence)));
  return definition === undefined ? undefined : componentFromDefinition(definition);
}

function componentFromDefinition(definition: ComponentPatternDefinition): ComponentClassification {
  return {
    component: definition.component,
    componentId: definition.componentId,
    specificity: definition.specificity
  };
}

function matchesAnyCounterparty(sentence: string, counterparty: CounterpartyPatternDefinition): boolean {
  return counterparty.patterns.some((pattern) => pattern.test(sentence));
}

function isNamedCustomerDisclosure(sentence: string): boolean {
  if (/\b(?:accounted for|represented|contributed|comprised).{0,120}\b(?:revenue|net sales|sales)\b/i.test(sentence)) {
    return true;
  }
  return /\b(?:sales to|net sales to|revenue from|derive revenue from|derived revenue from)\b/i.test(sentence);
}

function uniqueCandidates(candidates: readonly CandidateRelation[]): CandidateRelation[] {
  const seen = new Set<string>();
  const unique: CandidateRelation[] = [];
  for (const candidate of candidates) {
    const key = [
      candidate.subject_resolve.surface,
      candidate.relation,
      candidate.object_resolve.surface,
      candidate.component_id ?? candidate.component ?? "",
      candidate.cite_text
    ].join("\u0001");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

function isPurchaseObligationDisclosure(sentence: string): boolean {
  return /\b(?:purchase obligations?|purchase commitments?|long[-\s]?term supply agreements?|wafer supply agreements?|capacity reservations?|prepayments?|take[-\s]?or[-\s]?pay)\b/i.test(
    sentence
  );
}

function isSingleSourceSupplierDisclosure(sentence: string): boolean {
  return /\b(?:sole source|single source|single-source|sole supplier|limited number of suppliers|limited suppliers)\b/i.test(sentence);
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
        document_type: input.documentType
      }
    },
    object_resolve: {
      surface: input.objectSurface,
      context: {
        nearby_text: input.citeText,
        document_type: input.documentType
      }
    },
    relation: input.relation,
    ...(input.component === undefined ? {} : { component: input.component.component }),
    ...(input.component?.componentId === undefined ? {} : { component_id: input.component.componentId }),
    ...(input.component?.specificity === undefined ? {} : { component_specificity: input.component.specificity }),
    cite_text: input.citeText,
    cite_locator: input.locator,
    extractor_id: input.extractorId,
    raw_evidence_level_hint: 5,
    raw_confidence_hint: input.confidenceHint ?? 0.92
  };
}

function isSecDisclosure(doc: NormalizedDocument): boolean {
  return isSecSourceAdapter(doc.source_adapter_id) && ["10-K", "10-Q", "8-K"].includes(doc.document_type);
}

function isSecSourceAdapter(sourceAdapterId: string): boolean {
  // sec-edgar-fixture 是离线测试镜像，业务规则仍按 sec-edgar 官方披露处理。
  return sourceAdapterId === "sec-edgar" || sourceAdapterId === "sec-edgar-fixture";
}
