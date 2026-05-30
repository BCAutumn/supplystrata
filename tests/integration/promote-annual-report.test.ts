import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@supplystrata/db/admin";
import type { DbClient } from "@supplystrata/db/write";
import { backfillDocumentFacts } from "@supplystrata/pipeline";
import { canConnectToIntegrationDatabase, createIntegrationDatabaseStore } from "./helpers.js";

// 验证“关系抽取不再 SEC-only”：来自公司官方 IR 的 annual_report 正文，与 SEC 10-K/20-F 一样
// 进入规则抽取 + evidence-gated promote，能把可解析的供应关系落成 current 边。这是“通用全球监控、
// 用户想监控啥就监控啥”的关键：任何发布英文年报的公司都能产边，而不只是在美国 SEC 报送的发行人。
// 交易对手用既有种子实体（ENT-FABRINET）解析，仅新建发行人，避免与其他测试争用同名 alias。
const SUBJECT_ID = "ENT-ITEST-IR-FILER";
const SUPPLIER_ID = "ENT-FABRINET";
const DOC_ID = "DOC-ITEST-IR-ANNUAL";

interface CountRow extends pg.QueryResultRow {
  count: string;
}

const hasDatabase = await canConnectToIntegrationDatabase();

describe.skipIf(!hasDatabase)("promote facts from non-SEC annual reports", () => {
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

  it("extracts and promotes a supplier edge from a company-ir annual_report (not SEC-only)", async () => {
    const result = await backfillDocumentFacts(pool, { docIds: [DOC_ID] });
    expect(result).toMatchObject({ documents_selected: 1, documents_processed: 1, applied_edges: 1, failures: [] });

    const edges = await pool.read.query<CountRow>(
      "SELECT count(*)::text AS count FROM edges WHERE subject_id = $1 AND object_id = $2 AND relation = 'BUYS_FROM' AND validity = 'current'",
      [SUBJECT_ID, SUPPLIER_ID]
    );
    expect(edges.rows[0]?.count).toBe("1");

    // 可信度由 evidence-scorer 按来源 authority 单独裁决：公司官方年报封顶 L4（区别于 SEC 监管披露的 L5）。
    const evidence = await pool.read.query<{ evidence_level: number }>(
      `SELECT ev.evidence_level
       FROM evidence ev
       JOIN edges e ON e.edge_id = ev.edge_id
       WHERE e.subject_id = $1 AND e.object_id = $2 AND ev.superseded_by IS NULL`,
      [SUBJECT_ID, SUPPLIER_ID]
    );
    expect(evidence.rows[0]?.evidence_level).toBeLessThanOrEqual(4);
  });
});

async function seed(client: DbClient): Promise<void> {
  await client.query(
    `INSERT INTO entity_master (entity_id, kind, canonical_name, display_name, language_of_canonical, identifiers, primary_country, industry, status, attrs)
     VALUES ($1,'company','Integration IR Filer','IR Filer','en','{}','JP','{}','active','{}')
     ON CONFLICT (entity_id) DO UPDATE SET updated_at = now()`,
    [SUBJECT_ID]
  );
  await client.query(
    `INSERT INTO documents (doc_id, source_adapter_id, document_type, primary_entity_id, source_url, source_date, fetched_at, bytes_sha256, storage_key, language, parse_status, metadata)
     VALUES ($1,'company-ir','annual_report',$2,'https://example.com/itest/ir-annual.html','2026-03-31',now(),'itest-ir-annual','itest-ir-annual','en','parsed','{"parser_version":"integration-fixture"}')
     ON CONFLICT (source_adapter_id, source_url, bytes_sha256) DO UPDATE SET fetched_at = EXCLUDED.fetched_at`,
    [DOC_ID, SUBJECT_ID]
  );
  await client.query(
    `INSERT INTO document_chunks (chunk_id, doc_id, chunk_index, text, locator, language, token_count)
     VALUES (
       'CHK-ITEST-IR-1',
       $1,
       0,
       'Fabrinet is our sole supplier of optical transceiver assembly and manufacturing services for our networking products.',
       'integration ir chunk',
       'en',
       18
     )
     ON CONFLICT (doc_id, chunk_index) DO UPDATE SET text = EXCLUDED.text, locator = EXCLUDED.locator`,
    [DOC_ID]
  );
}

async function cleanup(client: DbClient): Promise<void> {
  // 只清理本测试新建的发行人与文档；交易对手 ENT-FABRINET 是既有种子实体，不能删。
  await client.query("DELETE FROM change_records WHERE scope_id IN (SELECT edge_id FROM edges WHERE subject_id = $1)", [SUBJECT_ID]);
  await client.query("DELETE FROM edges WHERE subject_id = $1", [SUBJECT_ID]);
  await client.query("DELETE FROM evidence WHERE doc_id = $1", [DOC_ID]);
  await client.query("DELETE FROM unknown_items WHERE scope_id = $1", [SUBJECT_ID]);
  await client.query("DELETE FROM document_chunks WHERE doc_id = $1", [DOC_ID]);
  await client.query("DELETE FROM documents WHERE doc_id = $1", [DOC_ID]);
  await client.query("DELETE FROM entity_master WHERE entity_id = $1", [SUBJECT_ID]);
}
