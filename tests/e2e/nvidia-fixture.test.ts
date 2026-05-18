import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type EntityRecord, type RawDocument } from "@supplystrata/core";
import { createDatabaseStore, migrate, seedFromCsv, type DatabaseStore, type DbClient } from "@supplystrata/db";
import { GraphBuilder } from "@supplystrata/graph-builder";
import type { GraphEdgeInput, GraphStore } from "@supplystrata/graph-store";
import { parseHtml } from "@supplystrata/parsers-html";
import { runSupplyChainPipelineFromNormalized } from "@supplystrata/pipeline";
import { loadCompanyCard, loadUnknownMap } from "@supplystrata/card-builder";
import { renderCompanyCard, renderUnknownMapCard } from "@supplystrata/render";
import { DbEntityResolver } from "@supplystrata/entity-resolver";
import { canConnectToIntegrationDatabase } from "../integration/helpers.js";

const hasDatabase = await canConnectToIntegrationDatabase();

describe.skipIf(!hasDatabase)("NVIDIA fixture e2e", () => {
  const pool = createDatabaseStore();

  beforeAll(async () => {
    await migrate(pool);
    await seedFromCsv(pool);
    await cleanupFixtureRows(pool);
  });

  afterAll(async () => {
    await cleanupFixtureRows(pool);
    await rebuildGraphQuietly(pool);
    await pool.close();
  });

  it("runs parser, rule extraction, scoring, graph apply, render, and unknown map without network", async () => {
    const raw = await loadFixtureRawDocument();
    const normalized = parseHtml({
      raw,
      documentType: "10-K",
      primaryEntityId: "ENT-NVIDIA",
      sourceDate: "2026-02-24"
    });

    const summary = await runSupplyChainPipelineFromNormalized(pool, {
      normalized
    });
    const graphStore = new CountingGraphStore();
    const builder = new GraphBuilder(pool, new DbEntityResolver(pool), graphStore);
    try {
      const rebuildStats = await builder.rebuild();
      expect(rebuildStats.nodes).toBeGreaterThanOrEqual(59);
      expect(rebuildStats.edges).toBeGreaterThanOrEqual(8);
      await expect(builder.checkConsistency()).resolves.toMatchObject({
        status: "synced"
      });
    } finally {
      await builder.close();
    }

    const company = renderCompanyCard(await loadCompanyCard(pool, "nvidia"), "markdown");
    const unknownMap = renderUnknownMapCard(await loadUnknownMap(pool, "nvidia"), "markdown");

    expect(summary).toMatchObject({ candidates: 8, applied_edges: 8 });
    expect(summary.evidence_ids).toHaveLength(8);
    expect(company).toContain("USES_FOUNDRY (wafer) -> TSMC [Level 5");
    expect(company).toContain("BUYS_FROM (memory) -> SK Hynix [Level 5");
    expect(company).toContain("BUYS_FROM (manufacturing services) -> Foxconn [Level 5");
    expect(company).toContain("Evidence: EV-");
    expect(company).toContain("## Unknown map");
    expect(company).not.toContain("products.Competition");
    expect(unknownMap.split("\n- ")).toHaveLength(6);
  });
});

async function loadFixtureRawDocument(): Promise<RawDocument<Uint8Array>> {
  const fixturePath = resolve(process.cwd(), "tests/fixtures/sec-edgar/nvidia-10k-supply-chain-mini.html");
  const body = await readFile(fixturePath);
  const bytes = new Uint8Array(body);
  return {
    doc_id: "DOC-E2E-NVIDIA-10K-FIXTURE",
    source_adapter_id: "sec-edgar",
    url: "fixture://sec-edgar/nvidia-10k-supply-chain-mini.html",
    fetched_at: "2026-05-16T00:00:00.000Z",
    bytes_sha256: createHash("sha256").update(bytes).digest("hex"),
    storage_key: "fixtures/sec-edgar/nvidia-10k-supply-chain-mini.html",
    body: bytes,
    metadata: {
      document_type: "10-K",
      primary_entity_id: "ENT-NVIDIA",
      source_date: "2026-02-24"
    }
  };
}

