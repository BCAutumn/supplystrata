import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { normalizeAlias, type ResolveInput, type ResolveResult } from "@supplystrata/core";
import type { DbClient } from "@supplystrata/db";

export interface EntityResolver {
  resolve(input: ResolveInput): Promise<ResolveResult>;
}

interface AliasMatchRow {
  entity_id: string;
  canonical_name: string;
  display_name: string;
}

interface SeedEntityRow {
  entity_id: string;
  canonical_name: string;
  display_name: string;
  language_of_canonical: string;
  status: string;
}

interface SeedAliasRow {
  entity_id: string;
  alias: string;
  language: string;
  status: string;
}

interface SeedAliasMatch {
  entity_id: string;
  display_name: string;
  alias: string;
}

export class DbEntityResolver implements EntityResolver {
  readonly #client: DbClient;

  constructor(client: DbClient) {
    this.#client = client;
  }

  async resolve(input: ResolveInput): Promise<ResolveResult> {
    const surface = input.surface.trim();
    if (surface.length === 0) return { status: "unknown", confidence: 0, needs_human_review: true };

    const samsung = resolveSamsungBusinessUnit(surface, input.context?.nearby_text ?? "");
    if (samsung !== undefined) return samsung;

    const normalized = normalizeAlias(surface);
    const result = await this.#client.query<AliasMatchRow & { [key: string]: unknown }>(
      `SELECT a.entity_id, e.canonical_name, e.display_name
       FROM entity_alias a
       JOIN entity_master e ON e.entity_id = a.entity_id
       WHERE a.alias_norm = $1 AND a.status = 'active'
       ORDER BY length(a.alias) DESC`,
      [normalized]
    );

    if (result.rows.length === 1) {
      const row = result.rows[0];
      if (row === undefined) return { status: "unknown", confidence: 0, needs_human_review: true };
      return { status: "resolved", entity_id: row.entity_id, confidence: 0.98, needs_human_review: false };
    }

    if (result.rows.length > 1) {
      return {
        status: "ambiguous",
        confidence: 0.5,
        needs_human_review: true,
        candidates: result.rows.map((row) => ({ entity_id: row.entity_id, confidence: 0.5, reason: `Alias matched ${row.display_name}` }))
      };
    }

    const fuzzy = await this.#client.query<AliasMatchRow & { [key: string]: unknown }>(
      `SELECT a.entity_id, e.canonical_name, e.display_name
       FROM entity_alias a
       JOIN entity_master e ON e.entity_id = a.entity_id
       WHERE a.alias_norm LIKE $1
       ORDER BY length(a.alias_norm)
       LIMIT 5`,
      [`%${normalized}%`]
    );
    if (fuzzy.rows.length === 1) {
      const row = fuzzy.rows[0];
      if (row !== undefined) return { status: "resolved", entity_id: row.entity_id, confidence: 0.82, needs_human_review: false };
    }

    return { status: "unknown", confidence: 0, needs_human_review: true };
  }
}

export class SeedEntityResolver implements EntityResolver {
  readonly #aliasesByNorm: Map<string, SeedAliasMatch[]>;
  readonly #displayNameById: Map<string, string>;

  private constructor(aliasesByNorm: Map<string, SeedAliasMatch[]>, displayNameById: Map<string, string>) {
    this.#aliasesByNorm = aliasesByNorm;
    this.#displayNameById = displayNameById;
  }

  static async fromCsv(rootDir = process.cwd()): Promise<SeedEntityResolver> {
    const entities = await readCsv<SeedEntityRow>(resolve(rootDir, "seeds/entities.csv"));
    const aliases = await readCsv<SeedAliasRow>(resolve(rootDir, "seeds/aliases.csv"));
    const displayNameById = new Map<string, string>();
    const aliasesByNorm = new Map<string, SeedAliasMatch[]>();

    for (const row of entities) {
      if (row.status !== "active") continue;
      displayNameById.set(row.entity_id, row.display_name);
      addSeedAlias(aliasesByNorm, { entity_id: row.entity_id, display_name: row.display_name, alias: row.canonical_name });
      addSeedAlias(aliasesByNorm, { entity_id: row.entity_id, display_name: row.display_name, alias: row.display_name });
    }

    for (const row of aliases) {
      if (row.status !== "active") continue;
      const displayName = displayNameById.get(row.entity_id);
      if (displayName === undefined) continue;
      addSeedAlias(aliasesByNorm, { entity_id: row.entity_id, display_name: displayName, alias: row.alias });
    }

    return new SeedEntityResolver(aliasesByNorm, displayNameById);
  }

