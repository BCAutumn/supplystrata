import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@supplystrata/db/admin";
import type { DbClient } from "@supplystrata/db/write";
import { backfillDocumentFacts } from "@supplystrata/pipeline";
import { canConnectToIntegrationDatabase, createIntegrationDatabaseStore } from "./helpers.js";

const SUBJECT_ID = "ENT-ITEST-BACKFILL-ASML";
const SUPPLIER_ID = "ENT-ITEST-BACKFILL-ZEISS";
const DOC_ID = "DOC-ITEST-BACKFILL-20F";

interface CountRow extends pg.QueryResultRow {
  count: string;
}

const hasDatabase = await canConnectToIntegrationDatabase();

describe.skipIf(!hasDatabase)("backfillDocumentFacts integration", () => {
  const pool = createIntegrationDatabaseStore();

  beforeAll(async () => {
    await migrate(pool);
    await pool.transaction(async (client) => {
      await cleanup(client);
      await seed(client);
    });
  });

  afterAll(async () => {
    await pool.transaction(cleanup);
    await pool.close();
  });

  it("re-extracts a stored 20-F, promotes the resolvable supplier edge, and stays idempotent on re-run", async () => {
    const first = await backfillDocumentFacts(pool, { docIds: [DOC_ID] });
    expect(first).toMatchObject({ documents_selected: 1, documents_processed: 1, applied_edges: 1, failures: [] });

    const second = await backfillDocumentFacts(pool, { docIds: [DOC_ID] });
    expect(second).toMatchObject({ documents_selected: 1, documents_processed: 1, applied_edges: 1, failures: [] });

    const edges = await pool.read.query<CountRow>(
      "SELECT count(*)::text AS count FROM edges WHERE subject_id = $1 AND object_id = $2 AND relation = 'BUYS_FROM' AND validity = 'current'",
      [SUBJECT_ID, SUPPLIER_ID]
    );
    expect(edges.rows[0]?.count).toBe("1");

    const activeEvidence = await pool.read.query<CountRow>(
      `SELECT count(*)::text AS count
       FROM evidence ev
       JOIN edges e ON e.edge_id = ev.edge_id
       WHERE e.subject_id = $1 AND e.object_id = $2 AND ev.superseded_by IS NULL`,
      [SUBJECT_ID, SUPPLIER_ID]
    );
    expect(activeEvidence.rows[0]?.count).toBe("1");
  });

  it("selects stored extractable documents by entity scope", async () => {
    const result = await backfillDocumentFacts(pool, { entityId: SUBJECT_ID, sourceAdapterId: "sec-edgar", documentTypes: ["20-F"] });
    expect(result.documents_selected).toBe(1);
    expect(result.documents_processed).toBe(1);
  });
});

async function seed(client: DbClient): Promise<void> {
  await client.query(
    `INSERT INTO entity_master (entity_id, kind, canonical_name, display_name, language_of_canonical, identifiers, primary_country, industry, status, attrs)
     VALUES
       ($1,'company','Integration Backfill ASML','Backfill ASML','en','{}','NL','{}','active','{}'),
       ($2,'company','Carl Zeiss SMT','Carl Zeiss SMT','en','{}','DE','{}','active','{}')
     ON CONFLICT (entity_id) DO UPDATE SET updated_at = now()`,
    [SUBJECT_ID, SUPPLIER_ID]
  );
  await client.query(
    `INSERT INTO entity_alias (alias_id, entity_id, alias, alias_norm, language, alias_kind, source_type, added_by, status)
     VALUES ('ALIAS-ITEST-BACKFILL-ZEISS',$1,'Carl Zeiss SMT', lower('Carl Zeiss SMT'),'en','official','canonical_name','integration','active')
     ON CONFLICT (alias_id) DO NOTHING`,
    [SUPPLIER_ID]
  );
  await client.query(
    `INSERT INTO documents (doc_id, source_adapter_id, document_type, primary_entity_id, source_url, source_date, fetched_at, bytes_sha256, storage_key, language, parse_status, metadata)
     VALUES ($1,'sec-edgar','20-F',$2,'https://www.sec.gov/itest/backfill-20f.htm','2026-02-24',now(),'itest-backfill','itest-backfill','en','parsed','{"parser_version":"integration-fixture"}')
     ON CONFLICT (source_adapter_id, source_url, bytes_sha256) DO UPDATE SET fetched_at = EXCLUDED.fetched_at`,
    [DOC_ID, SUBJECT_ID]
  );
  await client.query(
    `INSERT INTO components (component_id, name, taxonomy_path, aliases)
     VALUES ('COMP-OPTICS','Optics',ARRAY['semiconductor','equipment','lithography','optics'],ARRAY['optical components','lenses','mirrors'])
     ON CONFLICT (component_id) DO UPDATE SET name = EXCLUDED.name`
  );
  await client.query(
    `INSERT INTO document_chunks (chunk_id, doc_id, chunk_index, text, locator, language, token_count)
     VALUES (
       'CHK-ITEST-BACKFILL-1',
       $1,
       0,
       'Carl Zeiss SMT is our sole supplier of lenses, mirrors, illuminators and other critical optical components.',
       'integration backfill chunk',
       'en',
       18
     )
     ON CONFLICT (doc_id, chunk_index) DO UPDATE SET text = EXCLUDED.text, locator = EXCLUDED.locator`,
    [DOC_ID]
  );
}

async function cleanup(client: DbClient): Promise<void> {
  await client.query("DELETE FROM change_records WHERE scope_id IN (SELECT edge_id FROM edges WHERE subject_id = $1)", [SUBJECT_ID]);
  await client.query("DELETE FROM edges WHERE subject_id = $1", [SUBJECT_ID]);
  await client.query("DELETE FROM evidence WHERE doc_id = $1", [DOC_ID]);
  await client.query("DELETE FROM unknown_items WHERE scope_id = $1", [SUBJECT_ID]);
  await client.query("DELETE FROM document_chunks WHERE doc_id = $1", [DOC_ID]);
  await client.query("DELETE FROM documents WHERE doc_id = $1", [DOC_ID]);
  await client.query("DELETE FROM entity_alias WHERE entity_id IN ($1,$2)", [SUBJECT_ID, SUPPLIER_ID]);
  await client.query("DELETE FROM entity_master WHERE entity_id IN ($1,$2)", [SUBJECT_ID, SUPPLIER_ID]);
}
