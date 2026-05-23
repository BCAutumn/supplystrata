import { createHash } from "node:crypto";
import type { SemanticChangeReviewCandidate, SemanticChangeReviewPayloadSnapshot } from "./definitions.js";

export function buildSemanticChangeReviewCandidate(input: {
  changeType: string;
  sourceItemId: string;
  sourceUrl: string;
  snapshot: SemanticChangeReviewPayloadSnapshot;
}): SemanticChangeReviewCandidate {
  const candidateKey = stableSemanticChangeCandidateKey(input);
  return {
    review_id: stableSemanticChangeReviewId(input, candidateKey),
    candidate_key: candidateKey,
    kind: "semantic_change",
    title: `${input.changeType}: ${input.snapshot.subject_surface} -> ${input.snapshot.object_surface}`,
    payload: {
      change_type: input.changeType,
      semantic_relation_kind: input.snapshot.semantic_relation_kind,
      source_item_id: input.sourceItemId,
      doc_id: input.snapshot.doc_id,
      source_adapter_id: input.snapshot.source_adapter_id,
      relation: input.snapshot.relation,
      subject_surface: input.snapshot.subject_surface,
      object_surface: input.snapshot.object_surface,
      cite_text: input.snapshot.cite_text,
      cite_locator: input.snapshot.cite_locator,
      fingerprint: input.snapshot.fingerprint,
      extractor_id: input.snapshot.extractor_id,
      ...(input.snapshot.component_id === undefined ? {} : { component_id: input.snapshot.component_id }),
      ...(input.snapshot.component === undefined ? {} : { component: input.snapshot.component }),
      ...(input.snapshot.component_specificity === undefined ? {} : { component_specificity: input.snapshot.component_specificity })
    },
    evidence: {
      doc_id: input.snapshot.doc_id,
      source_url: input.sourceUrl,
      source_adapter_id: input.snapshot.source_adapter_id,
      source_locator: input.snapshot.cite_locator,
      source_row_text: input.snapshot.cite_text,
      normalized_record_text: [
        input.changeType,
        input.snapshot.semantic_relation_kind,
        input.snapshot.subject_surface,
        input.snapshot.relation,
        input.snapshot.object_surface,
        input.snapshot.component ?? input.snapshot.component_id ?? ""
      ]
        .join(" | ")
        .trim()
    },
    confidence: confidenceForSemanticChange(input.changeType),
    needs_review: true,
    review_reason: "官方披露的关系语义发生变化。该候选只代表“值得研究员复核的变化”，不会自动写入事实图谱；确认后用于后续 claim / 研究摘要。"
  };
}

function stableSemanticChangeCandidateKey(input: {
  changeType: string;
  sourceItemId: string;
  sourceUrl: string;
  snapshot: SemanticChangeReviewPayloadSnapshot;
}): string {
  return [
    "semantic-change",
    input.changeType,
    input.sourceItemId,
    input.sourceUrl,
    input.snapshot.doc_id,
    input.snapshot.semantic_relation_kind,
    input.snapshot.relation,
    input.snapshot.subject_surface,
    input.snapshot.object_surface,
    input.snapshot.component_id ?? "",
    input.snapshot.component ?? "",
    input.snapshot.component_specificity ?? "",
    input.snapshot.fingerprint
  ].join("|");
}

function stableSemanticChangeReviewId(input: { changeType: string; snapshot: SemanticChangeReviewPayloadSnapshot }, candidateKey: string): string {
  const readable = [input.changeType, input.snapshot.subject_surface, input.snapshot.object_surface]
    .join("|")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 56);
  const digest = createHash("sha256").update(candidateKey).digest("hex").slice(0, 16);
  return `REV-SEMANTIC-${readable}-${digest}`;
}

function confidenceForSemanticChange(changeType: string): number {
  if (changeType.includes("REMOVED")) return 0.7;
  if (changeType.includes("CHANGED")) return 0.82;
  return 0.86;
}
