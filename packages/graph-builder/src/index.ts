import type pg from "pg";
import {
  createId,
  inferExtractionMethod,
  type ApplyResult,
  type ApprovedCandidate,
  type CandidateRelation,
  type ComponentSpecificity,
  type EntityRecord,
  type EvidenceLevel,
  type RelationType
} from "@supplystrata/core";
import { deprecateEdge, listCurrentEdges, recordSemanticChange, type DatabaseStore, type DbClient } from "@supplystrata/db";
import type { EntityResolver } from "@supplystrata/entity-resolver";
import { buildEvidenceTrace } from "@supplystrata/evidence-trace";
import type { GraphProjectionStats, GraphStore } from "@supplystrata/graph-store";
import { getLogger } from "@supplystrata/observability";

export type GraphSyncMode = "sync" | "defer";

export interface GraphBuilderOptions {
  graphSyncMode?: GraphSyncMode;
  graphStore?: GraphStore;
}

export type GraphConsistencyCheck =
  | { status: "synced"; postgres: GraphProjectionStats; graph: GraphProjectionStats; recommendation: "none" }
  | { status: "out_of_sync"; postgres: GraphProjectionStats; graph: GraphProjectionStats; recommendation: "run_graph_rebuild" }
  | { status: "unreachable"; postgres: GraphProjectionStats; error_message: string; recommendation: "check_graph_store_then_rebuild" };

export interface DeprecateEdgeRequest {
  edge_id: string;
  reason: string;
  superseded_by_edge_id?: string;
  reviewer: string;
}

export interface DeprecateEdgeApplyResult {
  edge_id: string;
  primary_evidence_id?: string;
  graph_sync: ApplyResult["graph_sync"];
}

export class GraphBuilder {
  readonly #store: DatabaseStore;
  readonly #resolver: EntityResolver;
  readonly #graph: GraphStore | null;
  readonly #graphSyncMode: GraphSyncMode;

  constructor(store: DatabaseStore, resolver: EntityResolver, graphOrOptions: GraphStore | GraphBuilderOptions = {}, options: GraphBuilderOptions = {}) {
    this.#store = store;
    this.#resolver = resolver;
    if (isGraphStore(graphOrOptions)) {
      this.#graph = graphOrOptions;
      this.#graphSyncMode = options.graphSyncMode ?? "sync";
    } else {
      this.#graph = graphOrOptions.graphStore ?? null;
      // 没有 GraphStore adapter 时，GraphBuilder 只维护 Postgres 真相存储；图投影由后续 rebuild/check 命令补齐。
      this.#graphSyncMode = graphOrOptions.graphSyncMode ?? (this.#graph === null ? "defer" : "sync");
    }
  }

