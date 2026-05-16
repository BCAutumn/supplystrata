import { describe, expect, it } from "vitest";
import { SeedEntityResolver } from "@supplystrata/entity-resolver";

describe("SeedEntityResolver", () => {
  it("resolves seeded aliases without Postgres", async () => {
    const resolver = await SeedEntityResolver.fromCsv();
    const tsmc = await resolver.resolve({ surface: "Taiwan Semiconductor Manufacturing Company Limited" });
    const threeM = await resolver.resolve({ surface: "3M" });
    expect(tsmc).toMatchObject({ status: "resolved", entity_id: "ENT-TSMC" });
    expect(threeM).toMatchObject({ status: "resolved", entity_id: "ENT-3M" });
  });

  it("uses nearby text to split Samsung business units", async () => {
    const resolver = await SeedEntityResolver.fromCsv();
    const foundry = await resolver.resolve({ surface: "Samsung", context: { nearby_text: "produce our semiconductor wafers at foundries" } });
    const memory = await resolver.resolve({ surface: "Samsung", context: { nearby_text: "purchase memory and HBM" } });
    expect(foundry).toMatchObject({ status: "resolved", entity_id: "ENT-SAMSUNG-FOUNDRY" });
    expect(memory).toMatchObject({ status: "resolved", entity_id: "ENT-SAMSUNG-MEMORY" });
  });
});
