import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import pg from "pg";
import {
  createId,
  loadEnv,
  normalizeAlias,
  type AliasRecord,
  type ApprovedCandidate,
  type EntityKind,
  type EntityRecord,
  type EvidenceLevel,
  type ExtractionMethod,
  type NormalizedDocument,
  type RelationType
} from "@supplystrata/core";
import { migrationSql } from "./schema.js";

const { Pool } = pg;

export interface DbClient {
  query<T extends pg.QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<pg.QueryResult<T>>;
}

export function createPool(): pg.Pool {
  return new Pool({ connectionString: loadEnv().POSTGRES_URL });
}

export async function migrate(client: DbClient): Promise<void> {
  // 多个 integration test worker 可能同时启动迁移；事务级 advisory lock 避免并发 CREATE TABLE 竞态。
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('supplystrata:migrate', 0));\n${migrationSql}`);
}

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

export async function seedFromCsv(client: DbClient, rootDir = process.cwd()): Promise<{ entities: number; aliases: number; components: number }> {
  if (client instanceof Pool) {
    const lockedClient = await client.connect();
    let lockAcquired = false;
    try {
      // seed 会写大量 deterministic id；并行测试 worker 同时 seed 时必须整段串行。
      await lockedClient.query("SELECT pg_advisory_lock(hashtextextended('supplystrata:seed', 0))");
      lockAcquired = true;
      return await seedFromCsvLocked(lockedClient, rootDir);
    } finally {
      if (lockAcquired) await lockedClient.query("SELECT pg_advisory_unlock(hashtextextended('supplystrata:seed', 0))");
      lockedClient.release();
    }
  }
  return await seedFromCsvLocked(client, rootDir);
}

async function seedFromCsvLocked(client: DbClient, rootDir: string): Promise<{ entities: number; aliases: number; components: number }> {
  const entities = await readCsv<EntityCsvRow>(resolve(rootDir, "seeds/entities.csv"));
  const aliases = await readCsv<AliasCsvRow>(resolve(rootDir, "seeds/aliases.csv"));
  const components = await readCsv<ComponentCsvRow>(resolve(rootDir, "seeds/components.csv"));
  let autoAliases = 0;

  for (const row of entities) {
    const identifiers: Record<string, unknown> = {};
    if (row.cik.trim().length > 0) identifiers["cik"] = row.cik.trim();
    if (row.tickers.trim().length > 0)
      identifiers["ticker"] = row.tickers
        .split(";")
        .map((ticker) => ticker.trim())
        .filter(Boolean);
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
        parseJsonRecord(row.attrs_json)
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

async function backfillEdgeComponents(client: DbClient): Promise<void> {
  await client.query(
    `UPDATE edges e
     SET component = 'memory',
         component_id = 'COMP-MEMORY',
         component_specificity = 'unspecified',
         updated_at = now()
     FROM evidence ev
     WHERE e.primary_evidence_id = ev.evidence_id
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

export interface SavedDocumentRef {
  doc_id: string;
  chunks: { chunk_id: string; text: string }[];
}

interface SavedDocumentRow extends pg.QueryResultRow {
  doc_id: string;
}

export async function saveNormalizedDocument(client: DbClient, doc: NormalizedDocument): Promise<SavedDocumentRef> {
  const saved = await client.query<SavedDocumentRow>(
    `INSERT INTO documents (doc_id, source_adapter_id, document_type, primary_entity_id, source_url, source_date, fetched_at, bytes_sha256, storage_key, language, parse_status, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'parsed',$11)
     ON CONFLICT (source_adapter_id, source_url, bytes_sha256) DO UPDATE SET
       parse_status = 'parsed',
       fetched_at = EXCLUDED.fetched_at,
       storage_key = EXCLUDED.storage_key,
       metadata = EXCLUDED.metadata
     RETURNING doc_id`,
    [
      doc.doc_id,
      doc.source_adapter_id,
      doc.document_type,
      doc.primary_entity_id ?? null,
      doc.source_url,
      doc.source_date ?? null,
      doc.fetched_at,
      doc.bytes_sha256,
      doc.storage_key,
      doc.language,
      doc.metadata
    ]
  );
  const savedDocId = saved.rows[0]?.doc_id;
  if (savedDocId === undefined) throw new Error(`Document save did not return doc_id for ${doc.source_url}`);
  const savedChunks: SavedDocumentRef["chunks"] = [];

  for (const [index, chunk] of doc.chunks.entries()) {
    const chunkId = chunkIdForIndex(savedDocId, index);
    await client.query(
      `INSERT INTO document_chunks (chunk_id, doc_id, chunk_index, text, locator, language, token_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (doc_id, chunk_index) DO UPDATE SET
         text = EXCLUDED.text,
         locator = EXCLUDED.locator,
         language = EXCLUDED.language,
         token_count = EXCLUDED.token_count`,
      [chunkId, savedDocId, index, chunk.text, chunk.locator, chunk.language ?? doc.language, chunk.token_count ?? null]
    );
    savedChunks.push({ chunk_id: chunkId, text: chunk.text });
  }
  return { doc_id: savedDocId, chunks: savedChunks };
}

