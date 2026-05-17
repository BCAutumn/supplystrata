import { describe, expect, it } from "vitest";
import { segmentsFromFactRow } from "@supplystrata/chain-view";

describe("chain-view", () => {
  it("keeps fact edges and claims as separate semantic segments", () => {
    const row = {
      depth: 1,
      edge_id: "EDGE-1",
      relation: "BUYS_FROM",
      subject_id: "ENT-NVIDIA",
      subject_name: "NVIDIA",
      object_id: "ENT-SK-HYNIX",
      object_name: "SK hynix",
      upstream_id: "ENT-SK-HYNIX",
      upstream_name: "SK hynix",
      component: "memory",
      component_id: "COMP-MEMORY",
      evidence_level: 5,
      confidence: 0.93,
      primary_evidence_id: "EV-1",
      claim_id: "CLM-1",
      claim_text: "NVIDIA publicly discloses that it buys memory from SK hynix."
    } satisfies Parameters<typeof segmentsFromFactRow>[0];

    const segments = segmentsFromFactRow(row, 0);

    expect(segments).toHaveLength(2);
    expect(segments[0]?.semantic_layer).toBe("edge");
    expect(segments[0]?.edge_id).toBe("EDGE-1");
    expect(segments[1]?.semantic_layer).toBe("claim");
    expect(segments[1]?.claim_id).toBe("CLM-1");
    expect(segments[1]?.label).toBe("NVIDIA publicly discloses that it buys memory from SK hynix.");
  });

  it("omits claim segments when no active claim exists for the edge", () => {
    const row = {
      depth: 1,
      edge_id: "EDGE-2",
      relation: "USES_FOUNDRY",
      subject_id: "ENT-NVIDIA",
      subject_name: "NVIDIA",
      object_id: "ENT-TSMC",
      object_name: "TSMC",
      upstream_id: "ENT-TSMC",
      upstream_name: "TSMC",
      component: "GPU wafer fabrication",
      component_id: "COMP-WAFER",
      evidence_level: 5,
      confidence: 0.91,
      primary_evidence_id: "EV-2",
      claim_id: null,
      claim_text: null
    } satisfies Parameters<typeof segmentsFromFactRow>[0];

    const segments = segmentsFromFactRow(row, 3);

    expect(segments).toHaveLength(1);
    expect(segments[0]?.sequence_index).toBe(6);
    expect(segments[0]?.semantic_layer).toBe("edge");
  });
});
