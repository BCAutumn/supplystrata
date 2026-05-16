import type pg from "pg";
import type { DbClient } from "@supplystrata/db";

export type DataQualitySeverity = "error" | "warn" | "info";

export interface DataQualityIssue {
  rule_id: string;
  severity: DataQualitySeverity;
  scope_kind: string;
  scope_id: string;
  message: string;
  detail: Record<string, unknown>;
}

export interface DataQualitySummary {
  checked_at: string;
  ok: boolean;
  counts: Record<DataQualitySeverity, number>;
  issues: DataQualityIssue[];
}

interface EdgeWithoutEvidenceRow extends pg.QueryResultRow {
  edge_id: string;
  subject_id: string;
  object_id: string;
}

interface EvidenceRow extends pg.QueryResultRow {
  evidence_id: string;
  edge_id: string | null;
  doc_id: string;
}

interface CiteChunkRow extends pg.QueryResultRow {
  evidence_id: string;
  chunk_id: string | null;
  doc_id: string;
}

interface EvidenceTraceRow extends pg.QueryResultRow {
  evidence_id: string;
  chunk_id: string | null;
  doc_id: string;
}

interface DuplicateEvidenceTraceRow extends pg.QueryResultRow {
  relation_candidate_hash: string;
  normalized_cite_text_sha256: string;
  evidence_ids: string[];
  count: number;
}

interface PrimaryEvidenceMismatchRow extends pg.QueryResultRow {
  edge_id: string;
  primary_evidence_id: string | null;
  expected_evidence_id: string;
}

interface EmptyDocumentRow extends pg.QueryResultRow {
  doc_id: string;
  source_adapter_id: string;
}

interface CountRow extends pg.QueryResultRow {
  count: number;
}

export async function runDataQualityChecks(client: DbClient): Promise<DataQualitySummary> {
  const issues: DataQualityIssue[] = [];
  issues.push(...await checkCurrentEdgesHaveEvidence(client));
  issues.push(...await checkActiveEvidenceHasUsableCiteText(client));
  issues.push(...await checkActiveEvidenceReferencesExistingEdges(client));
  issues.push(...await checkActiveEvidenceCiteTextMatchesChunk(client));
  issues.push(...await checkActiveEvidenceTraceabilityMetadata(client));
  issues.push(...await checkActiveEvidenceCandidateDuplicates(client));
  issues.push(...await checkActiveEvidenceHasNoHtmlBoundaryGlue(client));
  issues.push(...await checkLlmEvidenceConstraints(client));
  issues.push(...await checkPrimaryEvidenceMatchesBestEvidence(client));
  issues.push(...await checkParsedDocumentsHaveChunks(client));
  issues.push(...await checkNvidiaUnknownMap(client));

  const counts = countIssues(issues);
  return {
    checked_at: new Date().toISOString(),
    ok: counts.error === 0,
    counts,
    issues
  };
}

async function checkCurrentEdgesHaveEvidence(client: DbClient): Promise<DataQualityIssue[]> {
  const result = await client.query<EdgeWithoutEvidenceRow>(
    `SELECT e.edge_id, e.subject_id, e.object_id
     FROM edges e
     LEFT JOIN evidence ev ON ev.edge_id = e.edge_id AND ev.superseded_by IS NULL
     WHERE e.validity = 'current'
     GROUP BY e.edge_id, e.subject_id, e.object_id
     HAVING count(ev.evidence_id) = 0
     ORDER BY e.edge_id`
  );
  return result.rows.map((row) => issue({
    ruleId: "edge.current_without_active_evidence",
    severity: "error",
    scopeKind: "edge",
    scopeId: row.edge_id,
    message: "Current edge has no active evidence.",
    detail: { subject_id: row.subject_id, object_id: row.object_id }
  }));
}

