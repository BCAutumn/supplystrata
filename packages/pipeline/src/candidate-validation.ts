import type { CandidateRelation } from "@supplystrata/core";

export function isValidCandidate(candidate: CandidateRelation, documentText: string): boolean {
  return candidate.cite_text.length >= 30 && documentText.includes(candidate.cite_text);
}
