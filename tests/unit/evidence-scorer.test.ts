import { describe, expect, it } from "vitest";
import { DeterministicEvidenceScorer } from "@supplystrata/evidence-scorer";
import type { CandidateRelation, NormalizedDocument } from "@supplystrata/core";

const doc: NormalizedDocument = {
  doc_id: "DOC-test",
  source_adapter_id: "sec-edgar",
  document_type: "10-K",
  primary_entity_id: "ENT-NVIDIA",
  language: "en",
  fetched_at: "2026-01-01T00:00:00.000Z",
  source_url: "https://example.com",
  storage_key: "fixture.html",
  bytes_sha256: "abc",
  text: "fixture text",
  chunks: [],
  metadata: {}
};

describe("evidence scorer", () => {
  it("keeps strong rule-extracted 10-K evidence at level 5", async () => {
    const candidate = candidateWithText("We purchase memory from SK hynix, Micron Technology and Samsung.");
    const score = await new DeterministicEvidenceScorer().score(candidate, doc);
    expect(score.evidence_level).toBe(5);
    expect(score.needs_review).toBe(false);
    expect(score.confidence).toBeGreaterThan(0.9);
  });

  it("downgrades future language to level 2", async () => {
    const candidate = candidateWithText("We plan to qualify SK hynix as a supplier in the future.");
    const score = await new DeterministicEvidenceScorer().score(candidate, doc);
    expect(score.evidence_level).toBe(2);
    expect(score.needs_review).toBe(true);
  });

  it("treats reviewed supplier-list rows as hybrid, not llm", async () => {
    const candidate = { ...candidateWithText("3M Guangdong, Jiangsu, Shanghai China mainland"), extractor_id: "review.supplier-list-row", raw_evidence_level_hint: 4 as const };
    const score = await new DeterministicEvidenceScorer().score(candidate, { ...doc, document_type: "supplier_list", source_adapter_id: "apple-suppliers" });
    expect(score.evidence_level).toBe(4);
    expect(score.needs_review).toBe(false);
    expect(score.confidence_breakdown.factors[0]).toEqual({ name: "method:hybrid", value: 0 });
  });
});

function candidateWithText(citeText: string): CandidateRelation {
  return {
    subject_resolve: { surface: "NVIDIA" },
    object_resolve: { surface: "SK hynix" },
    relation: "BUYS_FROM",
    component: "HBM",
    cite_text: citeText,
    cite_locator: "fixture",
    extractor_id: "rule.10k.nvidia-supply-chain",
    raw_evidence_level_hint: 5,
    raw_confidence_hint: 0.92
  };
}
