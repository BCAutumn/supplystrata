import { describe, expect, it } from "vitest";
import { listComponentUpstreamLeads, listKnownComponentContextIds } from "@supplystrata/component-context";

describe("component-context", () => {
  it("loads deterministic upstream research leads for wafer chains", () => {
    const leads = listComponentUpstreamLeads("COMP-WAFER", 2);

    expect(leads.map((lead) => lead.target_id)).toContain("COMP-SILICON-WAFER");
    expect(leads.map((lead) => lead.target_id)).toContain("COMP-EUV-LITHOGRAPHY");
    expect(leads.map((lead) => lead.target_id)).toContain("COMP-PHOTORESIST");
    expect(leads.every((lead) => lead.parent_component_id === "COMP-WAFER")).toBe(true);
    expect(leads.every((lead) => lead.confidence > 0 && lead.confidence < 1)).toBe(true);
  });

  it("respects tier depth without inventing deeper context", () => {
    const shallow = listComponentUpstreamLeads("COMP-WAFER", 1);

    expect(shallow.map((lead) => lead.target_id)).toContain("COMP-SILICON-WAFER");
    expect(shallow.map((lead) => lead.target_id)).not.toContain("COMP-PHOTORESIST");
  });

  it("exposes component ids that should exist in seeds", () => {
    expect(listKnownComponentContextIds()).toContain("COMP-ADVANCED-PACKAGING");
    expect(listKnownComponentContextIds()).toContain("COMP-ABF-SUBSTRATE");
  });
});
