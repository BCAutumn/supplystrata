import { describe, expect, it } from "vitest";
import type { ScbomDocument, ScbomObject, ScbomRelationship } from "@scbom/spec";
import { toScbomDocument } from "@supplystrata/workbench-export";
import { createScbomView } from "@supplystrata/web";
import { workbenchScbomFixture } from "./workbench-scbom-fixture.js";

describe("SCBOM headless view model", () => {
  it("normalizes SCBOM objects into an evidence-first view model", () => {
    const view = createScbomView(toScbomDocument(workbenchScbomFixture()));

    expect(view.metadata).toMatchObject({
      schema_version: "0.0.1",
      producer_name: "SupplyStrata"
    });
    expect(view.entities.map((entity) => entity.id)).toEqual(["COMP-GPU", "ENT-NVIDIA", "ENT-TSMC"]);
    expect(view.evidences).toHaveLength(1);
    expect(view.evidences[0]).toMatchObject({
      id: "EV-PRIMARY",
      evidence_level: 5,
      visual_weight: "level_5",
      source_url: "https://www.sec.gov/fixture"
    });
    expect(view.relationships).toHaveLength(1);
    expect(view.relationships[0]).toMatchObject({
      id: "EDGE-NVIDIA-TSMC",
      subject_name: "NVIDIA",
      object_name: "TSMC",
      evidence_level: 5,
      visual_weight: "level_5"
    });
    expect(view.relationships[0]?.evidence_trail[0]?.evidence?.citation_text).toBe("NVIDIA uses TSMC for wafer fabrication.");
  });

  it("keeps observations and unknowns out of relationship graph edges", () => {
    const view = createScbomView(toScbomDocument(workbenchScbomFixture()));

    expect(view.observations.map((observation) => observation.id)).toEqual(["OBS-GPU-1"]);
    expect(view.unknowns.map((unknown) => unknown.id)).toEqual(["UNK-CONFLICT-1"]);
    expect(view.relationships.map((relationship) => relationship.id)).toEqual(["EDGE-NVIDIA-TSMC"]);
    expect(view.graph.edges.map((edge) => edge.kind)).toEqual(["relationship"]);
    expect(view.graph.edges.map((edge) => edge.id)).not.toContain("OBS-GPU-1");
    expect(view.graph.edges.map((edge) => edge.id)).not.toContain("UNK-CONFLICT-1");
  });

  it("downgrades dangling evidence refs to warnings instead of throwing", () => {
    const document = replaceRelationshipEvidenceRefs(toScbomDocument(workbenchScbomFixture()), ["EV-MISSING"]);
    const view = createScbomView(document);

    expect(view.relationships[0]?.evidence_trail).toEqual([{ evidence_id: "EV-MISSING" }]);
    expect(view.warnings).toEqual([
      {
        code: "missing_ref",
        message: "Object EDGE-NVIDIA-TSMC references missing evidence EV-MISSING",
        object_id: "EDGE-NVIDIA-TSMC",
        ref: "EV-MISSING"
      }
    ]);
  });

  it("produces deterministic overview graph layout", () => {
    const document = toScbomDocument(workbenchScbomFixture());
    const first = createScbomView(document).graph;
    const second = createScbomView(document).graph;

    expect(first).toEqual(second);
    expect(first.nodes).toEqual([
      { id: "COMP-GPU", label: "GPU", kind: "entity", x: 0, y: -160 },
      { id: "ENT-NVIDIA", label: "NVIDIA", kind: "entity", x: 138.564, y: 80 },
      { id: "ENT-TSMC", label: "TSMC", kind: "entity", x: -138.564, y: 80 }
    ]);
  });
});

function replaceRelationshipEvidenceRefs(document: ScbomDocument, refs: readonly string[]): ScbomDocument {
  const objects: ScbomObject[] = document.objects.map((object) => {
    if (object.object_type !== "relationship") return object;
    const relationship: ScbomRelationship = { ...object, evidence_refs: refs };
    return relationship;
  });
  return { ...document, objects };
}
