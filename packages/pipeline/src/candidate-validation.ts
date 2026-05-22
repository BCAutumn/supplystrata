import { isValidCandidateRelation, type CandidateRelation } from "@supplystrata/core";

export function isValidCandidate(candidate: CandidateRelation, documentText: string): boolean {
  return isValidCandidateRelation(candidate, documentText);
}
