import { describe, expect, it } from "vitest";
import { collectResearchComponentIds, researchPackUnknownMapTargets, resolveResearchPackWriteSteps, safeFileSegment } from "@supplystrata/research-pack";
import type { ChainViewSegmentModel } from "@supplystrata/chain-view";

describe("research-pack basics", () => {
  it("keeps research-pack write steps opt-in", () => {
    expect(resolveResearchPackWriteSteps({})).toEqual({
      buildClaims: false,
      refreshIntelligence: false,
      refreshComponentRisk: false,
      materializeRootUnknowns: false
    });
    expect(
      resolveResearchPackWriteSteps({
        buildClaims: true,
        refreshIntelligence: true,
        refreshComponentRisk: true,
        materializeRootUnknowns: true
      })
    ).toEqual({
      buildClaims: true,
      refreshIntelligence: true,
      refreshComponentRisk: true,
      materializeRootUnknowns: true
    });
  });

  it("collects explicit components and chain components into a stable research set", () => {
    const segments: ChainViewSegmentModel[] = [
      {
        sequence_index: 0,
        depth: 1,
        semantic_layer: "edge",
        from: { kind: "company", id: "ENT-NVIDIA", name: "NVIDIA" },
        to: { kind: "company", id: "ENT-SKHYNIX", name: "SK Hynix" },
        relation: "BUYS_FROM",
        component: "memory",
        component_id: "COMP-MEMORY",
        edge_id: "EDGE-1",
        evidence_ids: ["EV-1"],
        evidence_level: 5,
        confidence: 0.95,
        label: "NVIDIA buys memory from SK Hynix"
      }
    ];

    expect(collectResearchComponentIds({ chain_segments: segments }, ["COMP-HBM", " COMP-MEMORY "])).toEqual(["COMP-HBM", "COMP-MEMORY"]);
  });

  it("creates safe deterministic file segments", () => {
    expect(safeFileSegment("COMP-HBM")).toBe("comp-hbm");
    expect(safeFileSegment("HBM / Advanced Packaging")).toBe("hbm-advanced-packaging");
  });

  it("requires a root unknown only when the selected company has no L4/L5 fact edge", () => {
    expect(
      researchPackUnknownMapTargets({
        selected_company_id: "ENT-FOXCONN",
        edges: [{ from_id: "ENT-NVIDIA", to_id: "ENT-FOXCONN", evidence_level: 5 }]
      })
    ).toEqual([]);

    expect(
      researchPackUnknownMapTargets({
        selected_company_id: "ENT-SAMSUNG-ELECTRONICS",
        edges: [{ from_id: "ENT-NVIDIA", to_id: "ENT-SAMSUNG-MEMORY", evidence_level: 5 }]
      })
    ).toEqual([{ scope_id: "ENT-SAMSUNG-ELECTRONICS", minimum_open_items: 1 }]);

    expect(
      researchPackUnknownMapTargets({
        selected_company_id: "ENT-SAMSUNG-MEMORY",
        root_unknown_materialization: { companies_with_l4_l5_edges: 1 },
        edges: []
      })
    ).toEqual([]);
  });
});
