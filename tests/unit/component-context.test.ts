import { describe, expect, it } from "vitest";
import {
  findComponentTradeCode,
  listComponentHsCodes,
  listComponentMaterialExposures,
  listComponentMaterialObservationTargets,
  listComponentTradeTaxonomies,
  listMaterialObservationTargets,
  listMaterialTaxonomies,
  listComponentUpstreamLeads,
  listKnownComponentContextIds,
  listKnownComponentTradeTaxonomyIds
} from "@supplystrata/component-context";

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

  it("loads HS proxy codes for component trade observations", () => {
    const memoryCodes = listComponentHsCodes("COMP-MEMORY");
    const waferCodes = listComponentHsCodes("COMP-SILICON-WAFER");

    expect(memoryCodes.map((item) => item.code)).toContain("854232");
    expect(waferCodes.map((item) => item.code)).toContain("381800");
    expect(memoryCodes.every((item) => item.proxy_only)).toBe(true);
    expect(memoryCodes.every((item) => item.confidence > 0 && item.confidence < 1)).toBe(true);
  });

  it("keeps material exposure separate from trade-code observations", () => {
    const hbmMaterials = listComponentMaterialExposures("COMP-HBM");

    expect(hbmMaterials.map((item) => item.material_id)).toContain("MAT-SILICON");
    expect(hbmMaterials.map((item) => item.material_id)).toContain("MAT-COPPER");
    expect(hbmMaterials.every((item) => item.source_suggestions.length > 0)).toBe(true);
  });

  it("finds taxonomy records by component and code without inventing missing mappings", () => {
    expect(findComponentTradeCode("COMP-HBM", "854232")?.description).toContain("memories");
    expect(findComponentTradeCode("COMP-HBM", "999999")).toBeUndefined();
    expect(listKnownComponentTradeTaxonomyIds()).toContain("COMP-POWER-SUPPLY");
    expect(listComponentTradeTaxonomies().length).toBeGreaterThan(5);
  });

  it("loads material observation targets for USGS and World Bank source planning", () => {
    const copperTargets = listMaterialObservationTargets("MAT-COPPER");
    const hbmTargets = listComponentMaterialObservationTargets("COMP-HBM");

    expect(copperTargets.map((item) => item.source_adapter_id)).toContain("usgs-mcs");
    expect(copperTargets.map((item) => item.source_adapter_id)).toContain("worldbank-pink");
    expect(copperTargets.find((item) => item.source_adapter_id === "worldbank-pink")?.runnable).toBe(true);
    expect(copperTargets.find((item) => item.source_adapter_id === "usgs-mcs")?.runnable).toBe(false);
    expect(hbmTargets.map((item) => item.material.material_id)).toContain("MAT-COPPER");
    expect(listMaterialTaxonomies().map((item) => item.material_id)).toContain("MAT-SILICON");
  });
});
