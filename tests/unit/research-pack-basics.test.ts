import { describe, expect, it } from "vitest";
import {
  collectResearchComponentIds,
  listAnchorResearchTargetProfiles,
  researchPackUnknownMapTargets,
  resolveResearchPackWriteSteps,
  safeFileSegment,
  selectResearchTargetProfile
} from "@supplystrata/research-pack";
import type { ChainViewSegmentModel } from "@supplystrata/chain-view";
import type { ComponentRiskRefreshSummary } from "@supplystrata/evidence-maintenance";
import { decorateComponentRiskRefreshSummary, summarizeComponentRiskRefresh } from "../../packages/research-pack/src/prepare-data.js";

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

  it("keeps anchor target profiles as optional validation anchors, not a default product boundary", () => {
    const genericSelection = selectResearchTargetProfile({ company_id: "ENT-GENERIC-LISTED-COMPANY", component_ids: [] });
    expect(genericSelection.layer).toBe("derived");
    expect(genericSelection.reason).toBe("No anchor research target profile matched this company/component scope; runtime derive is required.");
    expect(genericSelection.profile).not.toBeNull();
    if (genericSelection.profile === null) throw new Error("Expected generic listed company to use derived placeholder.");
    expect(genericSelection.profile.layer).toBe("derived");
    if (genericSelection.profile.layer !== "derived") throw new Error("Expected generic listed company profile to be a derived placeholder.");
    expect(genericSelection.profile.profile_id).toBe("derived.runtime.v0");
    expect(genericSelection.profile.target_nodes).toEqual([]);
    expect(genericSelection.profile.derivation).toMatchObject({ status: "placeholder", company_id: "ENT-GENERIC-LISTED-COMPANY" });

    expect(selectResearchTargetProfile({ company_id: "ENT-NVIDIA", component_ids: [], profile_id: "none" })).toEqual({
      profile: null,
      layer: "none",
      reason: "Research target profile disabled by caller."
    });

    const nvidiaSelection = selectResearchTargetProfile({ company_id: "ENT-NVIDIA", component_ids: [] });
    expect(nvidiaSelection.layer).toBe("anchor");
    expect(nvidiaSelection.profile?.layer).toBe("anchor");
    expect(selectResearchTargetProfile({ company_id: "ENT-GENERIC-LISTED-COMPANY", component_ids: ["COMP-PCB"] }).profile?.profile_id).toBe(
      "ai-compute-memory.v0"
    );
    expect(selectResearchTargetProfile({ company_id: "ENT-TESLA", component_ids: [] }).profile?.profile_id).toBe("ev-battery-energy.v0");
    expect(selectResearchTargetProfile({ company_id: "ENT-GENERIC-LISTED-COMPANY", component_ids: ["COMP-BATTERY-CELL"] }).profile?.profile_id).toBe(
      "ev-battery-energy.v0"
    );
  });

  it("returns cloned anchor target profiles so callers cannot mutate registry state", () => {
    const firstRead = listAnchorResearchTargetProfiles()[0];
    expect(firstRead).toBeDefined();
    firstRead?.applies_to_company_ids.push("ENT-MUTATED");

    const secondRead = listAnchorResearchTargetProfiles()[0];
    expect(secondRead?.applies_to_company_ids).not.toContain("ENT-MUTATED");
  });

  it("keeps component risk global scope separate from research-pack visible edges", () => {
    const globalMemoryRisk = decorateComponentRiskRefreshSummary(componentRiskSummary("COMP-MEMORY", 3), new Map([["COMP-MEMORY", 0]]));
    const visiblePcbRisk = decorateComponentRiskRefreshSummary(componentRiskSummary("COMP-PCB", 5), new Map([["COMP-PCB", 2]]));

    const summary = summarizeComponentRiskRefresh({
      componentIds: ["COMP-MEMORY", "COMP-PCB", "COMP-WAFER"],
      refreshableComponentIds: ["COMP-MEMORY", "COMP-PCB"],
      components: [globalMemoryRisk, visiblePcbRisk],
      generatedBy: "unit-test"
    });

    expect(summary.scope_kind).toBe("component_global");
    expect(summary.edge_count).toBe(8);
    expect(summary.research_pack_visible_edge_count).toBe(2);
    expect(summary.components[0]?.research_pack_visible_edge_count).toBe(0);
    expect(summary.components[1]?.research_pack_visible_edge_count).toBe(2);
    expect(summary.interpretation).toContain("component-global scope");
  });
});

function componentRiskSummary(componentId: string, edgeCount: number): ComponentRiskRefreshSummary {
  return {
    risk_view_id: `RISK-${componentId}`,
    component_id: componentId,
    metrics: 4,
    edge_count: edgeCount,
    supplier_count: 2,
    share_unknown: componentId === "COMP-PCB",
    risk_changes_recorded: 1,
    model_version: "component-risk-baseline.v1",
    inputs_fingerprint: `fingerprint-${componentId}`
  };
}
