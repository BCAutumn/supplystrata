import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { normalizeAlias, type AliasRecord, type ResolveInput, type ResolveResult } from "@supplystrata/core";
import type { DbClient } from "@supplystrata/db";

export interface EntityResolver {
  resolve(input: ResolveInput): Promise<ResolveResult>;
}

interface AliasMatchRow {
  entity_id: string;
  canonical_name: string;
  display_name: string;
  alias: string;
  alias_kind: AliasRecord["alias_kind"];
  source_type: string | null;
  primary_country: string | null;
  identifiers: Record<string, unknown>;
  industry: string[];
}

interface SeedEntityRow {
  entity_id: string;
  canonical_name: string;
  display_name: string;
  language_of_canonical: string;
  primary_country: string;
  tickers: string;
  cik: string;
  industry: string;
  status: string;
}

interface SeedAliasRow {
  entity_id: string;
  alias: string;
  language: string;
  alias_kind: AliasRecord["alias_kind"];
  source_type: string;
  status: string;
}

interface SeedAliasMatch {
  entity_id: string;
  display_name: string;
  alias: string;
  alias_kind: AliasRecord["alias_kind"];
  source_type: string | null;
  primary_country: string | null;
  identifiers: Record<string, unknown>;
  industry: string[];
}

export class DbEntityResolver implements EntityResolver {
  readonly #client: DbClient;

  constructor(client: DbClient) {
    this.#client = client;
  }

  async resolve(input: ResolveInput): Promise<ResolveResult> {
    const surface = input.surface.trim();
    if (surface.length === 0) return { status: "unknown", confidence: 0, needs_human_review: true };

    const special = resolveSpecialEntity(surface, input.context?.nearby_text ?? "");
    if (special !== undefined) return special;

    const identifier = await this.#resolveByIdentifier(input);
    if (identifier !== undefined) return identifier;

    const normalized = normalizeAlias(surface);
    const result = await this.#client.query<AliasMatchRow & { [key: string]: unknown }>(
      `SELECT a.entity_id, e.canonical_name, e.display_name, a.alias, a.alias_kind, a.source_type, e.primary_country, e.identifiers, e.industry
       FROM entity_alias a
       JOIN entity_master e ON e.entity_id = a.entity_id
       WHERE a.alias_norm = $1 AND a.status = 'active'
       ORDER BY length(a.alias) DESC`,
      [normalized]
    );

    const exact = resolveExactMatches(surface, input, result.rows);
    if (exact !== undefined) return exact;

    const fuzzy = await this.#client.query<AliasMatchRow & { [key: string]: unknown }>(
      `SELECT a.entity_id, e.canonical_name, e.display_name, a.alias, a.alias_kind, a.source_type, e.primary_country, e.identifiers, e.industry
       FROM entity_alias a
       JOIN entity_master e ON e.entity_id = a.entity_id
       WHERE a.alias_norm LIKE $1
       ORDER BY length(a.alias_norm)
       LIMIT 5`,
      [`%${normalized}%`]
    );
    return resolveFuzzyMatches(surface, fuzzy.rows);
  }

  async #resolveByIdentifier(input: ResolveInput): Promise<ResolveResult | undefined> {
    const identifiers = input.identifiers;
    if (identifiers === undefined) return undefined;
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (identifiers.cik !== undefined) {
      params.push(identifiers.cik);
      clauses.push(`identifiers->>'cik' = $${params.length}`);
    }
    if (identifiers.ticker !== undefined) {
      params.push(identifiers.ticker);
      clauses.push(
        `EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(identifiers->'ticker') ticker(value)
          WHERE lower(ticker.value) = lower($${params.length})
             OR lower(split_part(ticker.value, ':', 1)) = lower($${params.length})
        )`
      );
    }
    if (clauses.length === 0) return undefined;

    const result = await this.#client.query<Pick<AliasMatchRow, "entity_id"> & { [key: string]: unknown }>(
      `SELECT entity_id FROM entity_master WHERE status = 'active' AND (${clauses.join(" OR ")}) LIMIT 2`,
      params
    );
    if (result.rows.length !== 1) return undefined;
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return { status: "resolved", entity_id: row.entity_id, confidence: 1, needs_human_review: false };
  }
}

export class SeedEntityResolver implements EntityResolver {
  readonly #aliasesByNorm: Map<string, SeedAliasMatch[]>;
  readonly #displayNameById: Map<string, string>;
  readonly #matchesById: Map<string, SeedAliasMatch>;

