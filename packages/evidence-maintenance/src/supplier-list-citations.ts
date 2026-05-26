import type pg from "pg";
import type { ComponentSpecificity, RelationType } from "@supplystrata/core";
import { type DatabaseStore, type DbTxClient } from "@supplystrata/db/write";
import { buildEvidenceTrace, normalizeCiteTextForHash } from "@supplystrata/evidence-trace";
import { findSupplierListCitationWindow } from "@supplystrata/supplier-list";

const SUPPLIER_LIST_EXTRACTOR_IDS = ["review.supplier-list-row", "review.supplier-list-facility-row"] as const;

export interface SupplierListEvidenceCitationRepairInput {
  limit?: number;
  batch_size?: number;
  active_only?: boolean;
}

export interface SupplierListEvidenceCitationRepairSummary {
  scanned: number;
  repaired: number;
  already_valid: number;
  not_reproducible: number;
}

interface SupplierListEvidenceCitationRow extends pg.QueryResultRow {
  evidence_id: string;
  cite_text: string;
  extractor_id: string | null;
  doc_id: string;
  chunk_id: string | null;
  bytes_sha256: string | null;
  metadata: Record<string, unknown>;
  chunk_text: string | null;
  subject_id: string | null;
  object_id: string | null;
  relation: RelationType | null;
  component: string | null;
  component_id: string | null;
  component_specificity: ComponentSpecificity | null;
  supplier_name: string | null;
  location_text: string | null;
  country_or_region: string | null;
}

interface SupplierListChunkRow extends pg.QueryResultRow {
  chunk_id: string;
  text: string;
}

export async function repairSupplierListEvidenceCitations(
  client: DbTxClient,
  input: SupplierListEvidenceCitationRepairInput = {}
): Promise<SupplierListEvidenceCitationRepairSummary> {
  const limit = input.limit ?? 1000;
  const activeOnly = input.active_only !== false;
  const rows = await client.query<SupplierListEvidenceCitationRow>(
    `SELECT ev.evidence_id, ev.cite_text, ev.extractor_id, ev.doc_id, ev.chunk_id,
            d.bytes_sha256, d.metadata, c.text AS chunk_text,
            e.subject_id, e.object_id, e.relation, e.component, e.component_id, e.component_specificity,
            COALESCE(
              rc.candidate->'payload'->>'supplier_name',
              CASE
                WHEN e.relation = 'BUYS_FROM' THEN object_entity.display_name
                WHEN e.relation = 'MANUFACTURES_AT' THEN subject_entity.display_name
                ELSE NULL
              END
            ) AS supplier_name,
            COALESCE(rc.candidate->'payload'->>'location_text', facility_entity.attrs->>'location_text') AS location_text,
            COALESCE(rc.candidate->'payload'->>'country_or_region', facility_entity.attrs->>'country_or_region') AS country_or_region
     FROM evidence ev
     JOIN documents d ON d.doc_id = ev.doc_id
     LEFT JOIN document_chunks c ON c.chunk_id = ev.chunk_id
     LEFT JOIN edges e ON e.edge_id = ev.edge_id
     LEFT JOIN review_candidates rc ON rc.doc_id = ev.doc_id
       AND rc.kind = 'supplier_list_row'
       AND rc.candidate->'evidence'->>'source_locator' = ev.cite_locator
     LEFT JOIN entity_master subject_entity ON subject_entity.entity_id = e.subject_id
     LEFT JOIN entity_master object_entity ON object_entity.entity_id = e.object_id
     LEFT JOIN entity_master facility_entity ON facility_entity.entity_id = e.object_id AND e.relation = 'MANUFACTURES_AT'
     WHERE ev.extractor_id = ANY($2::text[])
       AND ($3::boolean = false OR ev.superseded_by IS NULL)
     ORDER BY ev.created_at, ev.evidence_id
     LIMIT $1`,
    [limit, [...SUPPLIER_LIST_EXTRACTOR_IDS], activeOnly]
  );

  let repaired = 0;
  let alreadyValid = 0;
  let notReproducible = 0;
  for (const row of rows.rows) {
    const citation = await supplierListRepairCitation(client, row);
    if (citation.status === "already_valid") {
      alreadyValid += 1;
      continue;
    }
    if (citation.status === "not_reproducible") {
      notReproducible += 1;
      continue;
    }

    const trace = buildEvidenceTrace({
      cite_text: citation.citeText,
      extractor_id: row.extractor_id,
      source_snapshot_sha256: row.bytes_sha256,
      document_metadata: row.metadata,
      identity: {
        subject_id: row.subject_id,
        object_id: row.object_id,
        relation: row.relation,
        component: {
          component: row.component,
          component_id: row.component_id,
          component_specificity: row.component_specificity
        }
      },
      chunk_text: citation.chunkText
    });

    await client.query(
      `UPDATE evidence
       SET cite_text = $2,
           chunk_id = $3,
           cite_start_char = $4,
           cite_end_char = $5,
           cite_text_sha256 = $6,
           normalized_cite_text_sha256 = $7,
           source_snapshot_sha256 = $8,
           parser_version = $9,
           extractor_version = $10,
           relation_candidate_hash = $11
       WHERE evidence_id = $1`,
      [
        row.evidence_id,
        citation.citeText,
        citation.chunkId,
        trace.cite_start_char,
        trace.cite_end_char,
        trace.cite_text_sha256,
        trace.normalized_cite_text_sha256,
        trace.source_snapshot_sha256,
        trace.parser_version,
        trace.extractor_version,
        trace.relation_candidate_hash
      ]
    );
    repaired += 1;
  }

  return {
    scanned: rows.rowCount ?? rows.rows.length,
    repaired,
    already_valid: alreadyValid,
    not_reproducible: notReproducible
  };
}

