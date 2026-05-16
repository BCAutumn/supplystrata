import { describe, expect, it } from "vitest";
import { buildEvidenceTrace, findCitationOffsets, normalizeCiteTextForHash } from "@supplystrata/evidence-trace";

describe("evidence trace", () => {
  it("computes exact chunk offsets and stable fingerprints", () => {
    const citeText = "NVIDIA purchases memory from SK hynix.";
    const trace = buildEvidenceTrace({
      cite_text: citeText,
      extractor_id: "rule.sec.memory-supplier",
      source_snapshot_sha256: "source-sha",
      document_metadata: { parser_version: "html-parser-v1" },
      chunk_text: `Risk factors. ${citeText} Additional context.`,
      identity: {
        subject_id: "ENT-NVIDIA",
        object_id: "ENT-SK-HYNIX",
        relation: "BUYS_FROM",
        component: {
          component: "memory",
          component_id: "COMP-MEMORY",
          component_specificity: "unspecified"
        }
      }
    });

    expect(trace.cite_start_char).toBe("Risk factors. ".length);
    expect(trace.cite_end_char).toBe("Risk factors. ".length + citeText.length);
    expect(trace.cite_text_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(trace.normalized_cite_text_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(trace.relation_candidate_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(trace.source_snapshot_sha256).toBe("source-sha");
    expect(trace.parser_version).toBe("html-parser-v1");
    expect(trace.extractor_version).toBe("unknown");
  });

  it("normalizes citation whitespace before hash input", () => {
    expect(normalizeCiteTextForHash(" NVIDIA\n\tpurchases   memory ")).toBe("NVIDIA purchases memory");
  });

  it("does not invent offsets when cite_text is absent from the chunk", () => {
    expect(findCitationOffsets("A different sentence.", "NVIDIA purchases memory.")).toEqual({ start: null, end: null });
  });
});
