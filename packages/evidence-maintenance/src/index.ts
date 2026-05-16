import type pg from "pg";
import type { CandidateRelation, ComponentSpecificity, RelationType } from "@supplystrata/core";
import type { DbClient } from "@supplystrata/db";
import { buildEvidenceTrace } from "@supplystrata/evidence-trace";

interface EvidenceTraceBackfillRow extends pg.QueryResultRow {
  evidence_id: string;
  cite_text: string;
  extractor_id: string | null;
  llm_meta: unknown;
  doc_id: string;
  chunk_id: string | null;
  bytes_sha256: string;
  metadata: Record<string, unknown>;
  chunk_text: string | null;
  subject_id: string | null;
  object_id: string | null;
  relation: RelationType | null;
  component: string | null;
  component_id: string | null;
  component_specificity: ComponentSpecificity | null;
}

export interface EvidenceTraceBackfillSummary {
  scanned: number;
  updated: number;
  offset_missing: number;
}

export async function backfillEvidenceTrace(client: DbClient, input: { limit?: number } = {}): Promise<EvidenceTraceBackfillSummary> {
  const limit = input.limit ?? 1000;
  const rows = await client.query<EvidenceTraceBackfillRow>(
    `SELECT ev.evidence_id, ev.cite_text, ev.extractor_id, ev.llm_meta, ev.doc_id, ev.chunk_id,
            d.bytes_sha256, d.metadata, c.text AS chunk_text,
            e.subject_id, e.object_id, e.relation, e.component, e.component_id, e.component_specificity
     FROM evidence ev
     JOIN documents d ON d.doc_id = ev.doc_id
     LEFT JOIN document_chunks c ON c.chunk_id = ev.chunk_id
     LEFT JOIN edges e ON e.edge_id = ev.edge_id
     WHERE ev.cite_text_sha256 IS NULL
        OR ev.normalized_cite_text_sha256 IS NULL
        OR ev.source_snapshot_sha256 IS NULL
        OR ev.parser_version IS NULL
        OR ev.extractor_version IS NULL
        OR ev.relation_candidate_hash IS NULL
        OR (ev.chunk_id IS NOT NULL AND (ev.cite_start_char IS NULL OR ev.cite_end_char IS NULL))
     ORDER BY ev.created_at, ev.evidence_id
     LIMIT $1`,
    [limit]
  );

  let updated = 0;
  let offsetMissing = 0;
  for (const row of rows.rows) {
    const llmMeta = parseLlmMeta(row.llm_meta);
    const trace = buildEvidenceTrace({
      cite_text: row.cite_text,
      extractor_id: row.extractor_id,
      ...(llmMeta === undefined ? {} : { llm_meta: llmMeta }),
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
      ...(row.chunk_text === null ? {} : { chunk_text: row.chunk_text })
    });

    await client.query(
      `UPDATE evidence
       SET cite_start_char = $2,
           cite_end_char = $3,
           cite_text_sha256 = $4,
           normalized_cite_text_sha256 = $5,
           source_snapshot_sha256 = $6,
           parser_version = $7,
           extractor_version = $8,
           relation_candidate_hash = $9
       WHERE evidence_id = $1`,
      [
        row.evidence_id,
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
    updated += 1;
    if (row.chunk_id !== null && (trace.cite_start_char === null || trace.cite_end_char === null)) offsetMissing += 1;
  }

  return { scanned: rows.rowCount ?? rows.rows.length, updated, offset_missing: offsetMissing };
}

function parseLlmMeta(value: unknown): CandidateRelation["llm_meta"] | undefined {
  if (!isRecord(value)) return undefined;
  const model = value["model"];
  const promptHash = value["prompt_hash"];
  if (typeof model !== "string" || typeof promptHash !== "string") return undefined;
  return { model, prompt_hash: promptHash };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
