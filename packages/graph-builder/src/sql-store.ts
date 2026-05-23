import {
  createId,
  inferExtractionMethod,
  type ApplyResult,
  type ApprovedCandidate,
  type CandidateRelation,
  type ComponentSpecificity
} from "@supplystrata/core";
import { recordSemanticChange, type DbClient, type DbRow, type DbTxClient } from "@supplystrata/db/write";
import { buildEvidenceTrace } from "@supplystrata/evidence-trace";
import type { ComponentLookupRow, EdgeIdentityRow, EvidenceChunkRow, EvidenceDocumentRow } from "./db-rows.js";

export interface ApplyApprovedCandidateSqlInput {
  approved: ApprovedCandidate;
  subject_id: string;
  object_id: string;
}

export async function applyApprovedCandidateToSql(client: DbTxClient, input: ApplyApprovedCandidateSqlInput): Promise<Omit<ApplyResult, "graph_sync">> {
  const component = await resolveComponentReference(client, input.approved.candidate);
  const evidenceId = createId("EV");
  const traceInput = await loadEvidenceTraceInput(client, input.approved);
  const trace = buildEvidenceTrace({
    cite_text: input.approved.candidate.cite_text,
    extractor_id: input.approved.candidate.extractor_id,
    ...(input.approved.candidate.llm_meta === undefined ? {} : { llm_meta: input.approved.candidate.llm_meta }),
    source_snapshot_sha256: traceInput.source_snapshot_sha256,
    document_metadata: traceInput.document_metadata,
    identity: {
      subject_id: input.subject_id,
      object_id: input.object_id,
      relation: input.approved.candidate.relation,
      component
    },
    ...(traceInput.chunk_text === undefined ? {} : { chunk_text: traceInput.chunk_text }),
    ...(input.approved.candidate.source_location === undefined
      ? {}
      : {
          citation_location: {
            cite_start_char: input.approved.candidate.source_location.cite_start_char,
            cite_end_char: input.approved.candidate.source_location.cite_end_char
          }
        })
  });

  const edge = await upsertCurrentEdge(client, {
    edgeId: createId("EDGE"),
    subjectId: input.subject_id,
    objectId: input.object_id,
    approved: input.approved,
    component
  });
  if (edge.validity !== "current") throw new Error(`Cannot append reviewed evidence to deprecated edge: ${edge.edge_id}`);

  await insertEvidence(client, {
    edgeId: edge.edge_id,
    evidenceId,
    approved: input.approved,
    trace
  });
  await supersedeOlderEvidence(client, {
    edgeId: edge.edge_id,
    evidenceId,
    approved: input.approved
  });
  await updatePrimaryEvidence(client, edge.edge_id);
  const change = await recordSemanticChange(client, {
    scope_kind: "edge",
    scope_id: edge.edge_id,
    change_type: edge.inserted ? "new_edge" : "edge_evidence_added",
    after: { edge_id: edge.edge_id },
    evidence_ids: [evidenceId],
    caused_by: "review"
  });
  return { edge_id: edge.edge_id, evidence_id: evidenceId, change_id: change.change_id, is_new_edge: edge.inserted };
}

interface InsertOrUpdateEdgeInput {
  edgeId: string;
  approved: ApprovedCandidate;
  component: ComponentReference;
}

interface EdgeUpsertRow extends EdgeIdentityRow {
  inserted: boolean;
}

