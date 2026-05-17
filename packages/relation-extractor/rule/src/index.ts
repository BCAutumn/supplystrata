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
      buildCandidate(
        subjectSurface,
        documentType,
        extractorId,
        "USES_FOUNDRY",
        "TSMC",
        sentence,
        locator,
        "wafer",
        "COMP-WAFER",
        "explicit",
      ),
    );
  }
  if (foundryListContext && /\bsamsung\b/i.test(sentence) && !memoryContext) {
    candidates.push(
      buildCandidate(
        subjectSurface,
        documentType,
        extractorId,
        "USES_FOUNDRY",
        "Samsung",
        sentence,
        locator,
        "wafer",
        "COMP-WAFER",
        "explicit",
      ),
    );
  }
  if (memoryComponent !== undefined && /sk\s*hynix/i.test(sentence)) {
    candidates.push(
      buildCandidate(
        subjectSurface,
        documentType,
        extractorId,
        "BUYS_FROM",
        "SK hynix",
        sentence,
        locator,
        memoryComponent.component,
        memoryComponent.componentId,
        memoryComponent.specificity,
      ),
    );
  }
  if (memoryComponent !== undefined && /\bmicron\b/i.test(sentence)) {
    candidates.push(
      buildCandidate(
        subjectSurface,
        documentType,
        extractorId,
        "BUYS_FROM",
        "Micron",
        sentence,
        locator,
        memoryComponent.component,
        memoryComponent.componentId,
        memoryComponent.specificity,
      ),
    );
  }
  if (memoryComponent !== undefined && /\bsamsung\b/i.test(sentence)) {
    candidates.push(
      buildCandidate(
        subjectSurface,
        documentType,
        extractorId,
        "BUYS_FROM",
        "Samsung",
        sentence,
        locator,
        memoryComponent.component,
        memoryComponent.componentId,
        memoryComponent.specificity,
      ),
    );
  }
  if (
    lower.includes("hon hai") &&
    /(contract manufactur|manufactur|assembly|testing|packaging|subcontractor)/i.test(
      sentence,
    )
  ) {
    candidates.push(
      buildCandidate(
        subjectSurface,
        documentType,
        extractorId,
        "BUYS_FROM",
        "Hon Hai",
        sentence,
        locator,
        "manufacturing services",
        "COMP-MANUFACTURING-SERVICES",
        "explicit",
      ),
    );
  }
  if (
    lower.includes("wistron") &&
    /(contract manufactur|manufactur|assembly|testing|packaging|subcontractor)/i.test(
      sentence,
    )
  ) {
    candidates.push(
      buildCandidate(
        subjectSurface,
        documentType,
        extractorId,
        "BUYS_FROM",
        "Wistron",
        sentence,
        locator,
        "manufacturing services",
        "COMP-MANUFACTURING-SERVICES",
        "explicit",
      ),
    );
  }
  if (
    lower.includes("fabrinet") &&
    /(contract manufactur|manufactur|assembly|testing|packaging|subcontractor)/i.test(
      sentence,
    )
  ) {
    candidates.push(
      buildCandidate(
        subjectSurface,
        documentType,
        extractorId,
        "BUYS_FROM",
        "Fabrinet",
        sentence,
        locator,
        "manufacturing services",
        "COMP-MANUFACTURING-SERVICES",
        "explicit",
      ),
    );
  }

  return candidates;
}

interface MemoryComponentClassification {
  readonly component: "memory" | "DRAM" | "HBM";
  readonly componentId: "COMP-MEMORY" | "COMP-DRAM" | "COMP-HBM";
  readonly specificity: "unspecified" | "explicit";
}

function classifyMemoryComponent(
  sentence: string,
): MemoryComponentClassification | undefined {
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

function buildCandidate(
  subjectSurface: string,
  documentType: NormalizedDocument["document_type"],
  extractorId: string,
  relation: RelationType,
  objectSurface: string,
  citeText: string,
  locator: string,
  component: string,
  componentId?: string,
  componentSpecificity?: CandidateRelation["component_specificity"],
): CandidateRelation {
  return {
    subject_resolve: {
      surface: subjectSurface,
      context: { nearby_text: citeText, document_type: documentType },
    },
    object_resolve: {
      surface: objectSurface,
      context: { nearby_text: citeText, document_type: documentType },
    },
    relation,
    component,
    ...(componentId === undefined ? {} : { component_id: componentId }),
    ...(componentSpecificity === undefined
      ? {}
      : { component_specificity: componentSpecificity }),
    cite_text: citeText,
    cite_locator: locator,
    extractor_id: extractorId,
    raw_evidence_level_hint: 5,
    raw_confidence_hint: 0.92,
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
