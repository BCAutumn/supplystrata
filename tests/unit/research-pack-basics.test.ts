import { describe, expect, it } from "vitest";
import {
  collectResearchComponentIds,
  listBuiltInResearchTargetProfiles,
  researchPackUnknownMapTargets,
  resolveResearchPackWriteSteps,
  safeFileSegment,
  selectResearchTargetProfile
} from "@supplystrata/research-pack";
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

  it("keeps built-in target profiles as optional validation anchors, not a default product boundary", () => {
    expect(selectResearchTargetProfile({ company_id: "ENT-GENERIC-LISTED-COMPANY", component_ids: [] })).toEqual({
      profile: null,
      reason: "No built-in research target profile matched this company/component scope."
    });

    expect(selectResearchTargetProfile({ company_id: "ENT-NVIDIA", component_ids: [], profile_id: "none" })).toEqual({
      profile: null,
      reason: "Research target profile disabled by caller."
    });

    expect(selectResearchTargetProfile({ company_id: "ENT-GENERIC-LISTED-COMPANY", component_ids: ["COMP-PCB"] }).profile?.profile_id).toBe(
      "ai-compute-memory.v0"
    );
  });

  it("returns cloned built-in target profiles so callers cannot mutate registry state", () => {
    const firstRead = listBuiltInResearchTargetProfiles()[0];
    expect(firstRead).toBeDefined();
    firstRead?.applies_to_company_ids.push("ENT-MUTATED");

    const secondRead = listBuiltInResearchTargetProfiles()[0];
    expect(secondRead?.applies_to_company_ids).not.toContain("ENT-MUTATED");
  });
});
