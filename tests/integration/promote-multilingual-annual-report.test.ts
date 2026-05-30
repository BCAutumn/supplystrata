import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@supplystrata/db/admin";
import type { DbClient } from "@supplystrata/db/write";
import { backfillDocumentFacts } from "@supplystrata/pipeline";
import { canConnectToIntegrationDatabase, createIntegrationDatabaseStore } from "./helpers.js";

// 端到端验证"四语正文走同一套抽取管线"：中文(巨潮)/日文(EDINET)/韩文(DART) 的 annual_report 正文，
// 与 SEC 10-K 一样进入 规则抽取 → evidence-gated promote，把可解析的供应关系落成 current 边。
// 交易对手都用既有种子实体（ENT-MICRON / ENT-TSMC / ENT-INTEL），其 display_name 即抽取器输出的 catalog surface，
// 解析唯一、无 alias 冲突；只新建发行人。这是"通用全球监控"的核心证明：语言不再是产边的门槛。
const SUBJECT_ID = "ENT-ITEST-ML-FILER";
const DOCS = [
  { docId: "DOC-ITEST-ML-ZH", language: "zh", supplier: "ENT-MICRON", text: "公司向美光采购存储芯片。" },
  { docId: "DOC-ITEST-ML-JA", language: "ja", supplier: "ENT-TSMC", text: "当社の主要な仕入先は台湾積体電路です。" },
  { docId: "DOC-ITEST-ML-KO", language: "ko", supplier: "ENT-INTEL", text: "당사는 인텔로부터 부품을 구매합니다." }
] as const;

interface CountRow extends pg.QueryResultRow {
  count: string;
}

const hasDatabase = await canConnectToIntegrationDatabase();

describe.skipIf(!hasDatabase)("promote facts from Chinese/Japanese/Korean annual reports", () => {
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

  it("extracts and promotes a supplier edge from each CJK annual_report body", async () => {
    const result = await backfillDocumentFacts(pool, { docIds: DOCS.map((doc) => doc.docId) });
    expect(result).toMatchObject({ documents_selected: 3, documents_processed: 3, applied_edges: 3, failures: [] });

    for (const doc of DOCS) {
      const edges = await pool.read.query<CountRow>(
        "SELECT count(*)::text AS count FROM edges WHERE subject_id = $1 AND object_id = $2 AND relation = 'BUYS_FROM' AND validity = 'current'",
        [SUBJECT_ID, doc.supplier]
      );
      expect(edges.rows[0]?.count, `expected a current BUYS_FROM edge for ${doc.language} → ${doc.supplier}`).toBe("1");
    }
  });
});

async function seed(client: DbClient): Promise<void> {
  await client.query(
    `INSERT INTO entity_master (entity_id, kind, canonical_name, display_name, language_of_canonical, identifiers, primary_country, industry, status, attrs)
     VALUES ($1,'company','Integration Multilingual Filer','ML Filer','en','{}','CN','{}','active','{}')
     ON CONFLICT (entity_id) DO UPDATE SET updated_at = now()`,
    [SUBJECT_ID]
  );
  for (const [index, doc] of DOCS.entries()) {
    await client.query(
      `INSERT INTO documents (doc_id, source_adapter_id, document_type, primary_entity_id, source_url, source_date, fetched_at, bytes_sha256, storage_key, language, parse_status, metadata)
       VALUES ($1,'company-ir','annual_report',$2,$3,'2026-03-31',now(),$4,$4,$5,'parsed','{"parser_version":"integration-fixture"}')
       ON CONFLICT (source_adapter_id, source_url, bytes_sha256) DO UPDATE SET fetched_at = EXCLUDED.fetched_at`,
      [doc.docId, SUBJECT_ID, `https://example.com/itest/ml-${doc.language}.html`, `itest-ml-${doc.language}`, doc.language]
    );
    await client.query(
      `INSERT INTO document_chunks (chunk_id, doc_id, chunk_index, text, locator, language, token_count)
       VALUES ($1,$2,0,$3,$4,$5,$6)
       ON CONFLICT (doc_id, chunk_index) DO UPDATE SET text = EXCLUDED.text, locator = EXCLUDED.locator, language = EXCLUDED.language`,
      [`CHK-ITEST-ML-${index}`, doc.docId, doc.text, `integration ${doc.language} chunk`, doc.language, Math.ceil(doc.text.length / 2)]
    );
  }
}

async function cleanup(client: DbClient): Promise<void> {
  // 只清理本测试新建的发行人与文档；交易对手 ENT-MICRON/ENT-TSMC/ENT-INTEL 是既有种子实体，不能删。
  await client.query("DELETE FROM change_records WHERE scope_id IN (SELECT edge_id FROM edges WHERE subject_id = $1)", [SUBJECT_ID]);
  await client.query("DELETE FROM edges WHERE subject_id = $1", [SUBJECT_ID]);
  for (const doc of DOCS) {
    await client.query("DELETE FROM evidence WHERE doc_id = $1", [doc.docId]);
    await client.query("DELETE FROM document_chunks WHERE doc_id = $1", [doc.docId]);
    await client.query("DELETE FROM documents WHERE doc_id = $1", [doc.docId]);
  }
  await client.query("DELETE FROM unknown_items WHERE scope_id = $1", [SUBJECT_ID]);
  await client.query("DELETE FROM entity_master WHERE entity_id = $1", [SUBJECT_ID]);
}