async function checkActiveEvidenceHasUsableCiteText(client: DbClient): Promise<DataQualityIssue[]> {
  const result = await client.query<EvidenceRow>(
    `SELECT evidence_id, edge_id, doc_id
     FROM evidence
     WHERE superseded_by IS NULL AND length(trim(cite_text)) < 30
     ORDER BY evidence_id`
  );
  return result.rows.map((row) => issue({
    ruleId: "evidence.cite_text_too_short",
    severity: "error",
    scopeKind: "evidence",
    scopeId: row.evidence_id,
    message: "Active evidence cite_text must be at least 30 characters.",
    detail: { edge_id: row.edge_id, doc_id: row.doc_id }
  }));
}

async function checkActiveEvidenceReferencesExistingEdges(client: DbClient): Promise<DataQualityIssue[]> {
  const result = await client.query<EvidenceRow>(
    `SELECT ev.evidence_id, ev.edge_id, ev.doc_id
     FROM evidence ev
     LEFT JOIN edges e ON e.edge_id = ev.edge_id
     WHERE ev.superseded_by IS NULL AND ev.edge_id IS NOT NULL AND e.edge_id IS NULL
     ORDER BY ev.evidence_id`
  );
  return result.rows.map((row) => issue({
    ruleId: "evidence.edge_missing",
    severity: "error",
    scopeKind: "evidence",
    scopeId: row.evidence_id,
    message: "Active evidence references a missing edge.",
    detail: { edge_id: row.edge_id, doc_id: row.doc_id }
  }));
}

async function checkActiveEvidenceCiteTextMatchesChunk(client: DbClient): Promise<DataQualityIssue[]> {
  const missingChunk = await client.query<CiteChunkRow>(
    `SELECT evidence_id, chunk_id, doc_id
     FROM evidence
     WHERE superseded_by IS NULL AND chunk_id IS NULL
     ORDER BY evidence_id`
  );
  const mismatch = await client.query<CiteChunkRow>(
    `SELECT ev.evidence_id, ev.chunk_id, ev.doc_id
     FROM evidence ev
     JOIN document_chunks c ON c.chunk_id = ev.chunk_id
     WHERE ev.superseded_by IS NULL AND position(ev.cite_text in c.text) = 0
     ORDER BY ev.evidence_id`
  );
  return [
    ...missingChunk.rows.map((row) => issue({
      ruleId: "evidence.chunk_missing",
      severity: "warn",
      scopeKind: "evidence",
      scopeId: row.evidence_id,
      message: "Active evidence has no chunk_id; manual evidence may be acceptable, but automated evidence should point to a chunk.",
      detail: { doc_id: row.doc_id }
    })),
    ...mismatch.rows.map((row) => issue({
      ruleId: "evidence.cite_text_not_in_chunk",
      severity: "error",
      scopeKind: "evidence",
      scopeId: row.evidence_id,
      message: "Active evidence cite_text is not a substring of its chunk.",
      detail: { chunk_id: row.chunk_id, doc_id: row.doc_id }
    }))
  ];
}

async function checkActiveEvidenceTraceabilityMetadata(client: DbClient): Promise<DataQualityIssue[]> {
  const missingFingerprint = await client.query<EvidenceTraceRow>(
    `SELECT evidence_id, chunk_id, doc_id
     FROM evidence
     WHERE superseded_by IS NULL
       AND (
         cite_text_sha256 IS NULL
         OR normalized_cite_text_sha256 IS NULL
         OR source_snapshot_sha256 IS NULL
         OR parser_version IS NULL
         OR extractor_version IS NULL
         OR relation_candidate_hash IS NULL
       )
     ORDER BY evidence_id`
  );
  const offsetMismatch = await client.query<EvidenceTraceRow>(
    `SELECT ev.evidence_id, ev.chunk_id, ev.doc_id
     FROM evidence ev
     JOIN document_chunks c ON c.chunk_id = ev.chunk_id
     WHERE ev.superseded_by IS NULL
       AND ev.cite_start_char IS NOT NULL
       AND ev.cite_end_char IS NOT NULL
       AND (
         ev.cite_start_char < 0
         OR ev.cite_end_char < ev.cite_start_char
         OR ev.cite_end_char > length(c.text)
         OR substring(c.text from ev.cite_start_char + 1 for ev.cite_end_char - ev.cite_start_char) <> ev.cite_text
       )
     ORDER BY ev.evidence_id`
  );

  return [
    ...missingFingerprint.rows.map((row) => issue({
      ruleId: "evidence.traceability_metadata_missing",
      severity: "warn",
      scopeKind: "evidence",
      scopeId: row.evidence_id,
      message: "Active evidence is missing fingerprint/version metadata; existing historical rows should be backfilled.",
      detail: { chunk_id: row.chunk_id, doc_id: row.doc_id }
    })),
    ...offsetMismatch.rows.map((row) => issue({
      ruleId: "evidence.cite_offset_mismatch",
      severity: "error",
      scopeKind: "evidence",
      scopeId: row.evidence_id,
      message: "Active evidence cite_start_char/cite_end_char does not reproduce cite_text from the chunk.",
      detail: { chunk_id: row.chunk_id, doc_id: row.doc_id }
    }))
  ];
}