  displayName(entityId: string): string | undefined {
    return this.#displayNameById.get(entityId);
  }

  async resolve(input: ResolveInput): Promise<ResolveResult> {
    const surface = input.surface.trim();
    if (surface.length === 0) return { status: "unknown", confidence: 0, needs_human_review: true };

    const samsung = resolveSamsungBusinessUnit(surface, input.context?.nearby_text ?? "");
    if (samsung !== undefined) return samsung;

    const normalized = normalizeAlias(surface);
    const matches = this.#aliasesByNorm.get(normalized) ?? [];
    if (matches.length === 1) {
      const match = matches[0];
      if (match === undefined) return { status: "unknown", confidence: 0, needs_human_review: true };
      return { status: "resolved", entity_id: match.entity_id, confidence: 0.98, needs_human_review: false };
    }
    if (matches.length > 1) {
      return {
        status: "ambiguous",
        confidence: 0.5,
        needs_human_review: true,
        candidates: matches.map((match) => ({ entity_id: match.entity_id, confidence: 0.5, reason: `Seed alias matched ${match.display_name}` }))
      };
    }

    const fuzzy = [...this.#aliasesByNorm.entries()]
      .filter(([aliasNorm]) => aliasNorm.includes(normalized))
      .flatMap(([, aliasMatches]) => aliasMatches)
      .slice(0, 5);
    const unique = uniqueMatches(fuzzy);
    if (unique.length === 1) {
      const match = unique[0];
      if (match === undefined) return { status: "unknown", confidence: 0, needs_human_review: true };
      return { status: "resolved", entity_id: match.entity_id, confidence: 0.82, needs_human_review: false };
    }

    return { status: "unknown", confidence: 0, needs_human_review: true };
  }
}

async function readCsv<T extends object>(path: string): Promise<T[]> {
  const text = await readFile(path, "utf8");
  return parse(text, { columns: true, skip_empty_lines: true, bom: true }) as T[];
}

function addSeedAlias(aliasesByNorm: Map<string, SeedAliasMatch[]>, match: SeedAliasMatch): void {
  const normalized = normalizeAlias(match.alias);
  const current = aliasesByNorm.get(normalized) ?? [];
  if (current.some((item) => item.entity_id === match.entity_id)) return;
  aliasesByNorm.set(normalized, [...current, match]);
}

function uniqueMatches(matches: SeedAliasMatch[]): SeedAliasMatch[] {
  const byEntity = new Map<string, SeedAliasMatch>();
  for (const match of matches) {
    if (!byEntity.has(match.entity_id)) byEntity.set(match.entity_id, match);
  }
  return [...byEntity.values()];
}

function resolveSamsungBusinessUnit(surface: string, context: string): ResolveResult | undefined {
  const normalizedSurface = normalizeAlias(surface);
  if (normalizedSurface !== "samsung") return undefined;
  const normalizedContext = normalizeAlias(context);
  if (/\bfoundry|wafer|fabricat|manufactur/.test(normalizedContext)) {
    return { status: "resolved", entity_id: "ENT-SAMSUNG-FOUNDRY", confidence: 0.9, needs_human_review: false };
  }
  if (/\bmemory|dram|hbm|high bandwidth/.test(normalizedContext)) {
    return { status: "resolved", entity_id: "ENT-SAMSUNG-MEMORY", confidence: 0.9, needs_human_review: false };
  }
  return {
    status: "ambiguous",
    confidence: 0.45,
    needs_human_review: true,
    candidates: [
      { entity_id: "ENT-SAMSUNG-ELECTRONICS", confidence: 0.4, reason: "孤立 Samsung 可能指母公司" },
      { entity_id: "ENT-SAMSUNG-FOUNDRY", confidence: 0.3, reason: "供应链语境可能指 Foundry" },
      { entity_id: "ENT-SAMSUNG-MEMORY", confidence: 0.3, reason: "供应链语境可能指 Memory" }
    ]
  };
}
