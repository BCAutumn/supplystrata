import { describe, expect, it } from "vitest";
import { assertScbomDocument, toScbomDocument, type WorkbenchModel } from "@supplystrata/workbench-export";
import { workbenchScbomFixture } from "./workbench-scbom-fixture.js";

describe("workbench-export SCBOM mapper", () => {
  it("exports neutral SCBOM objects with citable evidence and provenance", () => {
    const document = toScbomDocument(workbenchScbomFixture());

    assertScbomDocument(document);
    expect(document.schema_version).toBe("0.0.1");
    expect(document.producer.name).toBe("SupplyStrata");
    expect(objectTypes(document.objects)).toEqual(["change", "entity", "evidence", "observation", "relationship", "unknown"]);

    const relationship = document.objects.find((object) => object.object_type === "relationship");
    expect(relationship).toMatchObject({
      id: "EDGE-NVIDIA-TSMC",
      subject_ref: "ENT-NVIDIA",
      predicate: "USES_FOUNDRY",
      object_ref: "ENT-TSMC",
      evidence_refs: ["EV-PRIMARY"]
    });
    expect(relationship?.provenance.source_refs).toEqual(["EV-PRIMARY"]);

    const evidence = document.objects.find((object) => object.object_type === "evidence");
    expect(evidence).toMatchObject({
      id: "EV-PRIMARY",
      source: {
        url: "https://www.sec.gov/fixture",
        published_at: "2026-02-01T00:00:00.000Z",
        retrieved_at: "2026-02-02T00:00:00.000Z"
      },
      fingerprint: {
        algorithm: "sha256:generated_from_citation"
      }
    });
    expect(evidence?.fingerprint.value).toHaveLength(64);

    const observation = document.objects.find((object) => object.object_type === "observation");
    expect(observation).toMatchObject({
      id: "OBS-GPU-1",
      scope_ref: "ENT-NVIDIA",
      does_not_assert_relationship: true,
      evidence_refs: ["EV-PRIMARY"]
    });

    const unknown = document.objects.find((object) => object.object_type === "unknown");
    expect(unknown).toMatchObject({
      id: "UNK-CONFLICT-1",
      scope_ref: "ENT-NVIDIA",
      evidence_refs: ["EV-PRIMARY"]
    });
    expect(document.objects.some((object) => object.object_type === "change" && object.id === "CHG-RISK-1")).toBe(false);
  });

  it("refuses to export relationships that have no exported evidence", () => {
    const model = workbenchScbomFixture();
    const edge = firstWorkbenchEdge(model);
    const broken: WorkbenchModel = {
      ...model,
      evidences: [],
      edges: [{ ...edge, evidence_ids: ["EV-MISSING"] }]
    };

    expect(() => toScbomDocument(broken)).toThrow("at least one exported evidence ref is required");
  });
});

function objectTypes(objects: WorkbenchScbomDocumentObjects): string[] {
  return [...new Set(objects.map((object) => object.object_type))].sort();
}

type WorkbenchScbomDocumentObjects = ReturnType<typeof toScbomDocument>["objects"];

function firstWorkbenchEdge(model: WorkbenchModel): WorkbenchModel["edges"][number] {
  const edge = model.edges[0];
  if (edge === undefined) throw new Error("Fixture must include at least one workbench edge");
  return edge;
}