async function checkActiveEvidenceCandidateDuplicates(client: DbClient): Promise<DataQualityIssue[]> {
  const duplicates = await client.query<DuplicateEvidenceTraceRow>(
    `SELECT relation_candidate_hash,
            normalized_cite_text_sha256,
            array_agg(evidence_id ORDER BY evidence_id) AS evidence_ids,
            count(*)::int AS count
     FROM evidence
     WHERE superseded_by IS NULL
       AND relation_candidate_hash IS NOT NULL
       AND normalized_cite_text_sha256 IS NOT NULL
     GROUP BY relation_candidate_hash, normalized_cite_text_sha256
     HAVING count(*) > 1
     ORDER BY relation_candidate_hash`
  );

  return duplicates.rows.map((row) => issue({
    ruleId: "evidence.duplicate_relation_candidate",
    severity: "warn",
    scopeKind: "evidence",
    scopeId: row.evidence_ids[0] ?? row.relation_candidate_hash,
    message: "Multiple active evidence rows share the same relation candidate fingerprint.",
    detail: {
      relation_candidate_hash: row.relation_candidate_hash,
      normalized_cite_text_sha256: row.normalized_cite_text_sha256,
      evidence_ids: row.evidence_ids,
      count: row.count
    }
  }));
}

async function checkActiveEvidenceHasNoHtmlBoundaryGlue(client: DbClient): Promise<DataQualityIssue[]> {
  const result = await client.query<EvidenceRow>(
    `SELECT evidence_id, edge_id, doc_id
     FROM evidence
     WHERE superseded_by IS NULL AND cite_text ~ '[[:lower:]]\\.[[:upper:]]'
     ORDER BY evidence_id`
  );
  return result.rows.map((row) => issue({
    ruleId: "evidence.html_boundary_glue",
    severity: "warn",
    scopeKind: "evidence",
    scopeId: row.evidence_id,
    message: "Active evidence cite_text may contain HTML block-boundary glue.",
    detail: { edge_id: row.edge_id, doc_id: row.doc_id }
  }));
}

async function checkLlmEvidenceConstraints(client: DbClient): Promise<DataQualityIssue[]> {
  const levelFive = await client.query<EvidenceRow>(
    `SELECT evidence_id, edge_id, doc_id
     FROM evidence
     WHERE superseded_by IS NULL AND extraction_method = 'llm' AND evidence_level = 5
     ORDER BY evidence_id`
  );
  const missingMeta = await client.query<EvidenceRow>(
    `SELECT evidence_id, edge_id, doc_id
     FROM evidence
     WHERE superseded_by IS NULL AND extraction_method = 'llm' AND llm_meta IS NULL
     ORDER BY evidence_id`
  );
  return [
    ...levelFive.rows.map((row) => issue({
      ruleId: "evidence.llm_level_5",
      severity: "error",
      scopeKind: "evidence",
      scopeId: row.evidence_id,
      message: "LLM evidence must not be Level 5.",
      detail: { edge_id: row.edge_id, doc_id: row.doc_id }
    })),
    ...missingMeta.rows.map((row) => issue({
      ruleId: "evidence.llm_meta_missing",
      severity: "error",
      scopeKind: "evidence",
      scopeId: row.evidence_id,
      message: "LLM evidence must keep llm_meta for auditability.",
      detail: { edge_id: row.edge_id, doc_id: row.doc_id }
    }))
  ];
}