  private constructor(aliasesByNorm: Map<string, SeedAliasMatch[]>, displayNameById: Map<string, string>, matchesById: Map<string, SeedAliasMatch>) {
    this.#aliasesByNorm = aliasesByNorm;
    this.#displayNameById = displayNameById;
    this.#matchesById = matchesById;
  }

  static async fromCsv(rootDir = process.cwd()): Promise<SeedEntityResolver> {
    const entities = await readCsv<SeedEntityRow>(resolve(rootDir, "seeds/entities.csv"));
    const aliases = await readCsv<SeedAliasRow>(resolve(rootDir, "seeds/aliases.csv"));
    const displayNameById = new Map<string, string>();
    const aliasesByNorm = new Map<string, SeedAliasMatch[]>();
    const matchesById = new Map<string, SeedAliasMatch>();

    for (const row of entities) {
      if (row.status !== "active") continue;
      const identity = seedIdentity(row);
      displayNameById.set(row.entity_id, row.display_name);
      matchesById.set(row.entity_id, { ...identity, alias: row.canonical_name, alias_kind: "official", source_type: "canonical_name" });
      addSeedAlias(aliasesByNorm, { ...identity, alias: row.canonical_name, alias_kind: "official", source_type: "canonical_name" });
      addSeedAlias(aliasesByNorm, { ...identity, alias: row.display_name, alias_kind: "official", source_type: "display_name" });
    }

    for (const row of aliases) {
      if (row.status !== "active") continue;
      const identity = matchesById.get(row.entity_id);
      if (identity === undefined) continue;
      addSeedAlias(aliasesByNorm, { ...identity, alias: row.alias, alias_kind: row.alias_kind, source_type: row.source_type || null });
    }

    return new SeedEntityResolver(aliasesByNorm, displayNameById, matchesById);
  }

  displayName(entityId: string): string | undefined {
    return this.#displayNameById.get(entityId);
  }

  async resolve(input: ResolveInput): Promise<ResolveResult> {
    const surface = input.surface.trim();
    if (surface.length === 0) return { status: "unknown", confidence: 0, needs_human_review: true };

    const special = resolveSpecialEntity(surface, input.context?.nearby_text ?? "");
    if (special !== undefined) return special;

    const identifier = resolveSeedByIdentifier(this.#matchesById, input);
    if (identifier !== undefined) return identifier;

    const normalized = normalizeAlias(surface);
    const matches = this.#aliasesByNorm.get(normalized) ?? [];
    const exact = resolveExactMatches(surface, input, matches);
    if (exact !== undefined) return exact;

    const fuzzy = [...this.#aliasesByNorm.entries()]
      .filter(([aliasNorm]) => aliasNorm.includes(normalized))
      .flatMap(([, aliasMatches]) => aliasMatches)
      .slice(0, 5);
    return resolveFuzzyMatches(surface, fuzzy);
  }
}

async function readCsv<T extends object>(path: string): Promise<T[]> {
  const text = await readFile(path, "utf8");
  return parse(text, { columns: true, skip_empty_lines: true, bom: true }) as T[];
}

function seedIdentity(row: SeedEntityRow): Omit<SeedAliasMatch, "alias" | "alias_kind" | "source_type"> {
  return {
    entity_id: row.entity_id,
    display_name: row.display_name,
    primary_country: row.primary_country || null,
    identifiers: seedIdentifiers(row),
    industry: row.industry
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
  };
}

function seedIdentifiers(row: SeedEntityRow): Record<string, unknown> {
  const identifiers: Record<string, unknown> = {};
  if (row.cik.trim().length > 0) identifiers["cik"] = row.cik.trim();
  if (row.tickers.trim().length > 0)
    identifiers["ticker"] = row.tickers
      .split(";")
      .map((ticker) => ticker.trim())
      .filter(Boolean);
  return identifiers;
}

function addSeedAlias(aliasesByNorm: Map<string, SeedAliasMatch[]>, match: SeedAliasMatch): void {
  const normalized = normalizeAlias(match.alias);
  const current = aliasesByNorm.get(normalized) ?? [];
  if (current.some((item) => item.entity_id === match.entity_id)) return;
  aliasesByNorm.set(normalized, [...current, match]);
}

function resolveExactMatches(surface: string, input: ResolveInput, matches: SeedAliasMatch[]): ResolveResult | undefined {
  if (matches.length === 0) return undefined;
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      confidence: 0.5,
      needs_human_review: true,
      candidates: matches.map((match) => ({ entity_id: match.entity_id, confidence: 0.5, reason: `Alias matched ${match.display_name}` }))
    };
  }

