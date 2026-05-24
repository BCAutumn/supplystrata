import type { DbClient } from "@supplystrata/db/read";
import type {
  CiteChunkRow,
  CountRow,
  DuplicateEvidenceTraceRow,
  EdgeWithoutEvidenceRow,
  EmptyDocumentRow,
  EvidenceRow,
  EvidenceTraceRow,
  PrimaryEvidenceMismatchRow
} from "./db-rows.js";

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

export interface DataQualityRule {
  readonly rule_id: string;
  readonly scope: "global" | "entity_specific";
  check(client: DbClient): Promise<DataQualityIssue[]>;
}

export interface EntityUnknownMapTarget {
  scope_id: string;
  label?: string;
  minimum_open_items: number;
}

export interface DataQualityCheckInput {
  entity_unknown_map_targets?: readonly EntityUnknownMapTarget[];
  checkedAt: string;
}

export async function runDataQualityChecks(client: DbClient, input: DataQualityCheckInput): Promise<DataQualitySummary> {
  const issues: DataQualityIssue[] = [];
  for (const rule of dataQualityRules(input)) {
    issues.push(...(await rule.check(client)));
  }

  const counts = countIssues(issues);
  return {
    checked_at: input.checkedAt,
    ok: counts.error === 0,
    counts,
    issues
  };
}

export const GLOBAL_DATA_QUALITY_RULES: readonly DataQualityRule[] = [
  { rule_id: "edge.current_without_active_evidence", scope: "global", check: checkCurrentEdgesHaveEvidence },
  { rule_id: "evidence.cite_text_too_short", scope: "global", check: checkActiveEvidenceHasUsableCiteText },
  { rule_id: "evidence.edge_missing", scope: "global", check: checkActiveEvidenceReferencesExistingEdges },
  { rule_id: "evidence.chunk_trace", scope: "global", check: checkActiveEvidenceCiteTextMatchesChunk },
  { rule_id: "evidence.traceability_metadata", scope: "global", check: checkActiveEvidenceTraceabilityMetadata },
  { rule_id: "evidence.duplicate_relation_candidate", scope: "global", check: checkActiveEvidenceCandidateDuplicates },
  { rule_id: "evidence.html_boundary_glue", scope: "global", check: checkActiveEvidenceHasNoHtmlBoundaryGlue },
  { rule_id: "evidence.llm_constraints", scope: "global", check: checkLlmEvidenceConstraints },
  { rule_id: "edge.primary_evidence_mismatch", scope: "global", check: checkPrimaryEvidenceMatchesBestEvidence },
  { rule_id: "document.parsed_without_chunks", scope: "global", check: checkParsedDocumentsHaveChunks }
];

export const ENTITY_SPECIFIC_DATA_QUALITY_RULES: readonly DataQualityRule[] = [];

export const DATA_QUALITY_RULES: readonly DataQualityRule[] = [...GLOBAL_DATA_QUALITY_RULES, ...ENTITY_SPECIFIC_DATA_QUALITY_RULES];

export function dataQualityRules(input: { entity_unknown_map_targets?: readonly EntityUnknownMapTarget[] } = {}): readonly DataQualityRule[] {
  return [...GLOBAL_DATA_QUALITY_RULES, ...unknownMapMinimumItemRules(input.entity_unknown_map_targets ?? [])];
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
  return result.rows.map((row) =>
    issue({
      ruleId: "edge.current_without_active_evidence",
      severity: "error",
      scopeKind: "edge",
      scopeId: row.edge_id,
      message: "Current edge has no active evidence.",
      detail: { subject_id: row.subject_id, object_id: row.object_id }
    })
  );
}

async function checkActiveEvidenceHasUsableCiteText(client: DbClient): Promise<DataQualityIssue[]> {
  const result = await client.query<EvidenceRow>(
    `SELECT evidence_id, edge_id, doc_id
     FROM evidence
     WHERE superseded_by IS NULL AND length(trim(cite_text)) < 30
     ORDER BY evidence_id`
  );
  return result.rows.map((row) =>
    issue({
      ruleId: "evidence.cite_text_too_short",
      severity: "error",
      scopeKind: "evidence",
      scopeId: row.evidence_id,
      message: "Active evidence cite_text must be at least 30 characters.",
      detail: { edge_id: row.edge_id, doc_id: row.doc_id }
    })
  );
}

