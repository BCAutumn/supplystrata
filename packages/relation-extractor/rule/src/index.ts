import { sentenceWindowsWithOffsets } from "@supplystrata/parsers-text";
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
import { EN_RELATION_CONTEXT_PROFILE, selectRelationContextProfile, type RelationContextProfile } from "./relation-contexts.js";

export {
  EN_RELATION_CONTEXT_PROFILE,
  JA_RELATION_CONTEXT_PROFILE,
  ZH_RELATION_CONTEXT_PROFILE,
  KO_RELATION_CONTEXT_PROFILE,
  selectRelationContextProfile
} from "./relation-contexts.js";
export type { RelationContextProfile } from "./relation-contexts.js";

export interface RelationExtractor {
  readonly id: string;
  readonly priority: number;
  readonly relation_types: RelationType[];
  extract(doc: NormalizedDocument): AsyncIterable<CandidateRelation>;
}

const SEC_OFFICIAL_SUPPLY_CHAIN_EXTRACTOR_ID = "rule.sec.official-supply-chain";

interface ExtractSentenceOptions {
  readonly subjectSurface: string;
  readonly documentType?: NormalizedDocument["document_type"];
  readonly extractorId?: string;
  readonly sourceLocation?: CandidateRelation["source_location"];
  readonly profile?: RelationContextProfile;
}

interface ComponentClassification {
  readonly component: string;
  readonly componentId?: string;
  readonly specificity: CandidateRelation["component_specificity"];
}

interface FoundrySupplierRule {
  readonly counterparty: CounterpartyPatternDefinition;
  readonly requiresFoundryListContext: boolean;
  readonly skipWhenMemoryContext: boolean;
}

const FOUNDRY_SUPPLIER_RULES: readonly FoundrySupplierRule[] = [
  {
    counterparty: requireSupplierCounterpartyPattern("TSMC"),
    requiresFoundryListContext: false,
    skipWhenMemoryContext: false
  },
  {
    counterparty: requireSupplierCounterpartyPattern("Samsung"),
    requiresFoundryListContext: true,
    skipWhenMemoryContext: true
  }
];

const MEMORY_SUPPLIER_RULES: readonly CounterpartyPatternDefinition[] = [
  requireSupplierCounterpartyPattern("SK hynix"),
  requireSupplierCounterpartyPattern("Micron"),
  requireSupplierCounterpartyPattern("Samsung")
];

export const secOfficialSupplyChainExtractor: RelationExtractor = {
  id: SEC_OFFICIAL_SUPPLY_CHAIN_EXTRACTOR_ID,
  priority: 100,
  relation_types: ["USES_FOUNDRY", "BUYS_FROM", "SUPPLIES_TO"],
  async *extract(doc) {
    if (!isOfficialDisclosureProse(doc)) return;
    if (doc.primary_entity_id === undefined) return;
    const profile = selectRelationContextProfile(doc.language);
    for (const chunk of doc.chunks) {
      for (const window of sentenceWindowsWithOffsets(chunk.text)) {
        for (const candidate of extractFromSentence(window.sentence, chunk.locator, {
          subjectSurface: doc.primary_entity_id,
          documentType: doc.document_type,
          extractorId: SEC_OFFICIAL_SUPPLY_CHAIN_EXTRACTOR_ID,
          profile,
          sourceLocation: {
            chunk_id: chunk.chunk_id,
            chunk_locator: chunk.locator,
            cite_start_char: window.start,
            cite_end_char: window.end
          }
        })) {
          yield candidate;
        }
      }
    }
  }
};

export const ruleExtractors = [secOfficialSupplyChainExtractor] as const;

