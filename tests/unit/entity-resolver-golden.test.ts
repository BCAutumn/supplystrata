import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { describe, expect, it } from "vitest";
import { normalizeAlias } from "@supplystrata/core";
import { SeedEntityResolver } from "@supplystrata/entity-resolver";

interface EntityGoldenRow {
  entity_id: string;
  canonical_name: string;
  display_name: string;
  tickers: string;
  status: string;
}

interface AliasGoldenRow {
  entity_id: string;
  alias: string;
  alias_kind: string;
  status: string;
}

interface GoldenCase {
  surface: string;
  expectedEntityId: string;
  identifiers?: { ticker?: string; cik?: string };
}

describe("SeedEntityResolver golden set", () => {
  it("resolves a seed-derived golden set above the Phase 2 floor", async () => {
    const resolver = await SeedEntityResolver.fromDevFixtures(process.cwd());
    const cases = await buildGoldenCases();

    expect(cases.length).toBeGreaterThanOrEqual(200);
    for (const item of cases) {
      const result = await resolver.resolve({
        surface: item.surface,
        ...(item.identifiers === undefined ? {} : { identifiers: item.identifiers })
      });
      expect(result, item.surface).toMatchObject({
        status: "resolved",
        entity_id: item.expectedEntityId
      });
    }
  });

  it("keeps high-risk ambiguous and fuzzy cases out of auto-resolved graph writes", async () => {
    const resolver = await SeedEntityResolver.fromDevFixtures(process.cwd());
    const samsung = await resolver.resolve({ surface: "Samsung" });
    const samsungMemory = await resolver.resolve({
      surface: "Samsung",
      context: { nearby_text: "HBM memory DRAM supply" }
    });
    const samsungFoundry = await resolver.resolve({
      surface: "Samsung",
      context: { nearby_text: "wafer foundry fabrication" }
    });
    const foxconnUs = await resolver.resolve({
      surface: "Foxconn",
      context: { nearby_text: "Ohio Wisconsin manufacturing facility" }
    });
    const fuzzyMicron = await resolver.resolve({ surface: "Micron Technolog" });
    const shortAlias = await resolver.resolve({ surface: "Mic" });

    expect(samsung).toMatchObject({
      status: "ambiguous",
      needs_human_review: true
    });
    expect(samsungMemory).toMatchObject({
      status: "resolved",
      entity_id: "ENT-SAMSUNG-MEMORY"
    });
    expect(samsungFoundry).toMatchObject({
      status: "resolved",
      entity_id: "ENT-SAMSUNG-FOUNDRY"
    });
    expect(foxconnUs).toMatchObject({
      status: "ambiguous",
      needs_human_review: true
    });
    expect(fuzzyMicron).toMatchObject({
      status: "ambiguous",
      needs_human_review: true
    });
    expect(shortAlias).toMatchObject({
      status: "unknown",
      needs_human_review: true
    });
  });
});

async function buildGoldenCases(): Promise<GoldenCase[]> {
  const entities = await readCsv<EntityGoldenRow>("tests/fixtures/dev-entities/entities.csv");
  const aliases = await readCsv<AliasGoldenRow>("tests/fixtures/dev-entities/aliases.csv");
  const entitiesById = new Map(entities.map((row) => [row.entity_id, row]));
  const uniqueTickers = uniqueTickerSet(entities.filter((row) => row.status === "active"));
  const cases: GoldenCase[] = [];

  for (const entity of entities.filter((row) => row.status === "active")) {
    addCase(cases, entity.canonical_name, entity.entity_id);
    addCase(cases, entity.display_name, entity.entity_id);
    addCase(cases, entity.entity_id, entity.entity_id);
    for (const ticker of splitTickers(entity.tickers)) {
      if (!uniqueTickers.has(normalizeAlias(ticker))) continue;
      addCase(cases, ticker, entity.entity_id, { ticker });
    }
  }

  for (const alias of aliases.filter((row) => row.status === "active")) {
    const entity = entitiesById.get(alias.entity_id);
    if (entity === undefined) continue;
    if (alias.alias_kind === "official" || alias.alias_kind === "translation") {
      addCase(cases, alias.alias, alias.entity_id);
      continue;
    }
    if (
      alias.alias_kind === "abbreviation" &&
      splitTickers(entity.tickers).some((ticker) => uniqueTickers.has(normalizeAlias(ticker)) && normalizeAlias(ticker) === normalizeAlias(alias.alias))
    ) {
      addCase(cases, alias.alias, alias.entity_id, { ticker: alias.alias });
    }
  }

  return cases;
}

async function readCsv<T extends object>(path: string): Promise<T[]> {
  const text = await readFile(resolve(process.cwd(), path), "utf8");
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    bom: true
  }) as T[];
}

function uniqueTickerSet(entities: EntityGoldenRow[]): Set<string> {
  const counts = new Map<string, number>();
  for (const entity of entities) {
    for (const ticker of splitTickers(entity.tickers)) {
      const normalized = normalizeAlias(ticker);
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }
  return new Set([...counts.entries()].filter(([, count]) => count === 1).map(([ticker]) => ticker));
}

function splitTickers(value: string): string[] {
  return value
    .split(";")
    .map((ticker) => ticker.trim().split(":")[0] ?? "")
    .filter((ticker) => ticker.length > 0);
}

function addCase(cases: GoldenCase[], surface: string, expectedEntityId: string, identifiers?: GoldenCase["identifiers"]): void {
  const cleaned = surface.trim();
  if (cleaned.length === 0) return;
  const key = `${normalizeAlias(cleaned)}|${expectedEntityId}|${identifiers?.ticker ?? ""}|${identifiers?.cik ?? ""}`;
  if (cases.some((item) => `${normalizeAlias(item.surface)}|${item.expectedEntityId}|${item.identifiers?.ticker ?? ""}|${item.identifiers?.cik ?? ""}` === key))
    return;
  cases.push({
    surface: cleaned,
    expectedEntityId,
    ...(identifiers === undefined ? {} : { identifiers })
  });
}
