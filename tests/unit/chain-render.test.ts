import { describe, expect, it } from "vitest";
import { renderChainCard } from "@supplystrata/render";

describe("Chain renderer", () => {
  it("renders upstream edges by depth", () => {
    const output = renderChainCard(
      {
        root: {
          entity_id: "ENT-NVIDIA",
          canonical_name: "NVIDIA Corporation",
          display_name: "NVIDIA"
        },
        max_depth: 2,
        edges: [
          {
            depth: 1,
            edge_id: "EDGE-1",
            relation: "BUYS_FROM",
            subject_id: "ENT-NVIDIA",
            subject_name: "NVIDIA",
            object_id: "ENT-SKHYNIX",
            object_name: "SK Hynix",
            upstream_id: "ENT-SKHYNIX",
            upstream_name: "SK Hynix",
            component: "memory",
            component_id: "COMP-MEMORY",
            evidence_level: 5,
            confidence: 0.94,
            primary_evidence_id: "EV-1",
            cite_text: "We purchase memory from SK Hynix."
          }
        ]
      },
      "markdown"
    );

    expect(output).toContain("# Supply Chain NVIDIA [ENT-NVIDIA]");
    expect(output).toContain("depth 1: NVIDIA -BUYS_FROM (memory)-> SK Hynix");
    expect(output).toContain("Upstream node: SK Hynix [ENT-SKHYNIX]");
  });
});