function chunkIdForIndex(docId: string, index: number): string {
  return `${docId}-CHK-${String(index + 1).padStart(4, "0")}`;
}

export interface DocumentWithChunks extends NormalizedDocument {
  document_type: NormalizedDocument["document_type"];
}

interface DocumentRow extends pg.QueryResultRow {
  doc_id: string;
  source_adapter_id: string;
  document_type: NormalizedDocument["document_type"];
  primary_entity_id: string | null;
  source_url: string;
  source_date: Date | null;
  fetched_at: Date;
  bytes_sha256: string;
  storage_key: string;
  language: string | null;
  metadata: Record<string, unknown>;
}

interface ChunkRow extends pg.QueryResultRow {
  chunk_id: string;
  text: string;
  locator: string | null;
  language: string | null;
  token_count: number | null;
}

export async function loadDocument(client: DbClient, docId: string): Promise<DocumentWithChunks> {
  const docResult = await client.query<DocumentRow>("SELECT * FROM documents WHERE doc_id = $1", [docId]);
  const doc = docResult.rows[0];
  if (doc === undefined) throw new Error(`Document not found: ${docId}`);
  const chunkResult = await client.query<ChunkRow>("SELECT * FROM document_chunks WHERE doc_id = $1 ORDER BY chunk_index", [docId]);
  return {
    doc_id: doc.doc_id,
    source_adapter_id: doc.source_adapter_id,
    document_type: doc.document_type,
    language: doc.language ?? "en",
    fetched_at: doc.fetched_at.toISOString(),
    source_url: doc.source_url,
    storage_key: doc.storage_key,
    bytes_sha256: doc.bytes_sha256,
    text: chunkResult.rows.map((chunk) => chunk.text).join("\n\n"),
    chunks: chunkResult.rows.map((chunk) => {
      const base = {
        chunk_id: chunk.chunk_id,
        text: chunk.text,
        locator: chunk.locator ?? "unknown",
        language: chunk.language ?? "en"
      };
      return chunk.token_count === null ? base : { ...base, token_count: chunk.token_count };
    }),
    metadata: doc.metadata,
    ...(doc.primary_entity_id === null ? {} : { primary_entity_id: doc.primary_entity_id }),
    ...(doc.source_date === null ? {} : { source_date: doc.source_date.toISOString().slice(0, 10) })
  };
}

export async function insertReviewQueue(client: DbClient, approved: ApprovedCandidate): Promise<void> {
  await client.query(
    `INSERT INTO extraction_review_queue (review_id, candidate, scoring, doc_id, chunk_id, status, reviewer, reviewed_at)
     VALUES ($1,$2,$3,$4,$5,'approved','auto',now())
     ON CONFLICT (review_id) DO NOTHING`,
    [createId("REV"), approved.candidate, approved.scoring, approved.doc_id, approved.chunk_id ?? null]
  );
}

export async function recordPendingEntity(
  client: DbClient,
  input: { surface: string; context: Record<string, unknown> }
): Promise<{ pending_id: string; is_new: boolean }> {
  const existing = await client.query<{ pending_id: string } & pg.QueryResultRow>(
    `SELECT pending_id
     FROM pending_entities
     WHERE lower(surface) = lower($1) AND status = 'pending'
     ORDER BY first_seen_at
     LIMIT 1`,
    [input.surface]
  );
  const current = existing.rows[0];
  if (current !== undefined) {
    await client.query("UPDATE pending_entities SET occurrence_count = occurrence_count + 1, context = $2 WHERE pending_id = $1", [
      current.pending_id,
      input.context
    ]);
    return { pending_id: current.pending_id, is_new: false };
  }

  const pendingId = createId("PND");
  await client.query(
    `INSERT INTO pending_entities (pending_id, surface, context, status)
     VALUES ($1,$2,$3,'pending')`,
    [pendingId, input.surface, input.context]
  );
  return { pending_id: pendingId, is_new: true };
}

export type PendingEntityStatusFilter = "pending" | "resolved" | "all";

export interface PendingEntityRow extends pg.QueryResultRow {
  pending_id: string;
  surface: string;
  context: Record<string, unknown>;
  first_seen_at: Date;
  occurrence_count: number;
  status: "pending" | "resolved" | "rejected";
  resolved_entity_id: string | null;
  reviewer: string | null;
  reviewed_at: Date | null;
}