async function checkActiveEvidenceReferencesExistingEdges(client: DbClient): Promise<DataQualityIssue[]> {
  const result = await client.query<EvidenceRow>(
    `SELECT ev.evidence_id, ev.edge_id, ev.doc_id
     FROM evidence ev
     LEFT JOIN edges e ON e.edge_id = ev.edge_id
     WHERE ev.superseded_by IS NULL AND ev.edge_id IS NOT NULL AND e.edge_id IS NULL
     ORDER BY ev.evidence_id`
  );
  return result.rows.map((row) =>
    issue({
      ruleId: "evidence.edge_missing",
      severity: "error",
      scopeKind: "evidence",
      scopeId: row.evidence_id,
      message: "Active evidence references a missing edge.",
      detail: { edge_id: row.edge_id, doc_id: row.doc_id }
    })
  );
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
    ...missingChunk.rows.map((row) =>
      issue({
        ruleId: "evidence.chunk_missing",
        severity: "warn",
        scopeKind: "evidence",
        scopeId: row.evidence_id,
        message: "Active evidence has no chunk_id; manual evidence may be acceptable, but automated evidence should point to a chunk.",
        detail: { doc_id: row.doc_id }
      })
    ),
    ...mismatch.rows.map((row) =>
      issue({
        ruleId: "evidence.cite_text_not_in_chunk",
        severity: "error",
        scopeKind: "evidence",
        scopeId: row.evidence_id,
        message: "Active evidence cite_text is not a substring of its chunk.",
        detail: { chunk_id: row.chunk_id, doc_id: row.doc_id }
      })
    )
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
    ...missingFingerprint.rows.map((row) =>
      issue({
        ruleId: "evidence.traceability_metadata_missing",
        severity: "warn",
        scopeKind: "evidence",
        scopeId: row.evidence_id,
        message: "Active evidence is missing fingerprint/version metadata; existing historical rows should be backfilled.",
        detail: { chunk_id: row.chunk_id, doc_id: row.doc_id }
      })
    ),
    ...offsetMismatch.rows.map((row) =>
      issue({
        ruleId: "evidence.cite_offset_mismatch",
        severity: "error",
        scopeKind: "evidence",
        scopeId: row.evidence_id,
        message: "Active evidence cite_start_char/cite_end_char does not reproduce cite_text from the chunk.",
        detail: { chunk_id: row.chunk_id, doc_id: row.doc_id }
      })
    )
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

  return duplicates.rows.map((row) =>
    issue({
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
    })
  );
}

async function checkActiveEvidenceHasNoHtmlBoundaryGlue(client: DbClient): Promise<DataQualityIssue[]> {
  const result = await client.query<EvidenceRow>(
    `SELECT evidence_id, edge_id, doc_id
     FROM evidence
     WHERE superseded_by IS NULL AND cite_text ~ '[[:lower:]]\\.[[:upper:]]'
     ORDER BY evidence_id`
  );
  return result.rows.map((row) =>
    issue({
      ruleId: "evidence.html_boundary_glue",
      severity: "warn",
      scopeKind: "evidence",
      scopeId: row.evidence_id,
      message: "Active evidence cite_text may contain HTML block-boundary glue.",
      detail: { edge_id: row.edge_id, doc_id: row.doc_id }
    })
  );
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
    ...levelFive.rows.map((row) =>
      issue({
        ruleId: "evidence.llm_level_5",
        severity: "error",
        scopeKind: "evidence",
        scopeId: row.evidence_id,
        message: "LLM evidence must not be Level 5.",
        detail: { edge_id: row.edge_id, doc_id: row.doc_id }
      })
    ),
    ...missingMeta.rows.map((row) =>
      issue({
        ruleId: "evidence.llm_meta_missing",
        severity: "error",
        scopeKind: "evidence",
        scopeId: row.evidence_id,
        message: "LLM evidence must keep llm_meta for auditability.",
        detail: { edge_id: row.edge_id, doc_id: row.doc_id }
      })
    )
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
  return result.rows.map((row) =>
    issue({
      ruleId: "edge.primary_evidence_mismatch",
      severity: "error",
      scopeKind: "edge",
      scopeId: row.edge_id,
      message: "Current edge primary_evidence_id does not point to the best active evidence.",
      detail: { primary_evidence_id: row.primary_evidence_id, expected_evidence_id: row.expected_evidence_id }
    })
  );
}

async function checkParsedDocumentsHaveChunks(client: DbClient): Promise<DataQualityIssue[]> {
  const result = await client.query<EmptyDocumentRow>(
    `SELECT d.doc_id, d.source_adapter_id
     FROM documents d
     WHERE d.parse_status = 'parsed'
       AND NOT EXISTS (SELECT 1 FROM document_chunks c WHERE c.doc_id = d.doc_id)
     ORDER BY d.doc_id`
  );
  return result.rows.map((row) =>
    issue({
      ruleId: "document.parsed_without_chunks",
      severity: "error",
      scopeKind: "document",
      scopeId: row.doc_id,
      message: "Parsed document has no chunks.",
      detail: { source_adapter_id: row.source_adapter_id }
    })
  );
}

function unknownMapMinimumItemRules(targets: readonly EntityUnknownMapTarget[]): DataQualityRule[] {
  return targets.map((target) => ({
    rule_id: `unknown_map.minimum_open_items.${target.scope_id}`,
    scope: "entity_specific",
    check: (client) => checkEntityUnknownMapMinimum(client, target)
  }));
}

async function checkEntityUnknownMapMinimum(client: DbClient, target: EntityUnknownMapTarget): Promise<DataQualityIssue[]> {
  const result = await client.query<CountRow>(
    `SELECT count(*)::int AS count
     FROM unknown_items
     WHERE scope_kind = 'company' AND scope_id = $1 AND status = 'open'`,
    [target.scope_id]
  );
  const count = result.rows[0]?.count ?? 0;
  if (count >= target.minimum_open_items) return [];
  const label = target.label ?? target.scope_id;
  return [
    issue({
      ruleId: `unknown_map.minimum_open_items.${target.scope_id}`,
      severity: "error",
      scopeKind: "company",
      scopeId: target.scope_id,
      message: `${label} unknown_map must keep at least ${target.minimum_open_items} open item(s).`,
      detail: { open_items: count, required_minimum: target.minimum_open_items }
    })
  ];
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
