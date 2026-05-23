import { createHash } from "node:crypto";
import { blockedFactWritePolicy, type OfficialDisclosureSignalReviewCandidate, type OfficialDisclosureSignalReviewInput } from "./definitions.js";

export function buildOfficialDisclosureSignalReviewCandidate(input: {
  signal: OfficialDisclosureSignalReviewInput;
  docId: string;
  sourceItemId: string;
  sourceAdapterId: string;
  sourceUrl: string;
  sourceDate?: string;
  sourceLocator: string;
}): OfficialDisclosureSignalReviewCandidate {
  const candidateKey = stableOfficialDisclosureSignalCandidateKey(input);
  return {
    review_id: stableOfficialDisclosureSignalReviewId(input, candidateKey),
    candidate_key: candidateKey,
    kind: "official_disclosure_signal",
    title: `Official disclosure signal: ${input.signal.title}`,
    payload: {
      source_item_id: input.sourceItemId,
      doc_id: input.docId,
      source_adapter_id: input.sourceAdapterId,
      signal_title: input.signal.title,
      cite_text: input.signal.cite_text,
      cite_locator: input.sourceLocator,
      evidence_level_hint: input.signal.evidence_level,
      fact_write_policy: blockedFactWritePolicy(["review_only_official_signal", "not_a_relation_extractor", "no_counterparty_edge_without_review"])
    },
    evidence: {
      doc_id: input.docId,
      source_url: input.sourceUrl,
      ...(input.sourceDate === undefined ? {} : { source_date: input.sourceDate }),
      source_adapter_id: input.sourceAdapterId,
      source_locator: input.sourceLocator,
      source_row_text: input.signal.cite_text,
      normalized_record_text: [input.signal.title, `evidence_level=${input.signal.evidence_level}`, input.signal.cite_text].join(" | ")
    },
    confidence: input.signal.confidence,
    needs_review: true,
    review_reason: "官方披露信号只说明该文档出现了供应链、产能、需求或技术路线相关内容；它用于研究员复核、补充 claim 或寻找 corroboration，不会自动写入事实边。"
  };
}

function stableOfficialDisclosureSignalCandidateKey(input: {
  signal: OfficialDisclosureSignalReviewInput;
  docId: string;
  sourceItemId: string;
  sourceAdapterId: string;
  sourceUrl: string;
  sourceLocator: string;
}): string {
  return [
    "official-disclosure-signal",
    input.sourceAdapterId,
    input.sourceItemId,
    input.docId,
    input.sourceUrl,
    input.sourceLocator,
    input.signal.title,
    input.signal.cite_text
  ].join("|");
}

function stableOfficialDisclosureSignalReviewId(input: { signal: OfficialDisclosureSignalReviewInput; sourceAdapterId: string }, candidateKey: string): string {
  const readable = [input.sourceAdapterId, input.signal.title]
    .join("|")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 56);
  const digest = createHash("sha256").update(candidateKey).digest("hex").slice(0, 16);
  return `REV-OFFICIAL-SIGNAL-${readable}-${digest}`;
}