export async function listPendingEntities(client: DbClient, input: { status: PendingEntityStatusFilter; limit: number }): Promise<PendingEntityRow[]> {
  const result = await client.query<PendingEntityRow>(
    `SELECT pending_id, surface, context, first_seen_at, occurrence_count, status, resolved_entity_id, reviewer, reviewed_at
     FROM pending_entities
     WHERE ($1 = 'all' OR status = $1)
     ORDER BY
       CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
       occurrence_count DESC,
       first_seen_at ASC
     LIMIT $2`,
    [input.status, input.limit]
  );
  return result.rows;
}

export async function getPendingEntity(client: DbClient, pendingId: string): Promise<PendingEntityRow | undefined> {
  const result = await client.query<PendingEntityRow>(
    `SELECT pending_id, surface, context, first_seen_at, occurrence_count, status, resolved_entity_id, reviewer, reviewed_at
     FROM pending_entities
     WHERE pending_id = $1`,
    [pendingId]
  );
  return result.rows[0];
}

export interface EdgeRow extends pg.QueryResultRow {
  edge_id: string;
  subject_id: string;
  object_id: string;
  relation: RelationType;
  component: string | null;
  component_id: string | null;
  component_specificity: string | null;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  validity: "current" | "historical" | "deprecated";
  primary_evidence_id: string | null;
  last_verified_at: Date;
  subject_name: string;
  object_name: string;
}

export async function listCurrentEdges(client: DbClient): Promise<EdgeRow[]> {
  const result = await client.query<EdgeRow>(
    `SELECT e.*, s.display_name AS subject_name, o.display_name AS object_name
     FROM edges e
     JOIN entity_master s ON s.entity_id = e.subject_id
     JOIN entity_master o ON o.entity_id = e.object_id
     WHERE e.validity = 'current'
     ORDER BY e.edge_id`
  );
  return result.rows;
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

export interface EvidenceDetailRow extends pg.QueryResultRow {
  evidence_id: string;
  edge_id: string | null;
  cite_text: string;
  cite_locator: string | null;
  cite_start_char: number | null;
  cite_end_char: number | null;
  cite_text_sha256: string | null;
  normalized_cite_text_sha256: string | null;
  source_snapshot_sha256: string | null;
  parser_version: string | null;
  extractor_version: string | null;
  relation_candidate_hash: string | null;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  extraction_method: ExtractionMethod;
  source_url: string;
  source_date: Date | null;
  fetched_at: Date;
  source_adapter_id: string;
  document_type: string;
  subject_name: string | null;
  object_name: string | null;
  relation: RelationType | null;
}

export async function getEvidence(client: DbClient, evidenceId: string): Promise<EvidenceDetailRow | undefined> {
  const result = await client.query<EvidenceDetailRow>(
    `SELECT ev.*, d.source_url, d.source_date, d.fetched_at, d.source_adapter_id, d.document_type,
            s.display_name AS subject_name, o.display_name AS object_name, ed.relation
     FROM evidence ev
     JOIN documents d ON d.doc_id = ev.doc_id
     LEFT JOIN edges ed ON ed.edge_id = ev.edge_id
     LEFT JOIN entity_master s ON s.entity_id = ed.subject_id
     LEFT JOIN entity_master o ON o.entity_id = ed.object_id
     WHERE ev.evidence_id = $1`,
    [evidenceId]
  );
  return result.rows[0];
}

export interface UnknownItemRow extends pg.QueryResultRow {
  unknown_id: string;
  question: string;
  why_unknown: string;
  blocking_data_sources: string[];
  proxies: string[];
  status: string;
}

export async function listUnknownItems(client: DbClient, scopeId: string): Promise<UnknownItemRow[]> {
  const result = await client.query<UnknownItemRow>(
    `SELECT unknown_id, question, why_unknown, blocking_data_sources, proxies, status
     FROM unknown_items
     WHERE scope_id = $1 AND status = 'open'
     ORDER BY created_at`,
    [scopeId]
  );
  return result.rows;
}

export async function resolveEntityId(client: DbClient, input: string): Promise<string> {
  const normalized = normalizeAlias(input);
  const entityResult = await client.query<{ entity_id: string } & pg.QueryResultRow>(
    `SELECT entity_id FROM entity_master
     WHERE lower(entity_id) = $1 OR lower(display_name) = $1 OR lower(canonical_name) = $1
     LIMIT 1`,
    [normalized]
  );
  if (entityResult.rows[0] !== undefined) return entityResult.rows[0].entity_id;
  const aliasResult = await client.query<{ entity_id: string } & pg.QueryResultRow>("SELECT entity_id FROM entity_alias WHERE alias_norm = $1 LIMIT 1", [
    normalized
  ]);
  const alias = aliasResult.rows[0];
  if (alias === undefined) throw new Error(`Cannot resolve entity: ${input}`);
  return alias.entity_id;
}
