import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { normalizeAlias, type AliasRecord, type EntityKind, type EntityRecord } from "@supplystrata/core";
import type { DatabaseStore, DbClient } from "./client.js";

interface EntityCsvRow {
  entity_id: string;
  kind: EntityKind;
  canonical_name: string;
  display_name: string;
  language_of_canonical: string;
  primary_country: string;
  tickers: string;
  cik: string;
  industry: string;
  status: EntityRecord["status"];
  attrs_json: string;
}

interface AliasCsvRow {
  alias_id: string;
  entity_id: string;
  alias: string;
  language: string;
  alias_kind: AliasRecord["alias_kind"];
  source_type: string;
  status: AliasRecord["status"];
}

interface ComponentCsvRow {
  component_id: string;
  name: string;
  taxonomy_path: string;
  aliases: string;
}

const DEV_ENTITY_FIXTURE_DIR = "tests/fixtures/dev-entities";

export async function importDevFixturesFromCsv(store: DatabaseStore, rootDir: string): Promise<{ entities: number; aliases: number; components: number }> {
  return store.transaction(async (client) => {
    // dev fixture 会写大量 deterministic id；事务级锁让并行测试 worker 串行执行同一批基础数据。
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('supplystrata:dev-fixtures', 0))");
    return importDevFixturesFromCsvLocked(client, rootDir);
  });
}

async function importDevFixturesFromCsvLocked(client: DbClient, rootDir: string): Promise<{ entities: number; aliases: number; components: number }> {
  const entities = await readCsv<EntityCsvRow>(resolve(rootDir, DEV_ENTITY_FIXTURE_DIR, "entities.csv"));
  const aliases = await readCsv<AliasCsvRow>(resolve(rootDir, DEV_ENTITY_FIXTURE_DIR, "aliases.csv"));
  const components = await readCsv<ComponentCsvRow>(resolve(rootDir, "seeds/components.csv"));
  let autoAliases = 0;

  for (const row of entities) {
    const rawAttrs = parseJsonRecord(row.attrs_json);
    const identifiers = seedIdentifiers(row, rawAttrs);
    const attrs = seedAttrs(rawAttrs);
    await client.query(
      `INSERT INTO entity_master (entity_id, kind, canonical_name, display_name, language_of_canonical, identifiers, primary_country, industry, status, attrs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (entity_id) DO UPDATE SET
         kind = EXCLUDED.kind,
         canonical_name = EXCLUDED.canonical_name,
         display_name = EXCLUDED.display_name,
         identifiers = EXCLUDED.identifiers,
         primary_country = EXCLUDED.primary_country,
         industry = EXCLUDED.industry,
         status = EXCLUDED.status,
         attrs = EXCLUDED.attrs,
         updated_at = now()`,
      [
        row.entity_id,
        row.kind,
        row.canonical_name,
        row.display_name,
        row.language_of_canonical,
        identifiers,
        row.primary_country || null,
        row.industry
          .split(";")
          .map((item) => item.trim())
          .filter(Boolean),
        row.status,
        attrs
      ]
    );

    const autoAliasInputs = new Map<string, { alias: string; sourceType: string }>();
    autoAliasInputs.set(normalizeAlias(row.canonical_name), { alias: row.canonical_name, sourceType: "canonical_name" });
    autoAliasInputs.set(normalizeAlias(row.display_name), { alias: row.display_name, sourceType: "display_name" });
    for (const item of autoAliasInputs.values()) {
      await seedAlias(client, {
        alias_id: autoAliasId(row.entity_id, item.alias),
        entity_id: row.entity_id,
        alias: item.alias,
        language: row.language_of_canonical,
        alias_kind: "official",
        source_type: item.sourceType,
        status: row.status === "active" ? "active" : "rejected"
      });
      autoAliases += 1;
    }
  }

  for (const row of aliases) {
    await seedAlias(client, row);
  }

  for (const row of components) {
    await client.query(
      `INSERT INTO components (component_id, name, taxonomy_path, aliases)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (component_id) DO UPDATE SET
         name = EXCLUDED.name,
         taxonomy_path = EXCLUDED.taxonomy_path,
         aliases = EXCLUDED.aliases`,
      [
        row.component_id,
        row.name,
        row.taxonomy_path
          .split(">")
          .map((part) => part.trim())
          .filter(Boolean),
        row.aliases
          .split(";")
          .map((part) => part.trim())
          .filter(Boolean)
      ]
    );
  }

  await backfillEdgeComponents(client);
  await ensureDefaultUnknownItems(client);
  return { entities: entities.length, aliases: aliases.length + autoAliases, components: components.length };
}

function seedIdentifiers(row: EntityCsvRow, attrs: Record<string, unknown>): Record<string, unknown> {
  const identifiers: Record<string, unknown> = {};
  if (row.cik.trim().length > 0) identifiers["cik"] = row.cik.trim();
  if (row.tickers.trim().length > 0)
    identifiers["ticker"] = row.tickers
      .split(";")
      .map((ticker) => ticker.trim())
      .filter(Boolean);
  const fixtureIdentifiers = attrs["identifiers"];
  if (!isStringRecord(fixtureIdentifiers)) return identifiers;
  for (const [key, value] of Object.entries(fixtureIdentifiers)) {
    const trimmed = value.trim();
    if (trimmed.length > 0) identifiers[key] = trimmed;
  }
  return identifiers;
}

function seedAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "identifiers") continue;
    output[key] = value;
  }
  return output;
}