async function upsertCurrentEdge(
  client: DbTxClient,
  input: InsertOrUpdateEdgeInput & {
    subjectId: string;
    objectId: string;
  }
): Promise<EdgeUpsertRow> {
  const result = await client.query<EdgeUpsertRow>(
    `INSERT INTO edges (edge_id, subject_id, object_id, relation, component, component_id, component_specificity, evidence_level, confidence, is_inferred, validity)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'current')
     ON CONFLICT (
       subject_id,
       object_id,
       relation,
       COALESCE(component_id, ''),
       COALESCE(component, ''),
       COALESCE(effective_from, DATE '1900-01-01'),
       COALESCE(effective_to, DATE '2999-12-31')
     )
     DO UPDATE SET
       component = EXCLUDED.component,
       component_id = EXCLUDED.component_id,
       component_specificity = COALESCE(edges.component_specificity, EXCLUDED.component_specificity),
       evidence_level = GREATEST(edges.evidence_level, EXCLUDED.evidence_level),
       confidence = LEAST(0.97, GREATEST(edges.confidence, EXCLUDED.confidence)),
       is_inferred = EXCLUDED.is_inferred,
       last_verified_at = now(),
       updated_at = now()
     WHERE edges.validity = 'current'
     RETURNING edge_id, evidence_level, confidence, validity, (xmax = 0) AS inserted`,
    [
      input.edgeId,
      input.subjectId,
      input.objectId,
      input.approved.candidate.relation,
      input.component.component,
      input.component.component_id,
      input.component.component_specificity,
      input.approved.scoring.evidence_level,
      input.approved.scoring.confidence,
      input.approved.scoring.is_inferred
    ]
  );
  const row = result.rows[0];
  if (row !== undefined) return row;
  return blockedEdgeIdentity(client, input);
}

async function blockedEdgeIdentity(
  client: DbTxClient,
  input: InsertOrUpdateEdgeInput & {
    subjectId: string;
    objectId: string;
  }
): Promise<EdgeUpsertRow> {
  const blocked = await client.query<EdgeUpsertRow>(
    `SELECT edge_id, evidence_level, confidence, validity, false AS inserted
     FROM edges
     WHERE subject_id = $1 AND object_id = $2 AND relation = $3
       AND COALESCE(component_id, '') = COALESCE($4, '')
       AND COALESCE(component, '') = COALESCE($5, '')
       AND COALESCE(effective_from, DATE '1900-01-01') = DATE '1900-01-01'
       AND COALESCE(effective_to, DATE '2999-12-31') = DATE '2999-12-31'
     ORDER BY updated_at DESC, edge_id
     LIMIT 1`,
    [input.subjectId, input.objectId, input.approved.candidate.relation, input.component.component_id, input.component.component]
  );
  const row = blocked.rows[0];
  if (row === undefined) throw new Error(`Edge upsert did not return a row for reviewed candidate: ${input.subjectId} -> ${input.objectId}`);
  return row;
}

