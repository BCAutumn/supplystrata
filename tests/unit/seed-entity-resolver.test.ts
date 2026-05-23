import { describe, expect, it } from "vitest";
import { SeedEntityResolver } from "@supplystrata/entity-resolver";

describe("SeedEntityResolver", () => {
  it("resolves seeded aliases without Postgres", async () => {
    const resolver = await SeedEntityResolver.fromCsv(process.cwd());
    const tsmc = await resolver.resolve({ surface: "Taiwan Semiconductor Manufacturing Company Limited" });
    const threeM = await resolver.resolve({ surface: "3M" });
    const nvda = await resolver.resolve({ surface: "NVDA" });
    expect(tsmc).toMatchObject({ status: "resolved", entity_id: "ENT-TSMC" });
    expect(threeM).toMatchObject({ status: "resolved", entity_id: "ENT-3M" });
    expect(nvda).toMatchObject({ status: "resolved", entity_id: "ENT-NVIDIA" });
  });

  it("uses nearby text to split Samsung business units", async () => {
    const resolver = await SeedEntityResolver.fromCsv(process.cwd());
    const foundry = await resolver.resolve({ surface: "Samsung", context: { nearby_text: "produce our semiconductor wafers at foundries" } });
    const memory = await resolver.resolve({ surface: "Samsung", context: { nearby_text: "purchase memory and HBM" } });
    const isolated = await resolver.resolve({ surface: "Samsung" });
    expect(foundry).toMatchObject({ status: "resolved", entity_id: "ENT-SAMSUNG-FOUNDRY" });
    expect(memory).toMatchObject({ status: "resolved", entity_id: "ENT-SAMSUNG-MEMORY" });
    expect(isolated).toMatchObject({ status: "ambiguous", needs_human_review: true });
    expect(isolated.candidates?.map((candidate) => candidate.entity_id)).toEqual(
      expect.arrayContaining(["ENT-SAMSUNG-ELECTRONICS", "ENT-SAMSUNG-FOUNDRY", "ENT-SAMSUNG-MEMORY", "ENT-SAMSUNG-DISPLAY"])
    );
  });

  it("keeps Foxconn family subsidiaries explainable by context", async () => {
    const resolver = await SeedEntityResolver.fromCsv(process.cwd());
    const parent = await resolver.resolve({ surface: "Foxconn" });
    const fii = await resolver.resolve({ surface: "Foxconn", context: { nearby_text: "Foxconn Industrial Internet and FII server manufacturing capacity" } });
    const fih = await resolver.resolve({ surface: "FIH", context: { nearby_text: "mobile handset assembly" } });
    const usPlant = await resolver.resolve({ surface: "Foxconn", context: { nearby_text: "Ohio and Wisconsin manufacturing facilities" } });
    expect(parent).toMatchObject({ status: "resolved", entity_id: "ENT-FOXCONN" });
    expect(fii).toMatchObject({ status: "resolved", entity_id: "ENT-FOXCONN-FII" });
    expect(fih).toMatchObject({ status: "resolved", entity_id: "ENT-FIH-MOBILE" });
    expect(usPlant).toMatchObject({ status: "ambiguous", needs_human_review: true });
  });

  it("resolves TSMC subsidiaries only when context names them", async () => {
    const resolver = await SeedEntityResolver.fromCsv(process.cwd());
    const parent = await resolver.resolve({ surface: "TSMC" });
    const arizona = await resolver.resolve({ surface: "TSMC", context: { nearby_text: "Arizona fab expansion" } });
    const jasm = await resolver.resolve({ surface: "TSMC", context: { nearby_text: "JASM Kumamoto fab" } });
    expect(parent).toMatchObject({ status: "resolved", entity_id: "ENT-TSMC" });
    expect(arizona).toMatchObject({ status: "resolved", entity_id: "ENT-TSMC-ARIZONA" });
    expect(jasm).toMatchObject({ status: "resolved", entity_id: "ENT-JASM" });
  });

  it("never auto-resolves fuzzy alias candidates", async () => {
    const resolver = await SeedEntityResolver.fromCsv(process.cwd());
    const micron = await resolver.resolve({ surface: "Micron Technolog" });
    const short = await resolver.resolve({ surface: "Mic" });
    expect(micron).toMatchObject({ status: "ambiguous", needs_human_review: true });
    expect(micron.candidates?.map((candidate) => candidate.entity_id)).toContain("ENT-MICRON");
    expect(short).toMatchObject({ status: "unknown", needs_human_review: true });
  });
});
