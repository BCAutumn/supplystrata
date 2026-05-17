import { createHash } from "node:crypto";
import type { CandidateRelation, ComponentSpecificity, RelationType } from "@supplystrata/core";

export interface EvidenceTraceComponent {
  component: string | null;
  component_id: string | null;
  component_specificity: ComponentSpecificity | null;
}

export interface EvidenceTraceIdentity {
  subject_id: string | null;
  object_id: string | null;
  relation: RelationType | null;
  component: EvidenceTraceComponent;
}

export interface EvidenceTraceInput {
  cite_text: string;
  extractor_id: string | null;
  llm_meta?: CandidateRelation["llm_meta"];
  source_snapshot_sha256: string | null;
  document_metadata: Record<string, unknown>;
  identity: EvidenceTraceIdentity;
  chunk_text?: string;
}

export interface EvidenceTraceFields {
  cite_start_char: number | null;
  cite_end_char: number | null;
  cite_text_sha256: string;
  normalized_cite_text_sha256: string;
  source_snapshot_sha256: string | null;
  parser_version: string;
  extractor_version: string;
  relation_candidate_hash: string;
}

export function buildEvidenceTrace(input: EvidenceTraceInput): EvidenceTraceFields {
  const citeTextHash = sha256Hex(input.cite_text);
  const normalizedCiteTextHash = sha256Hex(normalizeCiteTextForHash(input.cite_text));
  const offsets = input.chunk_text === undefined ? { start: null, end: null } : findCitationOffsets(input.chunk_text, input.cite_text);

  return {
    cite_start_char: offsets.start,
    cite_end_char: offsets.end,
    cite_text_sha256: citeTextHash,
    normalized_cite_text_sha256: normalizedCiteTextHash,
    source_snapshot_sha256: input.source_snapshot_sha256,
    parser_version: parserVersionFromMetadata(input.document_metadata),
    extractor_version: extractorVersionFromLlmMeta(input.llm_meta),
    relation_candidate_hash: relationCandidateHash({
      identity: input.identity,
      extractor_id: input.extractor_id,
      normalized_cite_text_sha256: normalizedCiteTextHash
    })
  };
}

export function findCitationOffsets(chunkText: string, citeText: string): { start: number | null; end: number | null } {
  // 找不到精确子串时不猜位置；偏移错误比缺失偏移更难审计，交给 data-quality 暴露。
  const start = chunkText.indexOf(citeText);
  if (start < 0) return { start: null, end: null };
  return { start, end: start + citeText.length };
}

export function normalizeCiteTextForHash(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function parserVersionFromMetadata(metadata: Record<string, unknown>): string {
  const value = metadata["parser_version"];
  return typeof value === "string" && value.trim().length > 0 ? value : "unknown";
}

function extractorVersionFromLlmMeta(llmMeta: CandidateRelation["llm_meta"] | undefined): string {
  if (llmMeta !== undefined) return `prompt:${llmMeta.prompt_hash}`;
  return "unknown";
}

function relationCandidateHash(input: { identity: EvidenceTraceIdentity; extractor_id: string | null; normalized_cite_text_sha256: string }): string {
  return sha256Hex(
    JSON.stringify({
      subject_id: input.identity.subject_id,
      object_id: input.identity.object_id,
      relation: input.identity.relation,
      component_id: input.identity.component.component_id,
      component: input.identity.component.component,
      component_specificity: input.identity.component.component_specificity,
      extractor_id: input.extractor_id,
      normalized_cite_text_sha256: input.normalized_cite_text_sha256
    })
  );
}
