import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApprovedCandidate, EntityRecord } from "@supplystrata/core";
import { createPool, migrate } from "@supplystrata/db";
import type { EntityResolver } from "@supplystrata/entity-resolver";
import type { GraphEdgeInput, GraphStore } from "@supplystrata/graph";
import { GraphBuilder } from "@supplystrata/graph-builder";
import { canConnectToIntegrationDatabase } from "./helpers.js";

class StaticResolver implements EntityResolver {
  async resolve(input: { surface: string }): ReturnType<EntityResolver["resolve"]> {
    if (input.surface === "Test Buyer") return { status: "resolved", entity_id: "ENT-ITEST-BUYER", confidence: 0.99, needs_human_review: false };
    if (input.surface === "Test Supplier") return { status: "resolved", entity_id: "ENT-ITEST-SUPPLIER", confidence: 0.99, needs_human_review: false };
    return { status: "unknown", confidence: 0, needs_human_review: true };
  }
}

class FailingGraphStore implements GraphStore {
  async close(): Promise<void> {}

  async ensureSchema(): Promise<void> {
    throw new Error("simulated neo4j outage");
  }

  async clear(): Promise<void> {}

  async upsertEntity(_entity: EntityRecord): Promise<void> {}

  async upsertEdge(_edge: GraphEdgeInput): Promise<void> {}

  async stats(): Promise<{ nodes: number; edges: number }> {
    return { nodes: 0, edges: 0 };
  }
}

class StatsGraphStore implements GraphStore {
  readonly #stats: { nodes: number; edges: number };

  constructor(stats: { nodes: number; edges: number }) {
    this.#stats = stats;
  }

  async close(): Promise<void> {}

  async ensureSchema(): Promise<void> {}

  async clear(): Promise<void> {}

  async upsertEntity(_entity: EntityRecord): Promise<void> {}

  async upsertEdge(_edge: GraphEdgeInput): Promise<void> {}

  async stats(): Promise<{ nodes: number; edges: number }> {
    return this.#stats;
  }
}

class UnreachableStatsGraphStore extends StatsGraphStore {
  constructor() {
    super({ nodes: 0, edges: 0 });
  }

  override async stats(): Promise<{ nodes: number; edges: number }> {
    throw new Error("simulated stats outage");
  }
}

interface CountRow extends pg.QueryResultRow {
  count: string;
}

interface ProjectionStatsRow extends pg.QueryResultRow {
  nodes: number;
  edges: number;
}

interface EvidenceTraceTestRow extends pg.QueryResultRow {
  cite_start_char: number | null;
  cite_end_char: number | null;
  cite_text_sha256: string | null;
  normalized_cite_text_sha256: string | null;
  source_snapshot_sha256: string | null;
  parser_version: string | null;
  extractor_version: string | null;
  relation_candidate_hash: string | null;
}

const hasDatabase = await canConnectToIntegrationDatabase();