type SupplierListRepairCitationResult =
  | { status: "already_valid" }
  | { status: "not_reproducible" }
  | { status: "repair"; chunkId: string; chunkText: string; citeText: string };

async function supplierListRepairCitation(client: DbTxClient, row: SupplierListEvidenceCitationRow): Promise<SupplierListRepairCitationResult> {
  if (row.chunk_id !== null && row.chunk_text !== null && row.chunk_text.includes(row.cite_text) && row.cite_text.length >= 30) {
    return { status: "already_valid" };
  }

  const chunks = await loadSupplierListChunks(client, row);
  for (const chunk of chunks) {
    const citeText = citationTextForChunk(row, chunk.text);
    if (citeText.length > 0 && chunk.text.includes(citeText)) return { status: "repair", chunkId: chunk.chunk_id, chunkText: chunk.text, citeText };
  }
  return { status: "not_reproducible" };
}

async function loadSupplierListChunks(client: DbTxClient, row: SupplierListEvidenceCitationRow): Promise<SupplierListChunkRow[]> {
  if (row.chunk_id !== null && row.chunk_text !== null) return [{ chunk_id: row.chunk_id, text: row.chunk_text }];
  const result = await client.query<SupplierListChunkRow>(
    `SELECT chunk_id, text
     FROM document_chunks
     WHERE doc_id = $1
     ORDER BY chunk_index`,
    [row.doc_id]
  );
  return result.rows;
}

function citationTextForChunk(row: SupplierListEvidenceCitationRow, chunkText: string): string {
  const normalized = normalizeCiteTextForHash(row.cite_text);
  if (normalized.length >= 30 && chunkText.includes(normalized)) return normalized;
  if (row.supplier_name === null || row.supplier_name.trim().length === 0) return normalized;
  const contextual = findSupplierListCitationWindow({
    chunkText,
    supplierName: row.supplier_name,
    sourceRowText: row.cite_text,
    locationText: row.location_text ?? row.cite_text,
    countryOrRegion: row.country_or_region ?? ""
  });
  return contextual ?? normalized;
}

export async function repairSupplierListEvidenceCitationsTransactionally(
  store: DatabaseStore,
  input: SupplierListEvidenceCitationRepairInput = {}
): Promise<SupplierListEvidenceCitationRepairSummary> {
  const limit = input.limit ?? 1000;
  const batchSize = input.batch_size ?? Math.min(limit, 100);
  if (!Number.isInteger(limit) || limit <= 0) throw new Error(`Supplier-list citation repair limit must be a positive integer: ${limit}`);
  if (!Number.isInteger(batchSize) || batchSize <= 0) throw new Error(`Supplier-list citation repair batch_size must be a positive integer: ${batchSize}`);

  let scanned = 0;
  let repaired = 0;
  let alreadyValid = 0;
  let notReproducible = 0;
  while (scanned < limit) {
    const nextLimit = Math.min(batchSize, limit - scanned);
    const batch = await store.transaction((client) =>
      repairSupplierListEvidenceCitations(client, {
        limit: nextLimit,
        ...(input.active_only === undefined ? {} : { active_only: input.active_only })
      })
    );
    scanned += batch.scanned;
    repaired += batch.repaired;
    alreadyValid += batch.already_valid;
    notReproducible += batch.not_reproducible;
    if (batch.scanned < nextLimit) break;
  }

  return { scanned, repaired, already_valid: alreadyValid, not_reproducible: notReproducible };
}
