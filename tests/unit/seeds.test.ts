import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { describe, expect, it } from "vitest";

interface EntitySeedRow {
  entity_id: string;
  kind: string;
  canonical_name: string;
}

describe("seed files", () => {
  it("contain the required MVP core and bridge entity counts", async () => {
    const rows = await readSeed<EntitySeedRow>("seeds/entities.csv");
    const ids = new Set(rows.map((row) => row.entity_id));
    expect(ids.has("ENT-NVIDIA")).toBe(true);
    expect(ids.has("ENT-SAMSUNG-FOUNDRY")).toBe(true);
    expect(ids.has("ENT-SAMSUNG-MEMORY")).toBe(true);
    expect(ids.has("ENT-SAMSUNG-ELECTRONICS")).toBe(true);
    expect(ids.has("ENT-3M")).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(55);
  });
});

async function readSeed<T extends object>(path: string): Promise<T[]> {
  const text = await readFile(resolve(process.cwd(), path), "utf8");
  return parse(text, { columns: true, skip_empty_lines: true, bom: true }) as T[];
}