  async close(): Promise<void> {
    if (this.#graph === null) return;
    await this.#graph.close();
  }

  async apply(approved: ApprovedCandidate): Promise<ApplyResult> {
    const subject = await this.#resolver.resolve(approved.candidate.subject_resolve);
    const object = await this.#resolver.resolve(approved.candidate.object_resolve);
    if (subject.status !== "resolved" || subject.entity_id === undefined) {
      throw new Error(`Cannot resolve subject: ${approved.candidate.subject_resolve.surface}`);
    }
    if (object.status !== "resolved" || object.entity_id === undefined) {
      throw new Error(`Cannot resolve object: ${approved.candidate.object_resolve.surface}`);
    }
    const subjectId = subject.entity_id;
    const objectId = object.entity_id;

    const committed = await this.#store.transaction<Omit<ApplyResult, "graph_sync">>(async (client) => {
      const component = await resolveComponentReference(client, approved.candidate);
      const existing = await client.query<EdgeIdentityRow>(
        `SELECT edge_id, evidence_level, confidence
         FROM edges
         WHERE subject_id = $1 AND object_id = $2 AND relation = $3
           AND (
             ($4::text IS NOT NULL AND (component_id = $4 OR (component_id IS NULL AND lower(component) = lower($5))))
             OR ($4::text IS NULL AND component_id IS NULL AND COALESCE(component, '') = COALESCE($5, ''))
           )
           AND COALESCE(effective_from, DATE '1900-01-01') = DATE '1900-01-01'
           AND COALESCE(effective_to, DATE '2999-12-31') = DATE '2999-12-31'
         LIMIT 1`,
        [subjectId, objectId, approved.candidate.relation, component.component_id, component.component]
      );

      const edgeId = existing.rows[0]?.edge_id ?? createId("EDGE");
      const evidenceId = createId("EV");
      const changeId = createId("CHG");
      const isNewEdge = existing.rows[0] === undefined;
      const edgeLevel = maxLevel(existing.rows[0]?.evidence_level, approved.scoring.evidence_level);
      const edgeConfidence = Math.min(0.97, Math.max(existing.rows[0]?.confidence ?? 0, approved.scoring.confidence));
      const traceInput = await loadEvidenceTraceInput(client, approved);
      const trace = buildEvidenceTrace({
        cite_text: approved.candidate.cite_text,
        extractor_id: approved.candidate.extractor_id,
        ...(approved.candidate.llm_meta === undefined ? {} : { llm_meta: approved.candidate.llm_meta }),
        source_snapshot_sha256: traceInput.source_snapshot_sha256,
        document_metadata: traceInput.document_metadata,
        identity: {
          subject_id: subjectId,
          object_id: objectId,
          relation: approved.candidate.relation,
          component
        },
        ...(traceInput.chunk_text === undefined ? {} : { chunk_text: traceInput.chunk_text })
      });

      if (isNewEdge) {
        await client.query(
          `INSERT INTO edges (edge_id, subject_id, object_id, relation, component, component_id, component_specificity, evidence_level, confidence, is_inferred, validity)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'current')`,
          [
            edgeId,
            subjectId,
            objectId,
            approved.candidate.relation,
            component.component,
            component.component_id,
            component.component_specificity,
            edgeLevel,
            edgeConfidence,
            approved.scoring.is_inferred
          ]
        );
      } else {
        await client.query(
          `UPDATE edges
           SET component = $2,
               component_id = $3,
               component_specificity = COALESCE(component_specificity, $4),
               evidence_level = $5,
               confidence = $6,
               is_inferred = $7,
               last_verified_at = now(),
               updated_at = now()
           WHERE edge_id = $1`,
          [edgeId, component.component, component.component_id, component.component_specificity, edgeLevel, edgeConfidence, approved.scoring.is_inferred]
        );
      }

      await client.query(
        `INSERT INTO evidence (evidence_id, edge_id, doc_id, chunk_id, cite_text, cite_locator,
                               cite_start_char, cite_end_char, cite_text_sha256, normalized_cite_text_sha256,
                               source_snapshot_sha256, parser_version, extractor_version, relation_candidate_hash,
                               evidence_level, confidence,
                               is_inferred, extraction_method, extractor_id, llm_meta, reviewer, reviewed_at,
                               confidence_breakdown, rationale)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
        [
          evidenceId,
          edgeId,
          approved.doc_id,
          approved.chunk_id ?? null,
          approved.candidate.cite_text,
          approved.candidate.cite_locator,
          trace.cite_start_char,
          trace.cite_end_char,
          trace.cite_text_sha256,
          trace.normalized_cite_text_sha256,
          trace.source_snapshot_sha256,
          trace.parser_version,
          trace.extractor_version,
          trace.relation_candidate_hash,
          approved.scoring.evidence_level,
          approved.scoring.confidence,
          approved.scoring.is_inferred,
          inferExtractionMethod(approved.candidate.extractor_id),
          approved.candidate.extractor_id,
          approved.candidate.llm_meta ?? null,
          approved.approved_by === "auto" ? "auto" : approved.approved_by.reviewer,
          approved.approved_by === "auto" ? new Date().toISOString() : approved.approved_by.reviewed_at,
          approved.scoring.confidence_breakdown,
          approved.scoring.rationale
        ]
      );

      const superseded = await client.query<{ evidence_id: string } & pg.QueryResultRow>(
        `UPDATE evidence
         SET superseded_by = $2
         WHERE edge_id = $1
           AND doc_id = $3
           AND COALESCE(extractor_id, '') = COALESCE($4, '')
           AND evidence_id <> $2
           AND superseded_by IS NULL
         RETURNING evidence_id`,
        [edgeId, evidenceId, approved.doc_id, approved.candidate.extractor_id]
      );
      if (superseded.rows.length > 0) {
        await recordSemanticChange(client, {
          scope_kind: "edge",
          scope_id: edgeId,
          change_type: "evidence_superseded",
          before: {
            superseded_evidence_ids: superseded.rows.map((row) => row.evidence_id)
          },
          after: {
            superseded_by: evidenceId
          },
          evidence_ids: [evidenceId, ...superseded.rows.map((row) => row.evidence_id)],
          caused_by: "review"
        });
      }

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
         WHERE edges.edge_id = $1`,
        [edgeId]
      );
      await client.query(
        `INSERT INTO change_records (change_id, scope_kind, scope_id, change_type, before, after, evidence_ids, caused_by)
         VALUES ($1,'edge',$2,$3,NULL,$4,ARRAY[$5],'review')`,
        [changeId, edgeId, isNewEdge ? "new_edge" : "edge_evidence_added", { edge_id: edgeId }, evidenceId]
      );
      return { edge_id: edgeId, evidence_id: evidenceId, change_id: changeId, is_new_edge: isNewEdge };
    });
    const graphSync = await this.#trySyncEdge(committed.edge_id);
    return { ...committed, graph_sync: graphSync };
  }

  async deprecate(input: DeprecateEdgeRequest): Promise<DeprecateEdgeApplyResult> {
    const committed = await this.#store.transaction(async (client) =>
      deprecateEdge(client, {
        edge_id: input.edge_id,
        reason: input.reason,
        caused_by: input.reviewer,
        ...(input.superseded_by_edge_id === undefined ? {} : { superseded_by_edge_id: input.superseded_by_edge_id })
      })
    );
    const graphSync = await this.#tryRemoveEdge(committed.edge_id);
    return { ...committed, graph_sync: graphSync };
  }

  async rebuild(): Promise<{ nodes: number; edges: number }> {
    const graph = this.#requireGraph();
    await graph.ensureSchema();
    await graph.clear();
    const entities = await this.#store.query<EntityRow>(
      `SELECT entity_id, kind, canonical_name, display_name, language_of_canonical, identifiers, primary_country, industry, status, attrs
       FROM entity_master
       WHERE status = 'active'
       ORDER BY entity_id`
    );
    for (const row of entities.rows) {
      await graph.upsertEntity(entityRecordFromRow(row));
    }
    const edges = await listCurrentEdges(this.#store);
    for (const edge of edges) {
      await graph.upsertEdge({
        edge_id: edge.edge_id,
        subject_id: edge.subject_id,
        object_id: edge.object_id,
        relation: edge.relation,
        evidence_level: edge.evidence_level,
        confidence: edge.confidence,
        is_inferred: edge.is_inferred,
        validity: edge.validity,
        last_verified_at: edge.last_verified_at.toISOString(),
        ...(edge.component === null ? {} : { component: edge.component }),
        ...(edge.component_id === null ? {} : { component_id: edge.component_id }),
        ...(edge.component_specificity === null ? {} : { component_specificity: edge.component_specificity })
      });
    }
    return graph.stats();
  }

  async checkConsistency(): Promise<GraphConsistencyCheck> {
    const postgres = await this.#postgresProjectionStats();
    try {
      const graph = await this.#requireGraph().stats();
      if (postgres.nodes === graph.nodes && postgres.edges === graph.edges) {
        return { status: "synced", postgres, graph, recommendation: "none" };
      }
      return { status: "out_of_sync", postgres, graph, recommendation: "run_graph_rebuild" };
    } catch (error) {
      return { status: "unreachable", postgres, error_message: messageFromUnknown(error), recommendation: "check_graph_store_then_rebuild" };
    }
  }

  async #syncEdge(edgeId: string): Promise<void> {
    const graph = this.#requireGraph();
    const result = await this.#store.query<GraphEdgeRow>(
      `SELECT edge_id, subject_id, object_id, relation, component, component_id, component_specificity, evidence_level, confidence, is_inferred, validity, last_verified_at
       FROM edges
       WHERE edge_id = $1`,
      [edgeId]
    );
    const edge = result.rows[0];
    if (edge === undefined) throw new Error(`Edge not found after apply: ${edgeId}`);
    await graph.ensureSchema();
    const endpoints = await this.#store.query<EntityRow>(
      `SELECT entity_id, kind, canonical_name, display_name, language_of_canonical, identifiers, primary_country, industry, status, attrs
       FROM entity_master
       WHERE entity_id = ANY($1)`,
      [[edge.subject_id, edge.object_id]]
    );
    for (const row of endpoints.rows) {
      await graph.upsertEntity(entityRecordFromRow(row));
    }
    await graph.upsertEdge({
      edge_id: edge.edge_id,
      subject_id: edge.subject_id,
      object_id: edge.object_id,
      relation: edge.relation,
      evidence_level: edge.evidence_level,
      confidence: edge.confidence,
      is_inferred: edge.is_inferred,
      validity: edge.validity,
      last_verified_at: edge.last_verified_at.toISOString(),
      ...(edge.component === null ? {} : { component: edge.component }),
      ...(edge.component_id === null ? {} : { component_id: edge.component_id }),
      ...(edge.component_specificity === null ? {} : { component_specificity: edge.component_specificity })
    });
  }

  async #trySyncEdge(edgeId: string): Promise<ApplyResult["graph_sync"]> {
    if (this.#graphSyncMode === "defer") return { status: "deferred" };
    try {
      await this.#syncEdge(edgeId);
      return { status: "synced" };
    } catch (error) {
      const errorMessage = messageFromUnknown(error);
      getLogger().warn({ stage: "graph-sync", edge_id: edgeId, err: errorMessage }, "GraphStore projection sync failed; Postgres truth was committed");
      return { status: "failed", error_message: errorMessage };
    }
  }

  async #tryRemoveEdge(edgeId: string): Promise<ApplyResult["graph_sync"]> {
    if (this.#graphSyncMode === "defer") return { status: "deferred" };
    try {
      await this.#requireGraph().removeEdge(edgeId);
      return { status: "synced" };
    } catch (error) {
      const errorMessage = messageFromUnknown(error);
      getLogger().warn({ stage: "graph-remove-edge", edge_id: edgeId, err: errorMessage }, "GraphStore projection remove failed; Postgres truth was committed");
      return { status: "failed", error_message: errorMessage };
    }
  }

  #requireGraph(): GraphStore {
    if (this.#graph !== null) return this.#graph;
    throw new Error("No GraphStore adapter is configured for this GraphBuilder.");
  }

  async #postgresProjectionStats(): Promise<GraphProjectionStats> {
    const result = await this.#store.query<ProjectionStatsRow>(
      `SELECT
         (SELECT count(*)::int FROM entity_master WHERE status = 'active') AS nodes,
         (SELECT count(*)::int FROM edges WHERE validity = 'current') AS edges`
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("Postgres projection stats query returned no rows");
    return { nodes: row.nodes, edges: row.edges };
  }
}

