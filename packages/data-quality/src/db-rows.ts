import type pg from "pg";

export interface EdgeWithoutEvidenceRow extends pg.QueryResultRow {
  edge_id: string;
  subject_id: string;
  object_id: string;
}

export interface EvidenceRow extends pg.QueryResultRow {
  evidence_id: string;
  edge_id: string | null;
  doc_id: string;
}

export interface CiteChunkRow extends pg.QueryResultRow {
  evidence_id: string;
  chunk_id: string | null;
  doc_id: string;
}

export interface EvidenceTraceRow extends pg.QueryResultRow {
  evidence_id: string;
  chunk_id: string | null;
  doc_id: string;
}

export interface DuplicateEvidenceTraceRow extends pg.QueryResultRow {
  relation_candidate_hash: string;
  normalized_cite_text_sha256: string;
  evidence_ids: string[];
  count: number;
}

export interface PrimaryEvidenceMismatchRow extends pg.QueryResultRow {
  edge_id: string;
  primary_evidence_id: string | null;
  expected_evidence_id: string;
}

export interface EmptyDocumentRow extends pg.QueryResultRow {
  doc_id: string;
  source_adapter_id: string;
}

export interface CountRow extends pg.QueryResultRow {
  count: number;
}