  const match = matches[0];
  if (match === undefined) return { status: "unknown", confidence: 0, needs_human_review: true };
  if (!canAutoResolveExact(surface, input, match)) {
    return {
      status: "ambiguous",
      confidence: 0.7,
      needs_human_review: true,
      candidates: [
        { entity_id: match.entity_id, confidence: 0.7, reason: `Exact alias matched ${match.display_name}, but alias is weak without identifier/context` }
      ]
    };
  }
  return { status: "resolved", entity_id: match.entity_id, confidence: exactConfidence(surface, match), needs_human_review: false };
}

// Fuzzy 命中永远只返回候选，不自动 resolved。错合并比暂时 unknown 更危险。
function resolveFuzzyMatches(surface: string, matches: SeedAliasMatch[]): ResolveResult {
  const normalized = normalizeAlias(surface);
  if (normalized.length < 6) return { status: "unknown", confidence: 0, needs_human_review: true };
  const unique = uniqueMatches(matches);
  if (unique.length === 0) return { status: "unknown", confidence: 0, needs_human_review: true };
  return {
    status: "ambiguous",
    confidence: 0.65,
    needs_human_review: true,
    candidates: unique.map((match) => ({ entity_id: match.entity_id, confidence: 0.65, reason: `Fuzzy alias candidate ${match.display_name}` }))
  };
}

// exact alias 也要看 alias 强度；弱别名和短别名需要 identifier 或上下文兜住。
function canAutoResolveExact(surface: string, input: ResolveInput, match: SeedAliasMatch): boolean {
  const normalized = normalizeAlias(surface);
  if (hasMatchingIdentifier(input, match)) return true;
  if (hasCountryContext(input, match)) return true;
  if (match.alias_kind === "official" || match.alias_kind === "translation") return true;
  if (match.alias_kind === "abbreviation" && aliasMatchesKnownTicker(surface, match)) return true;
  if (normalized.length <= 4) return false;
  return match.source_type === "canonical_name" || match.source_type === "display_name";
}

function exactConfidence(surface: string, match: SeedAliasMatch): number {
  const normalized = normalizeAlias(surface);
  if (match.alias_kind === "official" || match.source_type === "canonical_name" || match.source_type === "display_name") return 0.98;
  if (match.alias_kind === "translation") return 0.96;
  if (match.alias_kind === "abbreviation" && aliasMatchesKnownTicker(surface, match)) return 0.94;
  if (normalized.length <= 4) return 0.86;
  return 0.9;
}

function hasMatchingIdentifier(input: ResolveInput, match: SeedAliasMatch): boolean {
  const identifiers = input.identifiers;
  if (identifiers === undefined) return false;
  if (identifiers.cik !== undefined && stringIdentifier(match.identifiers["cik"]) === identifiers.cik) return true;
  if (identifiers.ticker !== undefined && tickerMatchesValue(match, identifiers.ticker)) return true;
  return false;
}

function hasCountryContext(input: ResolveInput, match: SeedAliasMatch): boolean {
  const inferredCountry = input.context?.inferred_country;
  return inferredCountry !== undefined && match.primary_country !== null && normalizeAlias(inferredCountry) === normalizeAlias(match.primary_country);
}

function aliasMatchesKnownTicker(surface: string, match: SeedAliasMatch): boolean {
  return tickerMatchesValue(match, surface);
}

function tickerMatchesValue(match: SeedAliasMatch, value: string): boolean {
  const normalized = normalizeAlias(value);
  return tickerIdentifiers(match).some((ticker) => normalizeAlias(ticker.split(":")[0] ?? ticker) === normalized || normalizeAlias(ticker) === normalized);
}

function tickerIdentifiers(match: SeedAliasMatch): string[] {
  const ticker = match.identifiers["ticker"];
  if (!Array.isArray(ticker)) return [];
  return ticker.filter((item): item is string => typeof item === "string");
}