export function extractFromSentence(sentence: string, locator: string, options: ExtractSentenceOptions): CandidateRelation[] {
  const candidates: CandidateRelation[] = [];
  const profile = options.profile ?? EN_RELATION_CONTEXT_PROFILE;
  const manufacturingContext = matchesAnyPattern(sentence, profile.manufacturingContext);
  const foundryListContext = matchesAnyPattern(sentence, profile.foundryListContext);
  const memoryComponent = classifyMemoryComponent(sentence);
  const memoryContext = memoryComponent !== undefined;
  const subjectSurface = options.subjectSurface;
  const documentType = options.documentType ?? "10-K";
  const extractorId = options.extractorId ?? SEC_OFFICIAL_SUPPLY_CHAIN_EXTRACTOR_ID;
  const sourceLocation = options.sourceLocation;
  const sourceLocationInput = sourceLocation === undefined ? {} : { sourceLocation };

  for (const rule of FOUNDRY_SUPPLIER_RULES) {
    if (!matchesFoundrySupplierRule(sentence, rule, { manufacturingContext, foundryListContext, memoryContext })) continue;
    candidates.push(
      buildCandidate({
        subjectSurface,
        documentType,
        extractorId,
        relation: "USES_FOUNDRY",
        objectSurface: rule.counterparty.surface,
        citeText: sentence,
        locator,
        ...sourceLocationInput,
        component: componentFromDefinition(FOUNDRY_WAFER_COMPONENT)
      })
    );
  }
  if (memoryComponent !== undefined) {
    for (const counterparty of MEMORY_SUPPLIER_RULES) {
      if (!matchesAnyCounterparty(sentence, counterparty)) continue;
      candidates.push(
        buildCandidate({
          subjectSurface,
          documentType,
          extractorId,
          relation: "BUYS_FROM",
          objectSurface: counterparty.surface,
          citeText: sentence,
          locator,
          ...sourceLocationInput,
          component: memoryComponent
        })
      );
    }
  }
  for (const supplier of MANUFACTURING_SERVICE_SUPPLIER_PATTERNS) {
    if (matchesAnyCounterparty(sentence, supplier) && matchesAnyPattern(sentence, profile.manufacturingServiceContext)) {
      candidates.push(
        buildCandidate({
          subjectSurface,
          documentType,
          extractorId,
          relation: "BUYS_FROM",
          objectSurface: supplier.surface,
          citeText: sentence,
          locator,
          ...sourceLocationInput,
          component: componentFromDefinition(supplier.serviceComponent)
        })
      );
    }
  }
  for (const counterparty of CUSTOMER_COUNTERPARTY_PATTERNS) {
    if (matchesAnyCounterparty(sentence, counterparty) && matchesAnyPattern(sentence, profile.namedCustomer)) {
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
          ...sourceLocationInput,
          ...(component === undefined ? {} : { component }),
          confidenceHint: 0.9
        })
      );
    }
  }
  for (const counterparty of SUPPLIER_COUNTERPARTY_PATTERNS) {
    if (!matchesAnyCounterparty(sentence, counterparty)) continue;
    const commitmentComponent = classifySupplyCommitmentComponent(sentence);
    const directPurchase = matchesAnyPattern(sentence, profile.directPurchase);
    if (directPurchase && (commitmentComponent !== undefined || profile.allowComponentlessDirectPurchase)) {
      candidates.push(
        buildCandidate({
          subjectSurface,
          documentType,
          extractorId,
          relation: "BUYS_FROM",
          objectSurface: counterparty.surface,
          citeText: sentence,
          locator,
          ...sourceLocationInput,
          ...(commitmentComponent === undefined ? {} : { component: commitmentComponent }),
          confidenceHint: 0.87
        })
      );
      continue;
    }
    if (matchesAnyPattern(sentence, profile.purchaseObligation)) {
      candidates.push(
        buildCandidate({
          subjectSurface,
          documentType,
          extractorId,
          relation: "BUYS_FROM",
          objectSurface: counterparty.surface,
          citeText: sentence,
          locator,
          ...sourceLocationInput,
          ...(commitmentComponent === undefined ? {} : { component: commitmentComponent }),
          confidenceHint: 0.89
        })
      );
      continue;
    }
    if (matchesAnyPattern(sentence, profile.singleSource)) {
      candidates.push(
        buildCandidate({
          subjectSurface,
          documentType,
          extractorId,
          relation: "BUYS_FROM",
          objectSurface: counterparty.surface,
          citeText: sentence,
          locator,
          ...sourceLocationInput,
          ...(commitmentComponent === undefined ? {} : { component: commitmentComponent }),
          confidenceHint: 0.86
        })
      );
    }
  }

  return uniqueCandidates(candidates);
}

function requireSupplierCounterpartyPattern(surface: string): CounterpartyPatternDefinition {
  const counterparty = SUPPLIER_COUNTERPARTY_PATTERNS.find((item) => item.surface === surface);
  if (counterparty === undefined) throw new Error(`Missing supplier counterparty pattern: ${surface}`);
  return counterparty;
}

function matchesFoundrySupplierRule(
  sentence: string,
  rule: FoundrySupplierRule,
  context: { readonly manufacturingContext: boolean; readonly foundryListContext: boolean; readonly memoryContext: boolean }
): boolean {
  if (rule.skipWhenMemoryContext && context.memoryContext) return false;
  if (rule.requiresFoundryListContext && !context.foundryListContext) return false;
  if (!rule.requiresFoundryListContext && !context.manufacturingContext && !context.foundryListContext) return false;
  return matchesAnyCounterparty(sentence, rule.counterparty);
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

function matchesAnyPattern(sentence: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(sentence));
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

interface CandidateBuildInput {
  readonly subjectSurface: string;
  readonly documentType: NormalizedDocument["document_type"];
  readonly extractorId: string;
  readonly relation: RelationType;
  readonly objectSurface: string;
  readonly citeText: string;
  readonly locator: string;
  readonly sourceLocation?: CandidateRelation["source_location"];
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
    ...(input.sourceLocation === undefined ? {} : { source_location: input.sourceLocation }),
    extractor_id: input.extractorId,
    raw_evidence_level_hint: 5,
    raw_confidence_hint: input.confidenceHint ?? 0.92
  };
}

// 关系抽取的“资格门”：任何官方披露型正文文档都可参与抽取，不再绑定具体来源/国家。
// - 美国 SEC：10-K / 10-Q / 8-K / 20-F / 40-F（20-F/40-F 是外国发行人年报，等价于本土 10-K）。
// - 公司官方年报：annual_report —— 覆盖各国 IR（含 EDINET 英文披露、company-ir 用户自定 URL），
//   让"用户想监控啥就监控啥"在 SEC 之外同样成立。
// 关键：这里只决定"读哪些文档"。证据可信度由 evidence-scorer 按来源 authority 单独封顶
//（未注册来源最高 L2、公司官方 L4、监管 L5），所以放宽资格门不会放大信任，只放大召回。
const OFFICIAL_DISCLOSURE_PROSE_TYPES = ["10-K", "10-Q", "8-K", "20-F", "40-F", "annual_report"] as const;

function isOfficialDisclosureProse(doc: NormalizedDocument): boolean {
  return (OFFICIAL_DISCLOSURE_PROSE_TYPES as readonly string[]).includes(doc.document_type);
}