function isGraphStore(value: GraphStore | GraphBuilderOptions): value is GraphStore {
  return (
    "close" in value &&
    "ensureSchema" in value &&
    "clear" in value &&
    "upsertEntity" in value &&
    "upsertEdge" in value &&
    "removeEdge" in value &&
    "stats" in value
  );
}

interface EdgeIdentityRow extends pg.QueryResultRow {
  edge_id: string;
  evidence_level: EvidenceLevel;
  confidence: number;
}

interface EntityRow extends pg.QueryResultRow {
  entity_id: string;
  kind: EntityRecord["kind"];
  canonical_name: string;
  display_name: string;
  language_of_canonical: string;
  identifiers: Record<string, unknown>;
  primary_country: string | null;
  industry: string[];
  status: EntityRecord["status"];
  attrs: Record<string, unknown>;
}

interface GraphEdgeRow extends pg.QueryResultRow {
  edge_id: string;
  subject_id: string;
  object_id: string;
  relation: RelationType;
  component: string | null;
  component_id: string | null;
  component_specificity: ComponentSpecificity | null;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  validity: string;
  last_verified_at: Date;
}

interface ComponentReference {
  component: string | null;
  component_id: string | null;
  component_specificity: ComponentSpecificity | null;
}

interface ComponentLookupRow extends pg.QueryResultRow {
  component_id: string;
  name: string;
}

interface EvidenceDocumentRow extends pg.QueryResultRow {
  bytes_sha256: string;
  metadata: Record<string, unknown>;
}

interface EvidenceChunkRow extends pg.QueryResultRow {
  text: string;
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

interface ProjectionStatsRow extends pg.QueryResultRow {
  nodes: number;
  edges: number;
}

function maxLevel(left: EvidenceLevel | undefined, right: EvidenceLevel): EvidenceLevel {
  return Math.max(left ?? 1, right) as EvidenceLevel;
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}

function entityRecordFromRow(row: EntityRow): EntityRecord {
  return {
    entity_id: row.entity_id,
    kind: row.kind,
    canonical_name: row.canonical_name,
    display_name: row.display_name,
    language_of_canonical: row.language_of_canonical,
    identifiers: row.identifiers,
    industry: row.industry,
    status: row.status,
    attrs: row.attrs,
    ...(row.primary_country === null ? {} : { primary_country: row.primary_country })
  };
}