async function checkPrimaryEvidenceMatchesBestEvidence(client: DbClient): Promise<DataQualityIssue[]> {
  const result = await client.query<PrimaryEvidenceMismatchRow>(
    `WITH best_evidence AS (
       SELECT DISTINCT ON (edge_id)
              edge_id,
              evidence_id AS expected_evidence_id
       FROM evidence
       WHERE edge_id IS NOT NULL AND superseded_by IS NULL
       ORDER BY edge_id, evidence_level DESC, confidence DESC, created_at DESC, evidence_id DESC
     )
     SELECT e.edge_id, e.primary_evidence_id, best_evidence.expected_evidence_id
     FROM edges e
     JOIN best_evidence ON best_evidence.edge_id = e.edge_id
     WHERE e.validity = 'current'
       AND e.primary_evidence_id IS DISTINCT FROM best_evidence.expected_evidence_id
     ORDER BY e.edge_id`
  );
  return result.rows.map((row) => issue({
    ruleId: "edge.primary_evidence_mismatch",
    severity: "error",
    scopeKind: "edge",
    scopeId: row.edge_id,
    message: "Current edge primary_evidence_id does not point to the best active evidence.",
    detail: { primary_evidence_id: row.primary_evidence_id, expected_evidence_id: row.expected_evidence_id }
  }));
}

async function checkParsedDocumentsHaveChunks(client: DbClient): Promise<DataQualityIssue[]> {
  const result = await client.query<EmptyDocumentRow>(
    `SELECT d.doc_id, d.source_adapter_id
     FROM documents d
     WHERE d.parse_status = 'parsed'
       AND NOT EXISTS (SELECT 1 FROM document_chunks c WHERE c.doc_id = d.doc_id)
     ORDER BY d.doc_id`
  );
  return result.rows.map((row) => issue({
    ruleId: "document.parsed_without_chunks",
    severity: "error",
    scopeKind: "document",
    scopeId: row.doc_id,
    message: "Parsed document has no chunks.",
    detail: { source_adapter_id: row.source_adapter_id }
  }));
}

async function checkNvidiaUnknownMap(client: DbClient): Promise<DataQualityIssue[]> {
  const result = await client.query<CountRow>(
    `SELECT count(*)::int AS count
     FROM unknown_items
     WHERE scope_kind = 'company' AND scope_id = 'ENT-NVIDIA' AND status = 'open'`
  );
  const count = result.rows[0]?.count ?? 0;
  if (count >= 5) return [];
  return [issue({
    ruleId: "unknown_map.nvidia_minimum_items",
    severity: "error",
    scopeKind: "company",
    scopeId: "ENT-NVIDIA",
    message: "NVIDIA unknown_map must keep at least 5 open items.",
    detail: { open_items: count, required_minimum: 5 }
  })];
}

function countIssues(issues: DataQualityIssue[]): Record<DataQualitySeverity, number> {
  return {
    error: issues.filter((item) => item.severity === "error").length,
    warn: issues.filter((item) => item.severity === "warn").length,
    info: issues.filter((item) => item.severity === "info").length
  };
}

function issue(input: {
  ruleId: string;
  severity: DataQualitySeverity;
  scopeKind: string;
  scopeId: string;
  message: string;
  detail?: Record<string, unknown>;
}): DataQualityIssue {
  return {
    rule_id: input.ruleId,
    severity: input.severity,
    scope_kind: input.scopeKind,
    scope_id: input.scopeId,
    message: input.message,
    detail: input.detail ?? {}
  };
}