async function insertEvidence(
  client: DbTxClient,
  input: { edgeId: string; evidenceId: string; approved: ApprovedCandidate; trace: ReturnType<typeof buildEvidenceTrace> }
): Promise<void> {
  await client.query(
    `INSERT INTO evidence (evidence_id, edge_id, doc_id, chunk_id, cite_text, cite_locator,
                           cite_start_char, cite_end_char, cite_text_sha256, normalized_cite_text_sha256,
                           source_snapshot_sha256, parser_version, extractor_version, relation_candidate_hash,
                           evidence_level, confidence,
                           is_inferred, extraction_method, extractor_id, llm_meta, reviewer, reviewed_at,
                           confidence_breakdown, rationale)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
    [
      input.evidenceId,
      input.edgeId,
      input.approved.doc_id,
      input.approved.chunk_id ?? null,
      input.approved.candidate.cite_text,
      input.approved.candidate.cite_locator,
      input.trace.cite_start_char,
      input.trace.cite_end_char,
      input.trace.cite_text_sha256,
      input.trace.normalized_cite_text_sha256,
      input.trace.source_snapshot_sha256,
      input.trace.parser_version,
      input.trace.extractor_version,
      input.trace.relation_candidate_hash,
      input.approved.scoring.evidence_level,
      input.approved.scoring.confidence,
      input.approved.scoring.is_inferred,
      inferExtractionMethod(input.approved.candidate.extractor_id),
      input.approved.candidate.extractor_id,
      input.approved.candidate.llm_meta ?? null,
      input.approved.approved_by === "auto" ? "auto" : input.approved.approved_by.reviewer,
      input.approved.approved_by === "auto" ? new Date().toISOString() : input.approved.approved_by.reviewed_at,
      input.approved.scoring.confidence_breakdown,
      input.approved.scoring.rationale
    ]
  );
}

async function supersedeOlderEvidence(client: DbTxClient, input: { edgeId: string; evidenceId: string; approved: ApprovedCandidate }): Promise<void> {
  const superseded = await client.query<{ evidence_id: string } & DbRow>(
    `UPDATE evidence
     SET superseded_by = $2
     WHERE edge_id = $1
       AND doc_id = $3
       AND COALESCE(extractor_id, '') = COALESCE($4, '')
       AND evidence_id <> $2
       AND superseded_by IS NULL
     RETURNING evidence_id`,
    [input.edgeId, input.evidenceId, input.approved.doc_id, input.approved.candidate.extractor_id]
  );
  if (superseded.rows.length === 0) return;
  await recordSemanticChange(client, {
    scope_kind: "edge",
    scope_id: input.edgeId,
    change_type: "evidence_superseded",
    before: {
      superseded_evidence_ids: superseded.rows.map((row) => row.evidence_id)
    },
    after: {
      superseded_by: input.evidenceId
    },
    evidence_ids: [input.evidenceId, ...superseded.rows.map((row) => row.evidence_id)],
    caused_by: "review"
  });
}

async function updatePrimaryEvidence(client: DbTxClient, edgeId: string): Promise<void> {
  await client.query(
    `WITH best_evidence AS (
       SELECT evidence_id
       FROM evidence
       WHERE edge_id = $1 AND superseded_by IS NULL
       ORDER BY evidence_level DESC, confidence DESC, created_at DESC, evidence_id DESC
       LIMIT 1
     )
     UPDATE edges
     SET primary_evidence_id = best_evidence.evidence_id, updated_at = now()
     FROM best_evidence
     WHERE edges.edge_id = $1 AND edges.validity = 'current'`,
    [edgeId]
  );
}

interface ComponentReference {
  component: string | null;
  component_id: string | null;
  component_specificity: ComponentSpecificity | null;
}

interface LoadedEvidenceTraceInput {
  source_snapshot_sha256: string;
  document_metadata: Record<string, unknown>;
  chunk_text?: string;
}

async function resolveComponentReference(client: DbClient, candidate: CandidateRelation): Promise<ComponentReference> {
  if (candidate.component === undefined && candidate.component_id === undefined) {
    return { component: null, component_id: null, component_specificity: null };
  }

  if (candidate.component_id !== undefined) {
    const byId = await client.query<ComponentLookupRow>("SELECT component_id, name FROM components WHERE component_id = $1", [candidate.component_id]);
    const row = byId.rows[0];
    if (row === undefined) throw new Error(`Unknown component_id on candidate: ${candidate.component_id}`);
    return {
      component: candidate.component ?? row.name,
      component_id: row.component_id,
      component_specificity: candidate.component_specificity ?? null
    };
  }

  const componentText = candidate.component;
  if (componentText === undefined) return { component: null, component_id: null, component_specificity: null };
  const byNameOrAlias = await client.query<ComponentLookupRow>(
    `SELECT component_id, name
     FROM components
     WHERE lower(name) = lower($1)
        OR EXISTS (SELECT 1 FROM unnest(aliases) AS alias WHERE lower(alias) = lower($1))
     ORDER BY length(name), component_id
     LIMIT 1`,
    [componentText]
  );
  const row = byNameOrAlias.rows[0];
  return {
    component: componentText,
    component_id: row?.component_id ?? null,
    component_specificity: row === undefined ? null : (candidate.component_specificity ?? "unspecified")
  };
}

async function loadEvidenceTraceInput(client: DbClient, approved: ApprovedCandidate): Promise<LoadedEvidenceTraceInput> {
  const document = await client.query<EvidenceDocumentRow>("SELECT bytes_sha256, metadata FROM documents WHERE doc_id = $1", [approved.doc_id]);
  const doc = document.rows[0];
  if (doc === undefined) throw new Error(`Document not found for evidence trace: ${approved.doc_id}`);
  if (approved.chunk_id === undefined) return { source_snapshot_sha256: doc.bytes_sha256, document_metadata: doc.metadata };
  const chunk = await client.query<EvidenceChunkRow>("SELECT text FROM document_chunks WHERE chunk_id = $1", [approved.chunk_id]);
  const chunkText = chunk.rows[0]?.text;
  return {
    source_snapshot_sha256: doc.bytes_sha256,
    document_metadata: doc.metadata,
    ...(chunkText === undefined ? {} : { chunk_text: chunkText })
  };
}
