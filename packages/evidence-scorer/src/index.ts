import { inferExtractionMethod, type CandidateRelation, type EvidenceLevel, type NormalizedDocument, type ScoringResult } from "@supplystrata/core";
import { sourceAuthorityFor, type RelationAuthority, type SourceAuthority } from "@supplystrata/source-registry";

export interface EvidenceScorer {
  score(candidate: CandidateRelation, doc: NormalizedDocument, options?: EvidenceScoringOptions): Promise<ScoringResult>;
}

export interface EvidenceScoringOptions {
  reviewed?: {
    reviewer: string;
    reviewed_at: string;
  };
}

export class DeterministicEvidenceScorer implements EvidenceScorer {
  async score(candidate: CandidateRelation, doc: NormalizedDocument, options: EvidenceScoringOptions = {}): Promise<ScoringResult> {
    const method = inferExtractionMethod(candidate.extractor_id);
    const sourceAuthority = sourceAuthorityFor({ source_adapter_id: doc.source_adapter_id, document_type: doc.document_type });
    const sourceCap = sourceAuthority.max_evidence_level;
    const relationCap = relationAuthorityCap(sourceAuthority.relation_authority, candidate.relation);
    const methodCap = method === "llm" ? 4 : 5;
    const modal = modalStrength(candidate.cite_text);
    const modalAdjusted = modal === "future" ? 2 : modal === "weak" ? Math.max(1, Math.min(sourceCap, relationCap) - 1) : Math.min(sourceCap, relationCap);
    const evidenceLevel = Math.min(candidate.raw_evidence_level_hint, sourceCap, relationCap, methodCap, modalAdjusted) as EvidenceLevel;
    const base = baseConfidence(evidenceLevel);
    const factors = [
      { name: `method:${method}`, value: method === "llm" ? -0.05 : 0 },
      { name: `source:${sourceAuthority.publisher_type}`, value: sourceAuthority.publisher_type === "regulator" ? 0.02 : 0 },
      { name: `authority:${sourceAuthority.relation_authority}`, value: authorityConfidenceFactor(sourceAuthority.relation_authority) },
      { name: `modal:${modal}`, value: modal === "future" ? -0.25 : modal === "weak" ? -0.1 : modal === "neutral" ? -0.03 : 0 },
      { name: "candidate_hint", value: Math.max(-0.1, Math.min(0.05, candidate.raw_confidence_hint - base)) }
    ];
    const uncapped = base + factors.reduce((sum, item) => sum + item.value, 0);
    const cap = evidenceLevel === 5 ? 0.95 : 0.9;
    const confidence = Math.max(0, Math.min(cap, uncapped));
    const baseNeedsReview = method === "llm" || evidenceLevel <= 3 || sourceRequiresReview(sourceAuthority);
    return {
      evidence_level: evidenceLevel,
      confidence,
      is_inferred: evidenceLevel <= 3,
      needs_review: options.reviewed === undefined ? baseNeedsReview : false,
      rationale: `source=${sourceAuthority.source_adapter_id}; publisher=${sourceAuthority.publisher_type}; relation_authority=${sourceAuthority.relation_authority}; source_cap=${sourceCap}; relation_cap=${relationCap}; method_cap=${methodCap}; modal=${modal}${options.reviewed === undefined ? "" : `; reviewed_by=${options.reviewed.reviewer}`}`,
      confidence_breakdown: { base, factors, cap, final: confidence }
    };
  }
}

function relationAuthorityCap(authority: RelationAuthority, relation: CandidateRelation["relation"]): EvidenceLevel {
  // 注册类来源只能证明注册/控制/设施事实，不能把公司间采购关系抬成高置信边。
  if (authority === "macro_trend") return 2;
  if (authority === "lead_only") return 1;
  if (authority === "registry_fact") {
    if (relation === "OWNS_SUBSIDIARY" || relation === "OWNS_BUSINESS_UNIT" || relation === "OPERATES_FACILITY") return 4;
    return 2;
  }
  return 5;
}

function authorityConfidenceFactor(authority: RelationAuthority): number {
  if (authority === "registry_fact" || authority === "facility_claim") return -0.02;
  if (authority === "macro_trend") return -0.08;
  if (authority === "lead_only") return -0.15;
  return 0;
}

function sourceRequiresReview(authority: SourceAuthority): boolean {
  return authority.relation_authority === "lead_only" || authority.relation_authority === "macro_trend";
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
