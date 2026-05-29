import { describe, expect, it } from "vitest";
import { listAnchorResearchTargetProfiles, selectResearchTargetProfile } from "@supplystrata/research-pack";

describe("research target profile registry layers", () => {
  it("selects Layer A anchors for exact company and component scope matches", () => {
    const companySelection = selectResearchTargetProfile({ company_id: "ENT-NVIDIA", component_ids: [] });
    const componentSelection = selectResearchTargetProfile({ company_id: "ENT-GENERIC-LISTED-COMPANY", component_ids: ["COMP-BATTERY-CELL"] });

    expect(companySelection).toMatchObject({
      layer: "anchor",
      profile: {
        layer: "anchor",
        profile_id: "ai-compute-memory.v0"
      }
    });
    expect(componentSelection).toMatchObject({
      layer: "anchor",
      profile: {
        layer: "anchor",
        profile_id: "ev-battery-energy.v0"
      }
    });
  });

  it("returns a Layer B derived placeholder when no anchor matches", () => {
    const selection = selectResearchTargetProfile({ company_id: "ENT-LVMH", component_ids: [] });

    expect(selection).toMatchObject({
      layer: "derived",
      reason: "No anchor research target profile matched this company/component scope; runtime derive is required.",
      profile: {
        layer: "derived",
        profile_id: "derived.runtime.v0",
        applies_to_company_ids: ["ENT-LVMH"],
        target_nodes: [],
        derivation: {
          status: "placeholder",
          company_id: "ENT-LVMH",
          component_ids: []
        }
      }
    });
  });

  it("disables both anchor and derived layers with profile none", () => {
    expect(selectResearchTargetProfile({ company_id: "ENT-NVIDIA", component_ids: ["COMP-HBM"], profile_id: "none" })).toEqual({
      profile: null,
      layer: "none",
      reason: "Research target profile disabled by caller."
    });
  });

  it("lists only Layer A anchor profiles through the anchor registry", () => {
    expect(listAnchorResearchTargetProfiles().map((profile) => `${profile.layer}:${profile.profile_id}`)).toEqual([
      "anchor:ai-compute-memory.v0",
      "anchor:ev-battery-energy.v0"
    ]);
  });
});
