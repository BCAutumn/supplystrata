import { createHash } from "node:crypto";
import type { ClaimConflictReviewCandidate, ClaimConflictReviewPayload } from "./definitions.js";

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
