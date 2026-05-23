import { createHash } from "node:crypto";
import { blockedFactWritePolicy } from "./definitions.js";
import type {
  ClaimConflictReviewPayload,
  ClaimConflictReviewCandidate,
  OfficialDisclosureSignalReviewCandidate,
  OfficialDisclosureSignalReviewInput,
  SemanticChangeReviewCandidate,
  SemanticChangeReviewPayloadSnapshot
} from "./definitions.js";

export * from "./definitions.js";
export * from "./entity-source.js";
export * from "./guards.js";
export * from "./osh-facility.js";
export * from "./supplier-list.js";

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

export function buildClaimConflictReviewCandidate(input: { payload: ClaimConflictReviewPayload }): ClaimConflictReviewCandidate {
  const candidateKey = stableClaimConflictCandidateKey(input.payload);
  const evidenceIds = input.payload.evidence_refs.map((ref) => `${ref.role}:${ref.evidence_id}`);
  const unknownIds = input.payload.unknown_refs.map((ref) => `${ref.role}:${ref.status}:${ref.unknown_id}`);
  return {
    review_id: stableClaimConflictReviewId(input.payload, candidateKey),
    candidate_key: candidateKey,
    kind: "claim_conflict_review",
    title: `Claim conflict: ${input.payload.claim_id}`,
    payload: input.payload,
    evidence: {
      source_url: `supplystrata://claims/${input.payload.claim_id}/conflict-review`,
      source_adapter_id: "claim-builder",
      source_locator: input.payload.edge_id === null ? input.payload.claim_id : `${input.payload.claim_id} / ${input.payload.edge_id}`,
      source_row_text: input.payload.claim_text,
      normalized_record_text: [input.payload.claim_id, input.payload.conflict_state, ...evidenceIds, ...unknownIds].join(" | ")
    },
    confidence: claimConflictReviewConfidence(input.payload),
    needs_review: true,
    review_reason:
      "Claim has contradicting evidence or an open conflict unknown. This review candidate blocks automatic fact mutation and requires human resolution before any edge deprecation or claim status change."
  };
}

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

function stableClaimConflictCandidateKey(payload: ClaimConflictReviewPayload): string {
  return [
    "claim-conflict-review",
    payload.claim_id,
    payload.edge_id ?? "",
    payload.conflict_state,
    payload.safe_write_status,
    payload.evidence_refs.map((ref) => `${ref.role}:${ref.evidence_id}`).join(","),
    payload.unknown_refs.map((ref) => `${ref.role}:${ref.status}:${ref.unknown_id}`).join(",")
  ].join("|");
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

function stableClaimConflictReviewId(payload: ClaimConflictReviewPayload, candidateKey: string): string {
  const readable = [payload.claim_id, payload.conflict_state]
    .join("|")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 56);
  const digest = createHash("sha256").update(candidateKey).digest("hex").slice(0, 16);
  return `REV-CLAIM-CONFLICT-${readable}-${digest}`;
}

function claimConflictReviewConfidence(payload: ClaimConflictReviewPayload): number {
  if (payload.severity === "high") return 0.9;
  return 0.78;
}

function confidenceForSemanticChange(changeType: string): number {
  if (changeType.includes("REMOVED")) return 0.7;
  if (changeType.includes("CHANGED")) return 0.82;
  return 0.86;
}
