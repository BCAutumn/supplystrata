import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate, seedFromCsv } from "@supplystrata/db/admin";
import type { DbClient } from "@supplystrata/db/write";
import { canConnectToIntegrationDatabase, createIntegrationDatabaseStore } from "./helpers.js";

const hasDatabase = await canConnectToIntegrationDatabase();

describe.skipIf(!hasDatabase)("component seed backfill", () => {
  const pool = createIntegrationDatabaseStore();

  beforeAll(async () => {
    await migrate(pool);
    await seedFromCsv(pool);
    await pool.transaction(cleanupRows);
  });

  beforeEach(async () => {
    await pool.transaction(cleanupRows);
  });

  afterAll(async () => {
    await pool.transaction(cleanupRows);
    await pool.close();
  });

  it("demotes legacy HBM edges when the primary evidence only says memory", async () => {
    await pool.transaction(insertLegacyHbmEdge);
    await seedFromCsv(pool);

    const result = await pool.read.query<{ component: string | null; component_id: string | null; component_specificity: string | null } & pg.QueryResultRow>(
      "SELECT component, component_id, component_specificity FROM edges WHERE edge_id = 'EDGE-ITEST-LEGACY-HBM'"
    );

    expect(result.rows[0]).toMatchObject({
      component: "memory",
      component_id: "COMP-MEMORY",
      component_specificity: "unspecified"
    });
  });

  it("deprecates legacy HBM edges when a memory edge already exists", async () => {
    await pool.transaction(insertLegacyHbmEdge);
    await pool.transaction((client) =>
      client.query(
        `INSERT INTO edges (edge_id, subject_id, object_id, relation, component, component_id, component_specificity, evidence_level, confidence, is_inferred, validity)
       VALUES ('EDGE-ITEST-MEMORY-TARGET','ENT-ITEST-COMPONENT-BUYER','ENT-ITEST-COMPONENT-SUPPLIER','BUYS_FROM','memory','COMP-MEMORY','unspecified',5,0.93,false,'current')`
      )
    );
    await seedFromCsv(pool);

    const result = await pool.read.query<{ validity: string; superseded_by_edge_id: string | null } & pg.QueryResultRow>(
      "SELECT validity, superseded_by_edge_id FROM edges WHERE edge_id = 'EDGE-ITEST-LEGACY-HBM'"
    );

    expect(result.rows[0]).toMatchObject({
      validity: "deprecated",
      superseded_by_edge_id: "EDGE-ITEST-MEMORY-TARGET"
    });
  });
});

async function insertLegacyHbmEdge(client: DbClient): Promise<void> {
  await client.query(
    `INSERT INTO entity_master (entity_id, kind, canonical_name, display_name, language_of_canonical, identifiers, primary_country, industry, status, attrs)
     VALUES
       ('ENT-ITEST-COMPONENT-BUYER','company','Component Backfill Buyer','Component Backfill Buyer','en','{}','US','{}','active','{}'),
       ('ENT-ITEST-COMPONENT-SUPPLIER','company','Component Backfill Supplier','Component Backfill Supplier','en','{}','KR','{}','active','{}')
     ON CONFLICT (entity_id) DO UPDATE SET updated_at = now()`
  );
  await client.query(
    `INSERT INTO documents (doc_id, source_adapter_id, document_type, primary_entity_id, source_url, fetched_at, bytes_sha256, storage_key, language, parse_status, metadata)
     VALUES ('DOC-ITEST-LEGACY-HBM','sec-edgar','10-K','ENT-ITEST-COMPONENT-BUYER','fixture://legacy-hbm',now(),'legacy-hbm','legacy-hbm','en','parsed','{}')
     ON CONFLICT (source_adapter_id, source_url, bytes_sha256) DO UPDATE SET fetched_at = EXCLUDED.fetched_at`
  );
  await client.query(
    `INSERT INTO edges (edge_id, subject_id, object_id, relation, component, evidence_level, confidence, is_inferred, validity)
     VALUES ('EDGE-ITEST-LEGACY-HBM','ENT-ITEST-COMPONENT-BUYER','ENT-ITEST-COMPONENT-SUPPLIER','BUYS_FROM','HBM',5,0.92,false,'current')`
  );
  await client.query(
    `INSERT INTO evidence (evidence_id, edge_id, doc_id, cite_text, cite_locator, evidence_level, confidence, is_inferred, extraction_method, extractor_id, confidence_breakdown, rationale)
     VALUES (
       'EV-ITEST-LEGACY-HBM',
       'EDGE-ITEST-LEGACY-HBM',
       'DOC-ITEST-LEGACY-HBM',
       'We purchase memory from SK Hynix Inc., Micron Technology, Inc., and Samsung.',
       'fixture',
       5,
       0.92,
       false,
       'rule',
       'rule.10k.nvidia-supply-chain',
       '{"base":0.92,"factors":[],"cap":5,"final":0.92}'::jsonb,
       'legacy fixture'
     )`
  );
  await client.query("UPDATE edges SET primary_evidence_id = 'EV-ITEST-LEGACY-HBM' WHERE edge_id = 'EDGE-ITEST-LEGACY-HBM'");
}

async function cleanupRows(client: DbClient): Promise<void> {
  await client.query("DELETE FROM edges WHERE edge_id = 'EDGE-ITEST-LEGACY-HBM'");
  await client.query("DELETE FROM edges WHERE edge_id = 'EDGE-ITEST-MEMORY-TARGET'");
  await client.query("DELETE FROM evidence WHERE evidence_id = 'EV-ITEST-LEGACY-HBM'");
  await client.query("DELETE FROM documents WHERE doc_id = 'DOC-ITEST-LEGACY-HBM'");
  await client.query("DELETE FROM entity_master WHERE entity_id IN ('ENT-ITEST-COMPONENT-BUYER','ENT-ITEST-COMPONENT-SUPPLIER')");
}
