import type { ScbomDocument } from "@scbom/spec";
import { describe, expect, it } from "vitest";
import { communityPackPublishEligibilityErrors } from "@supplystrata/community-pack";

describe("community-pack load-side publish-eligibility re-check", () => {
  it("accepts a relationship backed by rule-extracted level-4 evidence", () => {
    expect(communityPackPublishEligibilityErrors([eligibleDocument()])).toEqual([]);
  });

  it("rejects a relationship whose evidence is below the publish evidence level", () => {
    const document = eligibleDocument({ evidenceLevel: 2 });
    const errors = communityPackPublishEligibilityErrors([document]);
    expect(errors.some((error) => error.includes("below publish threshold"))).toBe(true);
  });

  it("rejects a relationship backed by non-rule (e.g. llm-inferred) evidence", () => {
    const document = eligibleDocument({ extractionMethod: "llm" });
    const errors = communityPackPublishEligibilityErrors([document]);
    expect(errors.some((error) => error.includes("extraction_method 'llm' is not 'rule'"))).toBe(true);
  });

  it("rejects a non-current relationship from being shown as baseline", () => {
    const document = eligibleDocument({ relationshipStatus: "withdrawn" });
    const errors = communityPackPublishEligibilityErrors([document]);
    expect(errors.some((error) => error.includes("validity is 'withdrawn'"))).toBe(true);
  });

  it("rejects a relationship that references missing evidence", () => {
    const document = eligibleDocument();
    const tampered: ScbomDocument = {
      ...document,
      objects: document.objects.filter((object) => object.object_type !== "evidence")
    };
    const errors = communityPackPublishEligibilityErrors([tampered]);
    expect(errors.some((error) => error.includes("missing from the same document"))).toBe(true);
  });

  it("rejects a relationship with no evidence backing", () => {
    const document = eligibleDocument();
    const tampered: ScbomDocument = {
      ...document,
      objects: document.objects.map((object) =>
        object.object_type === "relationship" ? { ...object, evidence_refs: [] } : object
      )
    };
    const errors = communityPackPublishEligibilityErrors([tampered]);
    expect(errors.some((error) => error.includes("no evidence_refs"))).toBe(true);
  });
});

function eligibleDocument(
  overrides: { evidenceLevel?: number; extractionMethod?: string; relationshipStatus?: "active" | "withdrawn" } = {}
): ScbomDocument {
  const evidenceLevel = overrides.evidenceLevel ?? 4;
  const extractionMethod = overrides.extractionMethod ?? "rule";
  const status = overrides.relationshipStatus ?? "active";
  const producer = { name: "test" };
  const provenance = { producer, generated_at: "2026-05-29T00:00:00.000Z", method: "community-pack:pack-2026.Q2" };
  return {
    schema_version: "0.0.1",
    document_id: "DOC-1",
    generated_at: "2026-05-29T00:00:00.000Z",
    producer,
    objects: [
      { object_type: "entity", id: "ENT-A", name: "A", identifiers: [], provenance },
      { object_type: "entity", id: "ENT-B", name: "B", identifiers: [], provenance },
      {
        object_type: "evidence",
        id: "EV-1",
        source: { title: "10-K", url: "https://example.com/10k" },
        citation: { text: "supplies" },
        locator: { kind: "page", value: "1" },
        fingerprint: { algorithm: "sha256", value: "a".repeat(64) },
        assessments: [
          { scheme: "urn:supplystrata:vocab:evidence_level", value: evidenceLevel },
          { scheme: "urn:supplystrata:vocab:extraction_method", value: extractionMethod }
        ],
        provenance
      },
      {
        object_type: "relationship",
        id: "REL-1",
        subject_ref: "ENT-A",
        predicate: "supplies",
        object_ref: "ENT-B",
        evidence_refs: ["EV-1"],
        validity: { status },
        assessments: [{ scheme: "urn:supplystrata:vocab:evidence_level", value: evidenceLevel }],
        provenance
      }
    ]
  };
}
