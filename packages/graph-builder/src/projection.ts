import type { EntityRecord } from "@supplystrata/core";
import { listCurrentEdges } from "@supplystrata/db/read";
import { claimDueGraphProjectionJobs, markGraphProjectionJobFailed, markGraphProjectionJobSucceeded, type DatabaseStore } from "@supplystrata/db/write";
import type { GraphProjectionStats, GraphStore } from "@supplystrata/graph-store";
import { messageFromUnknown } from "@supplystrata/observability";
import type { EntityRow, GraphEdgeRow, ProjectionStatsRow } from "./db-rows.js";

export type GraphConsistencyCheck =
  | { status: "synced"; postgres: GraphProjectionStats; graph: GraphProjectionStats; recommendation: "none" }
  | { status: "out_of_sync"; postgres: GraphProjectionStats; graph: GraphProjectionStats; recommendation: "run_graph_rebuild" }
  | { status: "unreachable"; postgres: GraphProjectionStats; error_message: string; recommendation: "check_graph_store_then_rebuild" };

export interface GraphProjectionRetrySummary {
  scanned: number;
  synced: number;
  failed: number;
}

export async function rebuildGraphProjection(store: DatabaseStore, graph: GraphStore): Promise<{ nodes: number; edges: number }> {
  await graph.ensureSchema();
  await graph.clear();
  const entities = await store.read.query<EntityRow>(
    `SELECT entity_id, kind, canonical_name, display_name, language_of_canonical, identifiers, primary_country, industry, status, attrs
     FROM entity_master
     WHERE status = 'active'
     ORDER BY entity_id`
  );
  for (const row of entities.rows) {
    await graph.upsertEntity(entityRecordFromRow(row));
  }
  const edges = await listCurrentEdges(store.read);
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

export async function checkGraphConsistency(store: DatabaseStore, graph: GraphStore): Promise<GraphConsistencyCheck> {
  const postgres = await postgresProjectionStats(store);
  try {
    const graphStats = await graph.stats();
    if (postgres.nodes === graphStats.nodes && postgres.edges === graphStats.edges) {
      return { status: "synced", postgres, graph: graphStats, recommendation: "none" };
    }
    return { status: "out_of_sync", postgres, graph: graphStats, recommendation: "run_graph_rebuild" };
  } catch (error) {
    return { status: "unreachable", postgres, error_message: messageFromUnknown(error), recommendation: "check_graph_store_then_rebuild" };
  }
}

export async function retryGraphProjectionJobs(store: DatabaseStore, graph: GraphStore, input: { limit?: number } = {}): Promise<GraphProjectionRetrySummary> {
  const jobs = await store.transaction((client) => claimDueGraphProjectionJobs(client, { limit: input.limit ?? 50 }));
  let synced = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      if (job.operation === "upsert_edge") {
        await syncGraphEdge(store, graph, job.edge_id);
      } else {
        await graph.removeEdge(job.edge_id);
      }
      await store.transaction((client) => markGraphProjectionJobSucceeded(client, job.job_id));
      synced += 1;
    } catch (error) {
      await store.transaction((client) => markGraphProjectionJobFailed(client, { job_id: job.job_id, error_message: messageFromUnknown(error) }));
      failed += 1;
    }
  }
  return { scanned: jobs.length, synced, failed };
}

export async function syncGraphEdge(store: DatabaseStore, graph: GraphStore, edgeId: string): Promise<void> {
  const result = await store.read.query<GraphEdgeRow>(
    `SELECT edge_id, subject_id, object_id, relation, component, component_id, component_specificity, evidence_level, confidence, is_inferred, validity, last_verified_at
     FROM edges
     WHERE edge_id = $1`,
    [edgeId]
  );
  const edge = result.rows[0];
  if (edge === undefined) throw new Error(`Edge not found after apply: ${edgeId}`);
  await graph.ensureSchema();
  if (edge.validity !== "current") {
    await graph.removeEdge(edge.edge_id);
    return;
  }
  const endpoints = await store.read.query<EntityRow>(
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

async function postgresProjectionStats(store: DatabaseStore): Promise<GraphProjectionStats> {
  const result = await store.read.query<ProjectionStatsRow>(
    `SELECT
       (SELECT count(*)::int FROM entity_master WHERE status = 'active') AS nodes,
       (SELECT count(*)::int FROM edges WHERE validity = 'current') AS edges`
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Postgres projection stats query returned no rows");
  return { nodes: row.nodes, edges: row.edges };
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
