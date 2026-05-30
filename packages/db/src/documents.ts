import type pg from "pg";
import type { NormalizedDocument } from "@supplystrata/core";
import type { DatabaseStore, DbClient, DbTxClient } from "./client.js";

export interface SavedDocumentRef {
  doc_id: string;
  chunks: { chunk_id: string; text: string; locator: string }[];
}

interface SavedDocumentRow extends pg.QueryResultRow {
  doc_id: string;
}

export async function saveNormalizedDocument(store: DatabaseStore, doc: NormalizedDocument): Promise<SavedDocumentRef> {
  return store.transaction((client) => saveNormalizedDocumentTx(client, doc));
}

export async function saveNormalizedDocumentTx(client: DbTxClient, doc: NormalizedDocument): Promise<SavedDocumentRef> {
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
    savedChunks.push({ chunk_id: chunkId, text: chunk.text, locator: chunk.locator });
  }
  return { doc_id: savedDocId, chunks: savedChunks };
}

function chunkIdForIndex(docId: string, index: number): string {
  return `${docId}-CHK-${String(index + 1).padStart(4, "0")}`;
}

export interface ExtractableDocumentFilter {
  entityId?: string;
  sourceAdapterId?: string;
  documentTypes?: readonly string[];
  limit?: number;
}

interface ExtractableDocumentIdRow extends pg.QueryResultRow {
  doc_id: string;
}

// 选出"已落库、已解析、且绑定了主体实体"的文档，用于在抽取器升级后对存量文档重跑事实提升（backfill）。
// 只看 primary_entity_id 非空：没有主体的文档无法构成边的一端，重抽也没有意义。
export async function listExtractableDocumentIds(client: DbClient, filter: ExtractableDocumentFilter = {}): Promise<string[]> {
  const clauses: string[] = ["primary_entity_id IS NOT NULL", "parse_status = 'parsed'"];
  const params: unknown[] = [];
  if (filter.entityId !== undefined) {
    params.push(filter.entityId);
    clauses.push(`primary_entity_id = $${params.length}`);
  }
  if (filter.sourceAdapterId !== undefined) {
    params.push(filter.sourceAdapterId);
    clauses.push(`source_adapter_id = $${params.length}`);
  }
  if (filter.documentTypes !== undefined && filter.documentTypes.length > 0) {
    params.push([...filter.documentTypes]);
    clauses.push(`document_type = ANY($${params.length})`);
  }
  params.push(filter.limit ?? 200);
  const result = await client.query<ExtractableDocumentIdRow>(
    `SELECT doc_id
     FROM documents
     WHERE ${clauses.join(" AND ")}
     ORDER BY source_date DESC NULLS LAST, doc_id
     LIMIT $${params.length}`,
    params
  );
  return result.rows.map((row) => row.doc_id);
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
  const docResult = await client.query<DocumentRow>(
    `SELECT doc_id, source_adapter_id, document_type, primary_entity_id, source_url, source_date,
            fetched_at, bytes_sha256, storage_key, language, metadata
     FROM documents
     WHERE doc_id = $1`,
    [docId]
  );
  const doc = docResult.rows[0];
  if (doc === undefined) throw new Error(`Document not found: ${docId}`);
  const chunkResult = await client.query<ChunkRow>(
    `SELECT chunk_id, text, locator, language, token_count
     FROM document_chunks
     WHERE doc_id = $1
     ORDER BY chunk_index`,
    [docId]
  );
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
