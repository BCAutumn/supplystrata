import type { CandidateRelation } from "@supplystrata/core";

export interface SavedChunkRef {
  chunk_id: string;
  text: string;
  locator?: string;
}

export type CitationLocation =
  | { status: "located"; chunk_id: string; occurrence_count: number }
  | { status: "not_found"; occurrence_count: 0; reason: string }
  | { status: "ambiguous"; occurrence_count: number; reason: string };

export function locateCandidateCitation(chunks: readonly SavedChunkRef[], candidate: CandidateRelation): CitationLocation {
  if (candidate.source_location !== undefined) {
    return locateFromCandidateSourceLocation(chunks, candidate);
  }
  const matches = chunks
    .map((chunk) => ({
      chunk_id: chunk.chunk_id,
      count: countExactOccurrences(chunk.text, candidate.cite_text)
    }))
    .filter((match) => match.count > 0);

  const occurrenceCount = matches.reduce((total, match) => total + match.count, 0);
  if (matches.length === 0) {
    return {
      status: "not_found",
      occurrence_count: 0,
      reason: "citation text is not present in persisted document chunks"
    };
  }
  if (matches.length > 1 || occurrenceCount > 1) {
    return {
      status: "ambiguous",
      occurrence_count: occurrenceCount,
      reason: "citation text appears multiple times; extractor must provide a narrower citation"
    };
  }
  const match = matches[0];
  if (match === undefined) {
    return {
      status: "not_found",
      occurrence_count: 0,
      reason: "citation text is not present in persisted document chunks"
    };
  }
  return { status: "located", chunk_id: match.chunk_id, occurrence_count: occurrenceCount };
}

function locateFromCandidateSourceLocation(chunks: readonly SavedChunkRef[], candidate: CandidateRelation): CitationLocation {
  const location = candidate.source_location;
  if (location === undefined) {
    return {
      status: "not_found",
      occurrence_count: 0,
      reason: "candidate has no source location"
    };
  }
  const chunk = chunks.find((item) => {
    if (location.chunk_id !== undefined && item.chunk_id === location.chunk_id) return true;
    return location.chunk_locator !== undefined && item.locator === location.chunk_locator;
  });
  if (chunk === undefined) {
    return {
      status: "not_found",
      occurrence_count: 0,
      reason: "candidate source location does not match any persisted document chunk"
    };
  }
  const citedText = chunk.text.slice(location.cite_start_char, location.cite_end_char);
  if (citedText !== candidate.cite_text) {
    return {
      status: "not_found",
      occurrence_count: 0,
      reason: "candidate source offsets do not reproduce cite_text"
    };
  }
  return { status: "located", chunk_id: chunk.chunk_id, occurrence_count: 1 };
}

function countExactOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let cursor = 0;
  while (cursor < haystack.length) {
    const index = haystack.indexOf(needle, cursor);
    if (index === -1) return count;
    count += 1;
    cursor = index + needle.length;
  }
  return count;
}
