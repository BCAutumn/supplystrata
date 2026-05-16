import { sentenceWindows } from "@supplystrata/parsers-text";
import type { CandidateRelation, NormalizedDocument, RelationType } from "@supplystrata/core";

export interface RelationExtractor {
  readonly id: string;
  readonly priority: number;
  readonly relation_types: RelationType[];
  extract(doc: NormalizedDocument): AsyncIterable<CandidateRelation>;
}

export const nvidiaTenKRuleExtractor: RelationExtractor = {
  id: "rule.10k.nvidia-supply-chain",
  priority: 100,
  relation_types: ["USES_FOUNDRY", "BUYS_FROM", "SUPPLIES_TO"],
  async *extract(doc) {
    if (doc.primary_entity_id !== "ENT-NVIDIA") return;
    for (const chunk of doc.chunks) {
      for (const sentence of sentenceWindows(chunk.text)) {
        for (const candidate of extractFromSentence(sentence, chunk.locator)) {
          yield candidate;
        }
      }
    }
  }
};

export const ruleExtractors = [nvidiaTenKRuleExtractor] as const;

export function extractFromSentence(sentence: string, locator: string): CandidateRelation[] {
  const candidates: CandidateRelation[] = [];
  const lower = sentence.toLowerCase();
  const manufacturingContext = /(foundr|wafer|fabricat|manufactur|supplier|subcontractor|assembly|test)/i.test(sentence);
  const foundryListContext = /(foundries?.{0,280}(tsmc|taiwan semiconductor manufacturing|samsung)|produce.{0,120}semiconductor wafers)/i.test(sentence);
  const memoryComponent = classifyMemoryComponent(sentence);
  const memoryContext = memoryComponent !== undefined;

  if ((manufacturingContext || foundryListContext) && /(tsmc|taiwan semiconductor manufacturing)/i.test(sentence)) {
    candidates.push(buildCandidate("USES_FOUNDRY", "TSMC", sentence, locator, "wafer"));
  }
  if (foundryListContext && /\bsamsung\b/i.test(sentence) && !memoryContext) {
    candidates.push(buildCandidate("USES_FOUNDRY", "Samsung", sentence, locator, "wafer"));
  }
  if (memoryComponent !== undefined && /sk\s*hynix/i.test(sentence)) {
    candidates.push(buildCandidate("BUYS_FROM", "SK hynix", sentence, locator, memoryComponent.component));
  }
  if (memoryComponent !== undefined && /\bmicron\b/i.test(sentence)) {
    candidates.push(buildCandidate("BUYS_FROM", "Micron", sentence, locator, memoryComponent.component));
  }
  if (memoryComponent !== undefined && /\bsamsung\b/i.test(sentence)) {
    candidates.push(buildCandidate("BUYS_FROM", "Samsung", sentence, locator, memoryComponent.component));
  }
  if (lower.includes("hon hai") && /(contract manufactur|manufactur|assembly|testing|packaging|subcontractor)/i.test(sentence)) {
    candidates.push(buildCandidate("BUYS_FROM", "Hon Hai", sentence, locator, "manufacturing services"));
  }
  if (lower.includes("wistron") && /(contract manufactur|manufactur|assembly|testing|packaging|subcontractor)/i.test(sentence)) {
    candidates.push(buildCandidate("BUYS_FROM", "Wistron", sentence, locator, "manufacturing services"));
  }
  if (lower.includes("fabrinet") && /(contract manufactur|manufactur|assembly|testing|packaging|subcontractor)/i.test(sentence)) {
    candidates.push(buildCandidate("BUYS_FROM", "Fabrinet", sentence, locator, "manufacturing services"));
  }

  return candidates;
}

interface MemoryComponentClassification {
  readonly component: "memory" | "DRAM" | "HBM";
  readonly specificity: "unspecified" | "explicit";
}

function classifyMemoryComponent(sentence: string): MemoryComponentClassification | undefined {
  if (/\b(?:hbm(?:3e?|4)?|high[-\s]?bandwidth\s+memory)\b/i.test(sentence)) {
    return { component: "HBM", specificity: "explicit" };
  }
  if (/\b(?:dram|dynamic\s+random\s+access\s+memory)\b/i.test(sentence)) {
    return { component: "DRAM", specificity: "explicit" };
  }
  // 普通 memory 语境只支持父组件，不能替用户推断成 HBM。
  if (/\bmemor(?:y|ies)\b/i.test(sentence)) {
    return { component: "memory", specificity: "unspecified" };
  }
  return undefined;
}

function buildCandidate(relation: RelationType, objectSurface: string, citeText: string, locator: string, component: string): CandidateRelation {
  return {
    subject_resolve: {
      surface: "NVIDIA",
      context: { nearby_text: citeText, document_type: "10-K" }
    },
    object_resolve: {
      surface: objectSurface,
      context: { nearby_text: citeText, document_type: "10-K" }
    },
    relation,
    component,
    cite_text: citeText,
    cite_locator: locator,
    extractor_id: "rule.10k.nvidia-supply-chain",
    raw_evidence_level_hint: 5,
    raw_confidence_hint: 0.92
  };
}
