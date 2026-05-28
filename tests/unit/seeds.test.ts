import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { describe, expect, it } from "vitest";
import { listKnownComponentContextIds, listKnownComponentTradeTaxonomyIds } from "@supplystrata/component-context";

interface EntitySeedRow {
  entity_id: string;
  kind: string;
  canonical_name: string;
}

interface ComponentSeedRow {
  component_id: string;
  name: string;
}

describe("seed files", () => {
  it("contain the required MVP core and bridge entity counts", async () => {
    const rows = await readSeed<EntitySeedRow>("tests/fixtures/dev-entities/entities.csv");
    const ids = new Set(rows.map((row) => row.entity_id));
    expect(ids.has("ENT-NVIDIA")).toBe(true);
    expect(ids.has("ENT-SAMSUNG-FOUNDRY")).toBe(true);
    expect(ids.has("ENT-SAMSUNG-MEMORY")).toBe(true);
    expect(ids.has("ENT-SAMSUNG-ELECTRONICS")).toBe(true);
    expect(ids.has("ENT-3M")).toBe(true);
    expect(ids.has("ENT-COMPEQ")).toBe(true);
    expect(ids.has("ENT-JX-NIPPON-MINING-METALS")).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(70);
  });

  it("cover every component id used by deterministic Gate 1 context", async () => {
    const rows = await readSeed<ComponentSeedRow>("seeds/components.csv");
    const seededIds = new Set(rows.map((row) => row.component_id));
    const requiredIds = new Set([...listKnownComponentContextIds(), ...listKnownComponentTradeTaxonomyIds()].filter((id) => id.startsWith("COMP-")));

    for (const componentId of requiredIds) {
      expect(seededIds.has(componentId), `missing seed component ${componentId}`).toBe(true);
    }
  });
});

async function readSeed<T extends object>(path: string): Promise<T[]> {
  const text = await readFile(resolve(process.cwd(), path), "utf8");
  return parse(text, { columns: true, skip_empty_lines: true, bom: true }) as T[];
}
