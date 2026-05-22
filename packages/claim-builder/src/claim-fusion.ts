import type { DocumentType, EvidenceLevel } from "@supplystrata/core";
import { getSourceById, sourceAuthorityFor, type PublisherType, type RelationAuthority, type SourceCategory } from "@supplystrata/source-registry";

export type ClaimEvidenceFusionRole = "primary" | "supporting";

export type ClaimEvidenceIndependenceBasis =
  | "primary_evidence"
  | "same_doc_same_chunk"
  | "same_document_different_chunk"
  | "same_source_different_document"
  | "different_source_adapter";

export interface ClaimFusionEvidence {
  evidence_id: string;
  doc_id: string;
  chunk_id: string | null;
  evidence_level: EvidenceLevel;
  confidence: number;
  source_adapter_id: string;
  document_type: DocumentType;
}

export interface ClaimFusionContribution {
  evidence_id: string;
  role: ClaimEvidenceFusionRole;
  source_adapter_id: string;
  document_type: DocumentType;
  source_category: SourceCategory;
  publisher_type: PublisherType;
  relation_authority: RelationAuthority;
  independence_basis: ClaimEvidenceIndependenceBasis;
  independence_weight: number;
  adjusted_confidence: number;
}

export interface ClaimFusionResult {
  confidence: number;
  base_confidence: number;
  supporting_evidence_count: number;
  independent_source_count: number;
  contributions: ClaimFusionContribution[];
}

export function fuseClaimConfidenceFromEvidence(
  evidences: readonly ClaimFusionEvidence[],
  input: { primary_evidence_id: string; base_confidence?: number }
): ClaimFusionResult {
  const primaryEvidence = evidences.find((evidence) => evidence.evidence_id === input.primary_evidence_id);
  if (primaryEvidence === undefined) {
    throw new Error(`Claim fusion cannot find primary evidence ${input.primary_evidence_id}`);
  }

  const baseConfidence = clampConfidence(input.base_confidence ?? primaryEvidence.confidence);
  const contributions = evidences.map((evidence) => contributionForEvidence(evidence, primaryEvidence));
  const remainingDoubt = contributions.reduce((product, contribution) => product * (1 - contribution.adjusted_confidence), 1);
  // 融合只提升 claim confidence；单条 evidence_level 保持原样，避免多条弱证据伪装成高等级事实。
  const fusedConfidence = Math.max(baseConfidence, Math.min(0.99, 1 - remainingDoubt));
  const independentSourceCount = new Set(contributions.filter((item) => item.adjusted_confidence > 0).map((item) => item.source_adapter_id)).size;

  return {
    confidence: roundConfidence(fusedConfidence),
    base_confidence: roundConfidence(baseConfidence),
    supporting_evidence_count: contributions.filter((item) => item.role === "supporting").length,
    independent_source_count: independentSourceCount,
    contributions
  };
}

function contributionForEvidence(evidence: ClaimFusionEvidence, primaryEvidence: ClaimFusionEvidence): ClaimFusionContribution {
  const role: ClaimEvidenceFusionRole = evidence.evidence_id === primaryEvidence.evidence_id ? "primary" : "supporting";
  const independence = role === "primary" ? { basis: "primary_evidence" as const, weight: 1 } : sourceIndependenceAgainstPrimary(evidence, primaryEvidence);
  const source = getSourceById(evidence.source_adapter_id);
  const authority = sourceAuthorityFor({ source_adapter_id: evidence.source_adapter_id, document_type: evidence.document_type });

  return {
    evidence_id: evidence.evidence_id,
    role,
    source_adapter_id: evidence.source_adapter_id,
    document_type: evidence.document_type,
    source_category: source?.category ?? "manual",
    publisher_type: authority.publisher_type,
    relation_authority: authority.relation_authority,
    independence_basis: independence.basis,
    independence_weight: independence.weight,
    adjusted_confidence: roundConfidence(clampConfidence(evidence.confidence) * independence.weight)
  };
}

function sourceIndependenceAgainstPrimary(
  evidence: ClaimFusionEvidence,
  primaryEvidence: ClaimFusionEvidence
): { basis: Exclude<ClaimEvidenceIndependenceBasis, "primary_evidence">; weight: number } {
  if (evidence.doc_id === primaryEvidence.doc_id && evidence.chunk_id === primaryEvidence.chunk_id) {
    return { basis: "same_doc_same_chunk", weight: 0 };
  }
  if (evidence.doc_id === primaryEvidence.doc_id) {
    return { basis: "same_document_different_chunk", weight: 0.25 };
  }
  if (evidence.source_adapter_id === primaryEvidence.source_adapter_id) {
    return { basis: "same_source_different_document", weight: 0.5 };
  }
  return { basis: "different_source_adapter", weight: 1 };
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) throw new Error(`Invalid confidence value: ${value}`);
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function roundConfidence(value: number): number {
  return Math.round(value * 10000) / 10000;
}
