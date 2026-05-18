import { describe, expect, it } from "vitest";
import type { CandidateRelation } from "@supplystrata/core";
import { locateCandidateCitation } from "@supplystrata/pipeline";

describe("locateCandidateCitation", () => {
  it("maps an exact citation to one persisted chunk", () => {
    const candidate = candidateWithCitation("NVIDIA purchases memory from SK hynix and Micron.");

    const location = locateCandidateCitation(
      [
        { chunk_id: "DOC-1-CHK-0001", text: "Unrelated risk factor." },
        { chunk_id: "DOC-1-CHK-0002", text: "NVIDIA purchases memory from SK hynix and Micron." }
      ],
      candidate
    );

    expect(location).toEqual({ status: "located", chunk_id: "DOC-1-CHK-0002", occurrence_count: 1 });
  });

  it("uses extractor-provided source offsets before fallback text search", () => {
    const citeText = "NVIDIA purchases memory from SK hynix and Micron.";
    const candidate = {
      ...candidateWithCitation(citeText),
      source_location: {
        chunk_id: "OLD-DOC-CHK-0002",
        chunk_locator: "chunk 2",
        cite_start_char: "Prefix. ".length,
        cite_end_char: "Prefix. ".length + citeText.length
      }
    };

    const location = locateCandidateCitation(
      [{ chunk_id: "NEW-DOC-CHK-0002", locator: "chunk 2", text: `Prefix. ${citeText} Repeated ${citeText}` }],
      candidate
    );

    expect(location).toEqual({ status: "located", chunk_id: "NEW-DOC-CHK-0002", occurrence_count: 1 });
  });

  it("rejects extractor-provided source offsets that do not reproduce the citation", () => {
    const candidate = {
      ...candidateWithCitation("NVIDIA purchases memory from SK hynix and Micron."),
      source_location: {
        chunk_locator: "chunk 2",
        cite_start_char: 0,
        cite_end_char: 10
      }
    };

    const location = locateCandidateCitation([{ chunk_id: "DOC-1-CHK-0002", locator: "chunk 2", text: candidate.cite_text }], candidate);

    expect(location.status).toBe("not_found");
  });

  it("rejects a citation that cannot be mapped to persisted chunks", () => {
    const candidate = candidateWithCitation("NVIDIA purchases memory from SK hynix and Micron.");

    const location = locateCandidateCitation([{ chunk_id: "DOC-1-CHK-0001", text: "Unrelated risk factor." }], candidate);

    expect(location.status).toBe("not_found");
  });

  it("rejects a citation that appears more than once", () => {
    const candidate = candidateWithCitation("NVIDIA purchases memory from SK hynix and Micron.");

    const location = locateCandidateCitation(
      [
        { chunk_id: "DOC-1-CHK-0001", text: "NVIDIA purchases memory from SK hynix and Micron." },
        { chunk_id: "DOC-1-CHK-0002", text: "NVIDIA purchases memory from SK hynix and Micron." }
      ],
      candidate
    );

    expect(location).toMatchObject({ status: "ambiguous", occurrence_count: 2 });
  });
});

function candidateWithCitation(citeText: string): CandidateRelation {
  return {
    subject_resolve: { surface: "NVIDIA" },
    object_resolve: { surface: "SK hynix" },
    relation: "BUYS_FROM",
    component: "memory",
    cite_text: citeText,
    cite_locator: "fixture",
    extractor_id: "rule.test",
    raw_evidence_level_hint: 5,
    raw_confidence_hint: 0.9
  };
}