async function cleanupFixtureRows(client: DbClient): Promise<void> {
  const touchedEdgeIds = await listFixtureEvidenceEdgeIds(client);
  const fixtureEvidenceIds = await listFixtureEvidenceIds(client);
  const edgesWithNonFixtureEvidence = await listEdgesWithNonFixtureEvidence(client, touchedEdgeIds);
  const edgesOnlyBackedByFixture = touchedEdgeIds.filter((edgeId) => !edgesWithNonFixtureEvidence.has(edgeId));
  const reusableEdgesTouchedByFixture = touchedEdgeIds.filter((edgeId) => edgesWithNonFixtureEvidence.has(edgeId));

  if (fixtureEvidenceIds.length > 0) {
    await client.query("DELETE FROM change_records WHERE evidence_ids && $1::text[]", [fixtureEvidenceIds]);
  }
  if (edgesOnlyBackedByFixture.length > 0) {
    await client.query("DELETE FROM edges WHERE edge_id = ANY($1::text[])", [edgesOnlyBackedByFixture]);
  }
  for (const edgeId of reusableEdgesTouchedByFixture) {
    await promoteBestPrimaryEvidenceExcludingFixture(client, edgeId);
  }
  await cleanupFixtureSourceMonitoringRows(client);
  await client.query("DELETE FROM evidence WHERE doc_id = 'DOC-E2E-NVIDIA-10K-FIXTURE'");
  await client.query("DELETE FROM document_chunks WHERE doc_id = 'DOC-E2E-NVIDIA-10K-FIXTURE'");
  await client.query("DELETE FROM documents WHERE doc_id = 'DOC-E2E-NVIDIA-10K-FIXTURE'");
}

async function cleanupFixtureSourceMonitoringRows(client: DbClient): Promise<void> {
  await client.query("DELETE FROM source_change_events WHERE doc_id = 'DOC-E2E-NVIDIA-10K-FIXTURE'");
  await client.query("DELETE FROM document_versions WHERE doc_id = 'DOC-E2E-NVIDIA-10K-FIXTURE'");
  await client.query(
    `UPDATE source_items
     SET latest_doc_id = NULL,
         latest_bytes_sha256 = NULL,
         latest_storage_key = NULL
     WHERE latest_doc_id = 'DOC-E2E-NVIDIA-10K-FIXTURE'`
  );
}

async function listFixtureEvidenceEdgeIds(client: DbClient): Promise<string[]> {
  const result = await client.query<{ edge_id: string | null } & pg.QueryResultRow>(
    "SELECT DISTINCT edge_id FROM evidence WHERE doc_id = 'DOC-E2E-NVIDIA-10K-FIXTURE'"
  );
  return result.rows.map((row) => row.edge_id).filter((edgeId): edgeId is string => edgeId !== null);
}

async function listFixtureEvidenceIds(client: DbClient): Promise<string[]> {
  const result = await client.query<{ evidence_id: string } & pg.QueryResultRow>(
    "SELECT evidence_id FROM evidence WHERE doc_id = 'DOC-E2E-NVIDIA-10K-FIXTURE'"
  );
  return result.rows.map((row) => row.evidence_id);
}

async function listEdgesWithNonFixtureEvidence(client: DbClient, edgeIds: readonly string[]): Promise<Set<string>> {
  if (edgeIds.length === 0) return new Set();
  const result = await client.query<{ edge_id: string } & pg.QueryResultRow>(
    "SELECT DISTINCT edge_id FROM evidence WHERE edge_id = ANY($1::text[]) AND doc_id <> 'DOC-E2E-NVIDIA-10K-FIXTURE'",
    [edgeIds]
  );
  return new Set(result.rows.map((row) => row.edge_id));
}

async function promoteBestPrimaryEvidenceExcludingFixture(client: DbClient, edgeId: string): Promise<void> {
  await client.query(
    `WITH best_evidence AS (
       SELECT evidence_id
       FROM evidence
       WHERE edge_id = $1 AND superseded_by IS NULL AND doc_id <> 'DOC-E2E-NVIDIA-10K-FIXTURE'
       ORDER BY evidence_level DESC, confidence DESC, created_at DESC, evidence_id DESC
       LIMIT 1
     )
     UPDATE edges
     SET primary_evidence_id = best_evidence.evidence_id, updated_at = now()
     FROM best_evidence
     WHERE edges.edge_id = $1`,
    [edgeId]
  );
}

async function rebuildGraphQuietly(pool: DatabaseStore): Promise<void> {
  const builder = new GraphBuilder(pool, new DbEntityResolver(pool), new CountingGraphStore());
  try {
    await builder.rebuild();
  } finally {
    await builder.close();
  }
}

class CountingGraphStore implements GraphStore {
  readonly #nodes = new Set<string>();
  readonly #edges = new Set<string>();

  async close(): Promise<void> {}

  async ensureSchema(): Promise<void> {}

  async clear(): Promise<void> {
    this.#nodes.clear();
    this.#edges.clear();
  }

  async upsertEntity(entity: EntityRecord): Promise<void> {
    this.#nodes.add(entity.entity_id);
  }

  async upsertEdge(edge: GraphEdgeInput): Promise<void> {
    this.#edges.add(edge.edge_id);
  }

  async removeEdge(edgeId: string): Promise<void> {
    this.#edges.delete(edgeId);
  }

  async stats(): Promise<{ nodes: number; edges: number }> {
    return { nodes: this.#nodes.size, edges: this.#edges.size };
  }
}
