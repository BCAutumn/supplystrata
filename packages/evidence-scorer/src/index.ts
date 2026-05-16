import { inferExtractionMethod, type CandidateRelation, type EvidenceLevel, type NormalizedDocument, type ScoringResult } from "@supplystrata/core";

export interface EvidenceScorer {
  score(candidate: CandidateRelation, doc: NormalizedDocument): Promise<ScoringResult>;
}

export class DeterministicEvidenceScorer implements EvidenceScorer {
  async score(candidate: CandidateRelation, doc: NormalizedDocument): Promise<ScoringResult> {
    const method = inferExtractionMethod(candidate.extractor_id);
    const sourceCap = sourceCapForDocument(doc.document_type);
    const methodCap = method === "llm" ? 4 : 5;
    const modal = modalStrength(candidate.cite_text);
    const modalAdjusted = modal === "future" ? 2 : modal === "weak" ? Math.max(1, sourceCap - 1) : sourceCap;
    const evidenceLevel = Math.min(candidate.raw_evidence_level_hint, sourceCap, methodCap, modalAdjusted) as EvidenceLevel;
    const base = baseConfidence(evidenceLevel);
    const factors = [
      { name: `method:${method}`, value: method === "llm" ? -0.05 : 0 },
      { name: `modal:${modal}`, value: modal === "future" ? -0.25 : modal === "weak" ? -0.1 : modal === "neutral" ? -0.03 : 0 },
      { name: "candidate_hint", value: Math.max(-0.1, Math.min(0.05, candidate.raw_confidence_hint - base)) }
    ];
    const uncapped = base + factors.reduce((sum, item) => sum + item.value, 0);
    const cap = evidenceLevel === 5 ? 0.95 : 0.9;
    const confidence = Math.max(0, Math.min(cap, uncapped));
    return {
      evidence_level: evidenceLevel,
      confidence,
      is_inferred: evidenceLevel <= 3,
      needs_review: method === "llm" || evidenceLevel <= 3,
      rationale: `source_cap=${sourceCap}; method_cap=${methodCap}; modal=${modal}`,
      confidence_breakdown: { base, factors, cap, final: confidence }
    };
  }
}

function sourceCapForDocument(documentType: string): EvidenceLevel {
  if (documentType === "10-K" || documentType === "10-Q" || documentType === "20-F" || documentType === "8-K") return 5;
  if (documentType === "annual_report" || documentType === "supplier_list") return 4;
  return 2;
}

function baseConfidence(level: EvidenceLevel): number {
  const base: Record<EvidenceLevel, number> = { 1: 0.5, 2: 0.65, 3: 0.75, 4: 0.85, 5: 0.92 };
  return base[level];
}

function modalStrength(text: string): "strong" | "neutral" | "weak" | "future" {
  if (/\b(may|might|could|can|sometimes)\b/i.test(text)) return "weak";
  if (/\b(plan|plans|planned|expect|expects|intend|intends|future|will)\b/i.test(text)) return "future";
  if (/\b(utilize|utilizes|purchase|purchases|depend|depends|rely|relies|manufacture|manufactures|supply|supplies)\b/i.test(text)) return "strong";
  return "neutral";
}
