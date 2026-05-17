import { describe, expect, it } from "vitest";
import { renderChainCard } from "@supplystrata/render";

describe("Chain renderer", () => {
  it("renders semantic chain segments by depth", () => {
    const output = renderChainCard(
      {
        schema_version: "1.0.0",
        view_type: "company_chain",
        root: { kind: "company", id: "ENT-NVIDIA", name: "NVIDIA" },
        max_depth: 2,
        generated_by: "unit-test",
        segments: [
          {
            sequence_index: 0,
            depth: 1,
            semantic_layer: "edge",
            from: { kind: "company", id: "ENT-NVIDIA", name: "NVIDIA" },
            to: { kind: "company", id: "ENT-SKHYNIX", name: "SK Hynix" },
            edge_id: "EDGE-1",
            relation: "BUYS_FROM",
            component: "memory",
            component_id: "COMP-MEMORY",
            evidence_ids: ["EV-1"],
            evidence_level: 5,
            confidence: 0.94,
            label: "NVIDIA -BUYS_FROM-> SK Hynix"
          },
          {
            sequence_index: 1,
            depth: 0,
            semantic_layer: "observation",
            from: { kind: "company", id: "ENT-NVIDIA", name: "NVIDIA" },
            to: { kind: "component", id: "COMP-MEMORY", name: "COMP-MEMORY" },
            observation_id: "OBS-1",
            relation: "OBSERVES",
            component: null,
            component_id: "COMP-MEMORY",
            evidence_ids: [],
            confidence: 0.7,
            label: "INVENTORY_OBSERVATION: inventory_days = 42 days"
          }
        ],
        stats: {
          fact_edges: 1,
          claims: 0,
          observations: 1,
          leads: 0,
          unknowns: 0
        }
      },
      "markdown"
    );

    expect(output).toContain("# Supply Chain NVIDIA [ENT-NVIDIA]");
    expect(output).toContain("Fact edges: 1");
    expect(output).toContain("edge depth 1: NVIDIA -BUYS_FROM (memory)-> SK Hynix");
    expect(output).toContain("To: SK Hynix [ENT-SKHYNIX]");
    expect(output).toContain("observation depth 0: NVIDIA -OBSERVES-> COMP-MEMORY");
    expect(output).toContain("Context, conf 0.700");
    expect(output).toContain("Observation: OBS-1");
  });
});
