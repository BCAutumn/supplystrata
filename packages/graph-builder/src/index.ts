import type pg from "pg";
import {
  createId,
  inferExtractionMethod,
  logger,
  type ApplyResult,
  type ApprovedCandidate,
  type CandidateRelation,
  type ComponentSpecificity,
  type EntityRecord,
  type EvidenceLevel,
  type RelationType
} from "@supplystrata/core";
import { listCurrentEdges } from "@supplystrata/db";
import type { EntityResolver } from "@supplystrata/entity-resolver";
import { Neo4jGraphStore, type GraphStore } from "@supplystrata/graph";

export interface GraphProjectionStats {
  nodes: number;
  edges: number;
}

export type GraphConsistencyCheck =
  | { status: "synced"; postgres: GraphProjectionStats; neo4j: GraphProjectionStats; recommendation: "none" }
  | { status: "out_of_sync"; postgres: GraphProjectionStats; neo4j: GraphProjectionStats; recommendation: "run_graph_rebuild" }
  | { status: "unreachable"; postgres: GraphProjectionStats; error_message: string; recommendation: "check_neo4j_then_rebuild" };

export class GraphBuilder {
  readonly #pool: pg.Pool;
  readonly #resolver: EntityResolver;
  readonly #graph: GraphStore;

  constructor(pool: pg.Pool, resolver: EntityResolver, graph: GraphStore = new Neo4jGraphStore()) {
    this.#pool = pool;
    this.#resolver = resolver;
    this.#graph = graph;
  }

  async close(): Promise<void> {
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

    const client = await this.#pool.connect();
    let committed: Omit<ApplyResult, "graph_sync"> | undefined;
    try {
      await client.query("BEGIN");
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
        [subject.entity_id, object.entity_id, approved.candidate.relation, component.component_id, component.component]
      );

      const edgeId = existing.rows[0]?.edge_id ?? createId("EDGE");
      const evidenceId = createId("EV");
      const changeId = createId("CHG");
      const isNewEdge = existing.rows[0] === undefined;
      const edgeLevel = maxLevel(existing.rows[0]?.evidence_level, approved.scoring.evidence_level);
      const edgeConfidence = Math.min(0.97, Math.max(existing.rows[0]?.confidence ?? 0, approved.scoring.confidence));

      if (isNewEdge) {
        await client.query(
          `INSERT INTO edges (edge_id, subject_id, object_id, relation, component, component_id, component_specificity, evidence_level, confidence, is_inferred, validity)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'current')`,
          [
            edgeId,
            subject.entity_id,
            object.entity_id,
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
        `INSERT INTO evidence (evidence_id, edge_id, doc_id, chunk_id, cite_text, cite_locator, evidence_level, confidence,
                               is_inferred, extraction_method, extractor_id, llm_meta, reviewer, reviewed_at,
                               confidence_breakdown, rationale)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          evidenceId,
          edgeId,
          approved.doc_id,
          approved.chunk_id ?? null,
          approved.candidate.cite_text,
          approved.candidate.cite_locator,
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

      await client.query(
        `UPDATE evidence
         SET superseded_by = $2
         WHERE edge_id = $1
           AND doc_id = $3
           AND COALESCE(extractor_id, '') = COALESCE($4, '')
           AND evidence_id <> $2
           AND superseded_by IS NULL`,
        [edgeId, evidenceId, approved.doc_id, approved.candidate.extractor_id]
      );

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
      await client.query("COMMIT");
      committed = { edge_id: edgeId, evidence_id: evidenceId, change_id: changeId, is_new_edge: isNewEdge };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
    const graphSync = await this.#trySyncEdge(committed.edge_id);
    return { ...committed, graph_sync: graphSync };
  }

  async rebuild(): Promise<{ nodes: number; edges: number }> {
    await this.#graph.ensureSchema();
    await this.#graph.clear();
    const entities = await this.#pool.query<EntityRow>(
      `SELECT entity_id, kind, canonical_name, display_name, language_of_canonical, identifiers, primary_country, industry, status, attrs
       FROM entity_master
       WHERE status = 'active'
       ORDER BY entity_id`
    );
    for (const row of entities.rows) {
      await this.#graph.upsertEntity(entityRecordFromRow(row));
    }
    const edges = await listCurrentEdges(this.#pool);
    for (const edge of edges) {
      await this.#graph.upsertEdge({
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
    return this.#graph.stats();
  }

  async checkConsistency(): Promise<GraphConsistencyCheck> {
    const postgres = await this.#postgresProjectionStats();
    try {
      const neo4j = await this.#graph.stats();
      if (postgres.nodes === neo4j.nodes && postgres.edges === neo4j.edges) {
        return { status: "synced", postgres, neo4j, recommendation: "none" };
      }
      return { status: "out_of_sync", postgres, neo4j, recommendation: "run_graph_rebuild" };
    } catch (error) {
      return { status: "unreachable", postgres, error_message: messageFromUnknown(error), recommendation: "check_neo4j_then_rebuild" };
    }
  }

  async #syncEdge(edgeId: string): Promise<void> {
    const result = await this.#pool.query<GraphEdgeRow>(
      `SELECT edge_id, subject_id, object_id, relation, component, component_id, component_specificity, evidence_level, confidence, is_inferred, validity, last_verified_at
       FROM edges
       WHERE edge_id = $1`,
      [edgeId]
    );
    const edge = result.rows[0];
    if (edge === undefined) throw new Error(`Edge not found after apply: ${edgeId}`);
    await this.#graph.ensureSchema();
    const endpoints = await this.#pool.query<EntityRow>(
      `SELECT entity_id, kind, canonical_name, display_name, language_of_canonical, identifiers, primary_country, industry, status, attrs
       FROM entity_master
       WHERE entity_id = ANY($1)`,
      [[edge.subject_id, edge.object_id]]
    );
    for (const row of endpoints.rows) {
      await this.#graph.upsertEntity(entityRecordFromRow(row));
    }
    await this.#graph.upsertEdge({
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
    try {
      await this.#syncEdge(edgeId);
      return { status: "synced" };
    } catch (error) {
      const errorMessage = messageFromUnknown(error);
      logger.warn({ stage: "graph-sync", edge_id: edgeId, err: errorMessage }, "Neo4j materialized view sync failed; Postgres truth was committed");
      return { status: "failed", error_message: errorMessage };
    }
  }

  async #postgresProjectionStats(): Promise<GraphProjectionStats> {
    const result = await this.#pool.query<ProjectionStatsRow>(
      `SELECT
         (SELECT count(*)::int FROM entity_master WHERE status = 'active') AS nodes,
         (SELECT count(*)::int FROM edges WHERE validity = 'current') AS edges`
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("Postgres projection stats query returned no rows");
    return { nodes: row.nodes, edges: row.edges };
  }
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

async function resolveComponentReference(client: pg.PoolClient, candidate: CandidateRelation): Promise<ComponentReference> {
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

interface ProjectionStatsRow extends pg.QueryResultRow {
  nodes: number;
  edges: number;
}

function maxLevel(left: EvidenceLevel | undefined, right: EvidenceLevel): EvidenceLevel {
  return Math.max(left ?? 1, right) as EvidenceLevel;
}

async function rollbackQuietly(client: pg.PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch (error) {
    logger.error({ stage: "postgres-rollback", err: messageFromUnknown(error) }, "rollback failed after graph apply error");
  }
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
