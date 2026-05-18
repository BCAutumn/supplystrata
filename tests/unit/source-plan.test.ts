import { describe, expect, it } from "vitest";
import { planSourcesForComponent, planSourcesForComponents } from "@supplystrata/source-plan";

describe("source-plan", () => {
  it("maps wafer upstream leads to official, material, and trade sources without promoting macro data to fact edges", () => {
    const plan = planSourcesForComponent("COMP-WAFER", 2);
    const byId = new Map(plan.map((item) => [item.source_id, item]));

    expect(byId.get("asml-ir")?.relation_policy).toBe("can_create_fact_edge");
    expect(byId.get("usgs-mcs")?.expected_output_layer).toBe("observation");
    expect(byId.get("un-comtrade")?.relation_policy).toBe("observation_only");
    expect(byId.get("census-trade")?.relation_policy).toBe("observation_only");
    expect(byId.get("usgs-mcs")?.target_ids).toContain("COMP-SILICON-WAFER");
  });

  it("keeps memory supplier plan entries connected to registered free source definitions", () => {
    const plan = planSourcesForComponent("COMP-MEMORY", 2);
    const byId = new Map(plan.map((item) => [item.source_id, item]));

    expect(byId.get("micron-ir")?.status).toBe("scoped");
    expect(byId.get("micron-ir")?.relation_policy).toBe("can_create_fact_edge");
    expect(byId.get("micron-ir")?.expected_output_layer).toBe("edge");
  });

  it("routes manufacturing-service leads to facility, procurement, logistics, and manual BOL sources without Apple coupling by default", () => {
    const plan = planSourcesForComponent("COMP-MANUFACTURING-SERVICES", 3);
    const byId = new Map(plan.map((item) => [item.source_id, item]));

    expect(byId.has("apple-suppliers")).toBe(false);
    expect(byId.get("osh")?.expected_output_layer).toBe("observation");
    expect(byId.get("noaa-ais")?.expected_output_layer).toBe("observation");
    expect(byId.get("sam-gov")?.expected_output_layer).toBe("lead");
    expect(byId.get("import-yeti")?.relation_policy).toBe("lead_only");
  });

  it("includes Apple Supplier List only when the caller is explicitly planning an Apple chain", () => {
    const plan = planSourcesForComponent("COMP-MANUFACTURING-SERVICES", 3, ["ENT-APPLE"]);
    const apple = plan.find((item) => item.source_id === "apple-suppliers");

    expect(apple?.expected_output_layer).toBe("edge");
    expect(apple?.parent_component_ids).toContain("COMP-MANUFACTURING-SERVICES");
  });

  it("aggregates duplicated sources across multiple component inputs", () => {
    const plan = planSourcesForComponents({ component_ids: ["COMP-WAFER", "COMP-MANUFACTURING-SERVICES"], maxTierDepth: 2 });
    const sourceIds = plan.map((item) => item.source_id);

    expect(sourceIds.filter((sourceId) => sourceId === "census-trade")).toHaveLength(1);
    expect(plan.find((item) => item.source_id === "census-trade")?.target_ids.length).toBeGreaterThan(1);
  });
});