describe.skipIf(!hasDatabase)("GraphBuilder integration", () => {
  const pool = createPool();

  beforeAll(async () => {
    await migrate(pool);
    await cleanupIntegrationRows(pool);
    await seedIntegrationEntities(pool);
    await seedIntegrationComponents(pool);
  });

  afterAll(async () => {
    await cleanupIntegrationRows(pool);
    await pool.end();
  });

  it("commits Postgres truth when Neo4j materialized-view sync fails", async () => {
    const builder = new GraphBuilder(pool, new StaticResolver(), new FailingGraphStore());
    const result = await builder.apply(approvedCandidate());

    expect(result.graph_sync).toMatchObject({ status: "failed", error_message: "simulated neo4j outage" });
    expect(result.edge_id).toMatch(/^EDGE-/);
    expect(result.evidence_id).toMatch(/^EV-/);

    const edgeCount = await pool.query<CountRow>("SELECT count(*)::text AS count FROM edges WHERE edge_id = $1", [result.edge_id]);
    const evidenceCount = await pool.query<CountRow>("SELECT count(*)::text AS count FROM evidence WHERE evidence_id = $1", [result.evidence_id]);
    expect(edgeCount.rows[0]?.count).toBe("1");
    expect(evidenceCount.rows[0]?.count).toBe("1");

    await builder.close();
  });

  it("reports graph projection sync status from Postgres and graph counts", async () => {
    const postgres = await currentPostgresProjection(pool);
    const syncedBuilder = new GraphBuilder(pool, new StaticResolver(), new StatsGraphStore(postgres));
    await expect(syncedBuilder.checkConsistency()).resolves.toMatchObject({ status: "synced", postgres, neo4j: postgres });

    const staleBuilder = new GraphBuilder(pool, new StaticResolver(), new StatsGraphStore({ nodes: postgres.nodes, edges: postgres.edges + 1 }));
    await expect(staleBuilder.checkConsistency()).resolves.toMatchObject({ status: "out_of_sync", recommendation: "run_graph_rebuild" });

    const unreachableBuilder = new GraphBuilder(pool, new StaticResolver(), new UnreachableStatsGraphStore());
    await expect(unreachableBuilder.checkConsistency()).resolves.toMatchObject({ status: "unreachable", error_message: "simulated stats outage" });
  });

  it("promotes the best evidence to the edge primary evidence", async () => {
    const builder = new GraphBuilder(pool, new StaticResolver(), new StatsGraphStore({ nodes: 0, edges: 0 }));
    const stale = await builder.apply(approvedCandidate({ component: "primary-evidence-test", confidence: 0.7, citeText: "Older integration evidence." }));
    const fresh = await builder.apply(approvedCandidate({ component: "primary-evidence-test", confidence: 0.9, citeText: "Newer integration evidence." }));

    const result = await pool.query<{ primary_evidence_id: string } & pg.QueryResultRow>("SELECT primary_evidence_id FROM edges WHERE edge_id = $1", [
      fresh.edge_id
    ]);
    const staleEvidence = await pool.query<{ superseded_by: string | null } & pg.QueryResultRow>("SELECT superseded_by FROM evidence WHERE evidence_id = $1", [
      stale.evidence_id
    ]);

    expect(fresh.edge_id).toBe(stale.edge_id);
    expect(result.rows[0]?.primary_evidence_id).toBe(fresh.evidence_id);
    expect(staleEvidence.rows[0]?.superseded_by).toBe(fresh.evidence_id);

    await builder.close();
  });

  it("canonicalizes known component text onto component_id and specificity", async () => {
    const builder = new GraphBuilder(pool, new StaticResolver(), new StatsGraphStore({ nodes: 0, edges: 0 }));
    const result = await builder.apply(
      approvedCandidate({ component: "memory", confidence: 0.86, citeText: "Integration Test Buyer purchases memory from Integration Test Supplier." })
    );

    const edge = await pool.query<{ component: string | null; component_id: string | null; component_specificity: string | null } & pg.QueryResultRow>(
      "SELECT component, component_id, component_specificity FROM edges WHERE edge_id = $1",
      [result.edge_id]
    );

    expect(edge.rows[0]).toMatchObject({
      component: "memory",
      component_id: "COMP-ITEST-MEMORY",
      component_specificity: "unspecified"
    });

    await builder.close();
  });

  it("records exact citation offsets and fingerprints for applied evidence", async () => {
    const builder = new GraphBuilder(pool, new StaticResolver(), new StatsGraphStore({ nodes: 0, edges: 0 }));
    const result = await builder.apply(approvedCandidate({ component: "traceability-test" }));

    const evidence = await pool.query<EvidenceTraceTestRow>(
      `SELECT cite_start_char, cite_end_char, cite_text_sha256, normalized_cite_text_sha256,
              source_snapshot_sha256, parser_version, extractor_version, relation_candidate_hash
       FROM evidence
       WHERE evidence_id = $1`,
      [result.evidence_id]
    );
    const row = evidence.rows[0];
    if (row === undefined) throw new Error("expected evidence trace row");

    expect(row.cite_start_char).toBeGreaterThanOrEqual(0);
    expect(row.cite_end_char).toBe((row.cite_start_char ?? 0) + "Integration Test Buyer purchases critical components from Integration Test Supplier.".length);
    expect(row.cite_text_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(row.normalized_cite_text_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(row.source_snapshot_sha256).toBe("itest");
    expect(row.parser_version).toBe("integration-fixture");
    expect(row.extractor_version).toBe("unknown");
    expect(row.relation_candidate_hash).toMatch(/^[a-f0-9]{64}$/);

    await builder.close();
  });

  it("rejects approved candidates with unknown extractor_id prefixes before committing evidence", async () => {
    const builder = new GraphBuilder(pool, new StaticResolver(), new StatsGraphStore({ nodes: 0, edges: 0 }));
    await expect(builder.apply(approvedCandidate({ extractorId: "rules.10k.typo", component: "unknown-extractor-test" }))).rejects.toThrow(
      /Unknown extractor_id prefix/
    );

    const evidence = await pool.query<CountRow>(
      "SELECT count(*)::text AS count FROM evidence WHERE doc_id = 'DOC-ITEST-GRAPH-SYNC' AND extractor_id = 'rules.10k.typo'"
    );
    const edge = await pool.query<CountRow>(
      "SELECT count(*)::text AS count FROM edges WHERE subject_id = 'ENT-ITEST-BUYER' AND object_id = 'ENT-ITEST-SUPPLIER' AND component = 'unknown-extractor-test'"
    );
    expect(evidence.rows[0]?.count).toBe("0");
    expect(edge.rows[0]?.count).toBe("0");

    await builder.close();
  });
});

async function seedIntegrationEntities(client: pg.Pool): Promise<void> {
  await client.query(
    `INSERT INTO entity_master (entity_id, kind, canonical_name, display_name, language_of_canonical, identifiers, primary_country, industry, status, attrs)
     VALUES
       ('ENT-ITEST-BUYER','company','Integration Test Buyer','Test Buyer','en','{}','US','{}','active','{}'),
       ('ENT-ITEST-SUPPLIER','company','Integration Test Supplier','Test Supplier','en','{}','US','{}','active','{}')
     ON CONFLICT (entity_id) DO UPDATE SET updated_at = now()`
  );
  await client.query(
    `INSERT INTO documents (doc_id, source_adapter_id, document_type, source_url, fetched_at, bytes_sha256, storage_key, language, parse_status, metadata)
     VALUES ('DOC-ITEST-GRAPH-SYNC','manual','manual','manual://itest-graph-sync',now(),'itest','itest','en','parsed','{"parser_version":"integration-fixture"}')
     ON CONFLICT (source_adapter_id, source_url, bytes_sha256) DO UPDATE SET fetched_at = EXCLUDED.fetched_at`
  );
  await client.query(
    `INSERT INTO document_chunks (chunk_id, doc_id, chunk_index, text, locator, language, token_count)
     VALUES (
       'CHK-ITEST-GRAPH-SYNC-1',
       'DOC-ITEST-GRAPH-SYNC',
       0,
       'Integration Test Buyer purchases critical components from Integration Test Supplier. Older integration evidence. Newer integration evidence. Integration Test Buyer purchases memory from Integration Test Supplier.',
       'integration fixture chunk',
       'en',
       24
     )
     ON CONFLICT (doc_id, chunk_index) DO UPDATE SET
       text = EXCLUDED.text,
       locator = EXCLUDED.locator,
       language = EXCLUDED.language,
       token_count = EXCLUDED.token_count`
  );
}

async function seedIntegrationComponents(client: pg.Pool): Promise<void> {
  await client.query(
    `INSERT INTO components (component_id, name, taxonomy_path, aliases)
     VALUES ('COMP-ITEST-MEMORY','memory',ARRAY['integration','memory'],ARRAY['memory'])
     ON CONFLICT (component_id) DO UPDATE SET
       name = EXCLUDED.name,
       taxonomy_path = EXCLUDED.taxonomy_path,
       aliases = EXCLUDED.aliases`
  );
}

async function cleanupIntegrationRows(client: pg.Pool): Promise<void> {
  await client.query(
    "DELETE FROM change_records WHERE scope_id IN (SELECT edge_id FROM edges WHERE subject_id = 'ENT-ITEST-BUYER' OR object_id = 'ENT-ITEST-SUPPLIER')"
  );
  await client.query("DELETE FROM edges WHERE subject_id = 'ENT-ITEST-BUYER' OR object_id = 'ENT-ITEST-SUPPLIER'");
  await client.query("DELETE FROM evidence WHERE doc_id = 'DOC-ITEST-GRAPH-SYNC'");
  await client.query("DELETE FROM document_chunks WHERE doc_id = 'DOC-ITEST-GRAPH-SYNC'");
  await client.query("DELETE FROM documents WHERE doc_id = 'DOC-ITEST-GRAPH-SYNC'");
  await client.query("DELETE FROM entity_alias WHERE entity_id IN ('ENT-ITEST-BUYER','ENT-ITEST-SUPPLIER')");
  await client.query("DELETE FROM entity_master WHERE entity_id IN ('ENT-ITEST-BUYER','ENT-ITEST-SUPPLIER')");
  await client.query("DELETE FROM components WHERE component_id = 'COMP-ITEST-MEMORY'");
}

async function currentPostgresProjection(client: pg.Pool): Promise<{ nodes: number; edges: number }> {
  const result = await client.query<ProjectionStatsRow>(
    `SELECT
       (SELECT count(*)::int FROM entity_master WHERE status = 'active') AS nodes,
       (SELECT count(*)::int FROM edges WHERE validity = 'current') AS edges`
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("projection query returned no rows");
  return { nodes: row.nodes, edges: row.edges };
}

function approvedCandidate(input: { component?: string; confidence?: number; citeText?: string; extractorId?: string } = {}): ApprovedCandidate {
  const confidence = input.confidence ?? 0.8;
  return {
    candidate: {
      subject_resolve: { surface: "Test Buyer" },
      object_resolve: { surface: "Test Supplier" },
      relation: "BUYS_FROM",
      ...(input.component === undefined ? {} : { component: input.component }),
      cite_text: input.citeText ?? "Integration Test Buyer purchases critical components from Integration Test Supplier.",
      cite_locator: "integration fixture",
      extractor_id: input.extractorId ?? "review.integration",
      raw_evidence_level_hint: 4,
      raw_confidence_hint: confidence
    },
    scoring: {
      evidence_level: 4,
      confidence,
      is_inferred: false,
      needs_review: false,
      rationale: "integration fixture",
      confidence_breakdown: { base: 0.85, factors: [], cap: 0.9, final: confidence }
    },
    approved_by: { reviewer: "integration", reviewed_at: "2026-05-16T00:00:00.000Z" },
    doc_id: "DOC-ITEST-GRAPH-SYNC",
    chunk_id: "CHK-ITEST-GRAPH-SYNC-1"
  };
}
