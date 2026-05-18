import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseStore, migrate, seedFromCsv, type DatabaseStore } from "@supplystrata/db";
import { DbEntityResolver } from "@supplystrata/entity-resolver";
import { canConnectToIntegrationDatabase } from "./helpers.js";

const hasDatabase = await canConnectToIntegrationDatabase();

describe.skipIf(!hasDatabase)("DbEntityResolver", () => {
  const pool: DatabaseStore = createDatabaseStore();

  beforeAll(async () => {
    await migrate(pool);
    await seedFromCsv(pool);
  });

  afterAll(async () => {
    await pool.close();
  });

  it("resolves exact official aliases and identifiers from the seeded database", async () => {
    const resolver = new DbEntityResolver(pool);
    const threeM = await resolver.resolve({ surface: "3M" });
    const nvidiaTicker = await resolver.resolve({ surface: "NVIDIA", identifiers: { ticker: "NVDA" } });
    const nvidiaCik = await resolver.resolve({ surface: "NVIDIA Corporation", identifiers: { cik: "0001045810" } });

    expect(threeM).toMatchObject({ status: "resolved", entity_id: "ENT-3M" });
    expect(nvidiaTicker).toMatchObject({ status: "resolved", entity_id: "ENT-NVIDIA", confidence: 1 });
    expect(nvidiaCik).toMatchObject({ status: "resolved", entity_id: "ENT-NVIDIA", confidence: 1 });
  });

  it("keeps fuzzy database matches out of auto-resolved graph writes", async () => {
    const resolver = new DbEntityResolver(pool);
    const micron = await resolver.resolve({ surface: "Micron Technolog" });
    const short = await resolver.resolve({ surface: "Mic" });

    expect(micron).toMatchObject({ status: "ambiguous", needs_human_review: true });
    expect(micron.candidates?.map((candidate) => candidate.entity_id)).toContain("ENT-MICRON");
    expect(short).toMatchObject({ status: "unknown", needs_human_review: true });
  });

  it("applies hard-coded family rules before generic alias matching", async () => {
    const resolver = new DbEntityResolver(pool);
    const samsung = await resolver.resolve({ surface: "Samsung", context: { nearby_text: "purchase memory and HBM" } });
    const foxconn = await resolver.resolve({ surface: "Foxconn", context: { nearby_text: "Foxconn Industrial Internet server production" } });
    const tsmcArizona = await resolver.resolve({ surface: "TSMC", context: { nearby_text: "Arizona fab expansion" } });

    expect(samsung).toMatchObject({ status: "resolved", entity_id: "ENT-SAMSUNG-MEMORY" });
    expect(foxconn).toMatchObject({ status: "resolved", entity_id: "ENT-FOXCONN-FII" });
    expect(tsmcArizona).toMatchObject({ status: "resolved", entity_id: "ENT-TSMC-ARIZONA" });
  });
});
