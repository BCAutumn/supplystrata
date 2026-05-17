import { describe, expect, it } from "vitest";
import { workbenchEdgeFromSegment } from "@supplystrata/workbench-export";
import type { ChainViewSegmentModel } from "@supplystrata/chain-view";

describe("workbench-export", () => {
  it("converts fact edge segments into workbench edges", () => {
    const segment: ChainViewSegmentModel = {
      sequence_index: 0,
      depth: 1,
      semantic_layer: "edge",
      from: { kind: "company", id: "ENT-NVIDIA", name: "NVIDIA" },
      to: { kind: "company", id: "ENT-TSMC", name: "TSMC" },
      relation: "USES_FOUNDRY",
      component: "foundry services",
      component_id: "COMP-FOUNDRY",
      edge_id: "EDGE-1",
      evidence_ids: ["EV-1"],
      evidence_level: 5,
      confidence: 0.93,
      label: "NVIDIA -USES_FOUNDRY-> TSMC"
    };

    expect(workbenchEdgeFromSegment(segment)).toEqual({
      edge_id: "EDGE-1",
      from_id: "ENT-NVIDIA",
      from_name: "NVIDIA",
      to_id: "ENT-TSMC",
      to_name: "TSMC",
      relation: "USES_FOUNDRY",
      component: "foundry services",
      component_id: "COMP-FOUNDRY",
      evidence_level: 5,
      confidence: 0.93,
      evidence_ids: ["EV-1"]
    });
  });

  it("rejects observation segments as workbench fact edges", () => {
    const segment: ChainViewSegmentModel = {
      sequence_index: 1,
      depth: 0,
      semantic_layer: "observation",
      from: { kind: "company", id: "ENT-NVIDIA", name: "NVIDIA" },
      to: { kind: "component", id: "COMP-MEMORY", name: "COMP-MEMORY" },
      relation: "OBSERVES",
      component: null,
      component_id: "COMP-MEMORY",
      observation_id: "OBS-1",
      evidence_ids: [],
      confidence: 0.7,
      label: "INVENTORY_OBSERVATION: inventory_days = 42 days"
    };

    expect(() => workbenchEdgeFromSegment(segment)).toThrow("Segment is not a fact edge");
  });
});