async function backfillEdgeComponents(client: DbClient): Promise<void> {
  await client.query(
    `UPDATE edges e
     SET component = 'memory',
         component_id = 'COMP-MEMORY',
         component_specificity = 'unspecified',
         updated_at = now()
     FROM evidence ev
     WHERE e.primary_evidence_id = ev.evidence_id
       AND e.validity = 'current'
       AND lower(e.component) = 'hbm'
       AND ev.cite_text ~* '(^|[^[:alnum:]_])(memory|memories)([^[:alnum:]_]|$)'
       AND ev.cite_text !~* '(^|[^[:alnum:]_])(hbm(3e?|4)?|high[-[:space:]]?bandwidth[[:space:]]+memory)([^[:alnum:]_]|$)'
       AND EXISTS (SELECT 1 FROM components c WHERE c.component_id = 'COMP-MEMORY')
       AND NOT EXISTS (
         SELECT 1
         FROM edges existing
         WHERE existing.edge_id <> e.edge_id
           AND existing.subject_id = e.subject_id
           AND existing.object_id = e.object_id
           AND existing.relation = e.relation
           AND existing.component_id = 'COMP-MEMORY'
           AND lower(COALESCE(existing.component, '')) = 'memory'
       )`
  );

  await client.query(
    `WITH unsupported_hbm AS (
       SELECT e.edge_id, e.subject_id, e.object_id, e.relation
       FROM edges e
       JOIN evidence ev ON e.primary_evidence_id = ev.evidence_id
       WHERE lower(e.component) = 'hbm'
         AND e.validity = 'current'
         AND ev.cite_text ~* '(^|[^[:alnum:]_])(memory|memories)([^[:alnum:]_]|$)'
         AND ev.cite_text !~* '(^|[^[:alnum:]_])(hbm(3e?|4)?|high[-[:space:]]?bandwidth[[:space:]]+memory)([^[:alnum:]_]|$)'
     ),
     memory_edges AS (
       SELECT old.edge_id AS old_edge_id, existing.edge_id AS memory_edge_id
       FROM unsupported_hbm old
       JOIN edges existing
         ON existing.edge_id <> old.edge_id
        AND existing.subject_id = old.subject_id
        AND existing.object_id = old.object_id
        AND existing.relation = old.relation
        AND existing.component_id = 'COMP-MEMORY'
        AND lower(COALESCE(existing.component, '')) = 'memory'
        AND existing.validity = 'current'
     )
     UPDATE edges e
     SET validity = 'deprecated',
         deprecated_reason = 'Superseded by COMP-MEMORY component backfill; primary evidence only says memory.',
         superseded_by_edge_id = memory_edges.memory_edge_id,
         updated_at = now()
     FROM memory_edges
     WHERE e.edge_id = memory_edges.old_edge_id`
  );

  await client.query(
    `WITH component_matches AS (
       SELECT e.edge_id,
              c.component_id,
              CASE
                WHEN lower(e.component) IN ('hbm', 'dram', 'wafer', 'manufacturing services') THEN 'explicit'
                ELSE 'unspecified'
              END AS component_specificity
       FROM edges e
       JOIN components c
         ON lower(e.component) = lower(c.name)
         OR EXISTS (SELECT 1 FROM unnest(c.aliases) AS alias WHERE lower(alias) = lower(e.component))
       WHERE e.component IS NOT NULL
         AND e.component_id IS NULL
         AND e.validity = 'current'
     )
     UPDATE edges e
     SET component_id = component_matches.component_id,
         component_specificity = COALESCE(e.component_specificity, component_matches.component_specificity),
         updated_at = now()
     FROM component_matches
     WHERE e.edge_id = component_matches.edge_id`
  );
}

async function seedAlias(client: DbClient, row: AliasCsvRow): Promise<void> {
  await client.query(
    `INSERT INTO entity_alias (alias_id, entity_id, alias, alias_norm, language, alias_kind, source_type, added_by, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'seed',$8)
     ON CONFLICT (entity_id, alias_norm, language) DO UPDATE SET
       alias = EXCLUDED.alias,
       alias_kind = EXCLUDED.alias_kind,
       source_type = EXCLUDED.source_type,
       status = EXCLUDED.status,
       added_by = 'seed'`,
    [row.alias_id, row.entity_id, row.alias, normalizeAlias(row.alias), row.language || null, row.alias_kind, row.source_type || null, row.status]
  );
}

function autoAliasId(entityId: string, alias: string): string {
  const suffix = normalizeAlias(alias)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64);
  return `AUTO-${entityId}-${suffix}`;
}

async function readCsv<T extends object>(path: string): Promise<T[]> {
  const text = await readFile(path, "utf8");
  return parse(text, { columns: true, skip_empty_lines: true, bom: true }) as T[];
}

function parseJsonRecord(text: string): Record<string, unknown> {
  if (text.trim().length === 0) return {};
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every((item) => typeof item === "string");
}

async function ensureDefaultUnknownItems(client: DbClient): Promise<void> {
  const questions = [
    "Exact HBM allocation per cloud customer",
    "Customer-specific GPU shipment quantities",
    "Contract pricing and rebates",
    "Internal capacity reservation at foundries",
    "Specific shipping routes and carriers"
  ];
  for (const question of questions) {
    await client.query(
      `INSERT INTO unknown_items (unknown_id, scope_kind, scope_id, question, why_unknown, blocking_data_sources, proxies, created_by)
       VALUES ($1,'company','ENT-NVIDIA',$2,'No public disclosure; allocation and pricing are contractual and confidential.',ARRAY['company internal contracts'],ARRAY['10-K supplier disclosures','earnings call commentary'],'seed')
       ON CONFLICT (unknown_id) DO NOTHING`,
      [
        `UNK-NVIDIA-${normalizeAlias(question)
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .toUpperCase()}`,
        question
      ]
    );
  }
}
