import { describe, expect, it } from "vitest";
import { assertCommunityPackFileIntegrity, buildCommunityPack, publishEligibleScbomDocument } from "@supplystrata/community-pack";
import { workbenchScbomFixture } from "./workbench-scbom-fixture.js";

describe("community-pack exporter", () => {
  it("exports only publish-eligible SCBOM relationships and evidence", () => {
    const model = workbenchScbomFixture();
    const result = buildCommunityPack({
      packVersion: "pack-2026.Q2",
      generatedAt: model.generated_at,
      license: "CC-BY-4.0",
      sourceInstanceFingerprint: "d".repeat(64),
      workbenchModels: [model]
    });

    assertCommunityPackFileIntegrity(result.manifest, result.files);
    expect(result.manifest.totals.documents).toBe(1);
    expect(result.manifest.totals.object_counts.relationship).toBe(1);
    expect(String(result.files[0]?.content)).toContain("EDGE-NVIDIA-TSMC");
    expect(String(result.files[0]?.content)).not.toContain("UNK-CONFLICT-1");
    expect(String(result.files[0]?.content)).not.toContain("CHG-EDGE-1");
  });

  it("excludes low-evidence, inferred, manual, and dangling relationships", () => {
    const model = workbenchScbomFixture();
    const lowEvidence = {
      ...model,
      edges: model.edges.map((edge) => ({ ...edge, evidence_level: 3 as const })),
      upstream_edges: model.upstream_edges.map((edge) => ({ ...edge, evidence_level: 3 as const }))
    };
    const inferredEvidence = {
      ...model,
      evidences: model.evidences.map((evidence) => ({ ...evidence, is_inferred: true }))
    };
    const manualEvidence = {
      ...model,
      evidences: model.evidences.map((evidence) => ({ ...evidence, extraction_method: "manual" as const }))
    };
    const danglingEvidence = {
      ...model,
      edges: model.edges.map((edge) => ({ ...edge, evidence_ids: ["EV-MISSING"] })),
      upstream_edges: model.upstream_edges.map((edge) => ({ ...edge, evidence_ids: ["EV-MISSING"] }))
    };

    expect(publishEligibleScbomDocument(lowEvidence)).toBeUndefined();
    expect(publishEligibleScbomDocument(inferredEvidence)).toBeUndefined();
    expect(publishEligibleScbomDocument(manualEvidence)).toBeUndefined();
    expect(publishEligibleScbomDocument(danglingEvidence)).toBeUndefined();
  });
});