function stringIdentifier(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function resolveSeedByIdentifier(matchesById: Map<string, SeedAliasMatch>, input: ResolveInput): ResolveResult | undefined {
  const identifiers = input.identifiers;
  if (identifiers === undefined) return undefined;
  const matches = [...matchesById.values()].filter((match) => hasMatchingIdentifier(input, match));
  if (matches.length !== 1) return undefined;
  const match = matches[0];
  if (match === undefined) return undefined;
  return { status: "resolved", entity_id: match.entity_id, confidence: 1, needs_human_review: false };
}

function uniqueMatches(matches: SeedAliasMatch[]): SeedAliasMatch[] {
  const byEntity = new Map<string, SeedAliasMatch>();
  for (const match of matches) {
    if (!byEntity.has(match.entity_id)) byEntity.set(match.entity_id, match);
  }
  return [...byEntity.values()];
}

function resolveSpecialEntity(surface: string, context: string): ResolveResult | undefined {
  const samsung = resolveSamsungBusinessUnit(surface, context);
  if (samsung !== undefined) return samsung;
  const foxconn = resolveFoxconnFamily(surface, context);
  if (foxconn !== undefined) return foxconn;
  const tsmc = resolveTsmcFamily(surface, context);
  if (tsmc !== undefined) return tsmc;
  return undefined;
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
  if (/\bgalaxy|smartphone|tv|consumer electronics|mobile device/.test(normalizedContext)) {
    return { status: "resolved", entity_id: "ENT-SAMSUNG-ELECTRONICS", confidence: 0.85, needs_human_review: false };
  }
  return {
    status: "ambiguous",
    confidence: 0.45,
    needs_human_review: true,
    candidates: [
      { entity_id: "ENT-SAMSUNG-ELECTRONICS", confidence: 0.4, reason: "孤立 Samsung 可能指母公司" },
      { entity_id: "ENT-SAMSUNG-FOUNDRY", confidence: 0.3, reason: "供应链语境可能指 Foundry" },
      { entity_id: "ENT-SAMSUNG-MEMORY", confidence: 0.3, reason: "供应链语境可能指 Memory" },
      { entity_id: "ENT-SAMSUNG-DISPLAY", confidence: 0.2, reason: "消费电子语境可能指 Display" }
    ]
  };
}

function resolveFoxconnFamily(surface: string, context: string): ResolveResult | undefined {
  const normalizedSurface = normalizeAlias(surface);
  if (!["foxconn", "hon hai", "hon hai precision industry", "鴻海", "鸿海", "富士康", "fii", "fih", "hongfujin"].includes(normalizedSurface)) return undefined;
  const normalizedContext = normalizeAlias(context);
  if (/\bindustrial internet\b|\bfii\b|工业互联网/.test(normalizedContext) || normalizedSurface === "fii") {
    return { status: "resolved", entity_id: "ENT-FOXCONN-FII", confidence: 0.9, needs_human_review: false };
  }
  if (/\bfih\b|mobile|handset/.test(normalizedContext) || normalizedSurface === "fih") {
    return { status: "resolved", entity_id: "ENT-FIH-MOBILE", confidence: 0.88, needs_human_review: false };
  }
  if (/hongfujin|shenzhen|深圳/.test(normalizedContext) || normalizedSurface === "hongfujin") {
    return { status: "resolved", entity_id: "ENT-HONGFUJIN-SHENZHEN", confidence: 0.86, needs_human_review: false };
  }
  if (/ohio|wisconsin|mt\.?\s*pleasant/.test(normalizedContext)) {
    return {
      status: "ambiguous",
      confidence: 0.65,
      needs_human_review: true,
      candidates: [
        { entity_id: "ENT-FOXCONN-OHIO", confidence: 0.55, reason: "美国厂区语境可能指 Foxconn Ohio" },
        { entity_id: "ENT-FOXCONN-ASSEMBLY", confidence: 0.45, reason: "美国组装法人也可能相关" }
      ]
    };
  }
  return { status: "resolved", entity_id: "ENT-FOXCONN", confidence: 0.92, needs_human_review: false };
}

function resolveTsmcFamily(surface: string, context: string): ResolveResult | undefined {
  const normalizedSurface = normalizeAlias(surface);
  if (normalizedSurface !== "tsmc") return undefined;
  const normalizedContext = normalizeAlias(context);
  if (/arizona/.test(normalizedContext)) return { status: "resolved", entity_id: "ENT-TSMC-ARIZONA", confidence: 0.9, needs_human_review: false };
  if (/jasm|kumamoto|japan advanced semiconductor/.test(normalizedContext)) {
    return { status: "resolved", entity_id: "ENT-JASM", confidence: 0.88, needs_human_review: false };
  }
  return { status: "resolved", entity_id: "ENT-TSMC", confidence: 0.96, needs_human_review: false };
}
