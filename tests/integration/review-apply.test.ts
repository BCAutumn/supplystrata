import { createHash } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeAlias, type NormalizedDocument } from "@supplystrata/core";
import { migrate } from "@supplystrata/db/admin";
import { saveNormalizedDocument, type DbClient } from "@supplystrata/db/write";
import { applyApprovedReviewCandidate } from "@supplystrata/pipeline";
import { buildSupplierListReviewCandidate, supplierListFacilityDisplayName, supplierListFacilityEntityId } from "@supplystrata/review-candidates";
import { decideReviewCandidateTransactionally, enqueueReviewCandidatesTransactionally, getReviewCandidate } from "@supplystrata/review-store";
import type { SupplierListCandidate } from "@supplystrata/supplier-list";
import { canConnectToIntegrationDatabase, createIntegrationDatabaseStore } from "./helpers.js";

interface CountRow extends pg.QueryResultRow {
  count: string;
}

interface EdgeRow extends pg.QueryResultRow {
  edge_id: string;
  relation: string;
  subject_id: string;
  object_id: string;
  evidence_level: number;
}

interface EvidenceRow extends pg.QueryResultRow {
  cite_text: string;
  cite_start_char: number | null;
  cite_end_char: number | null;
}

const hasDatabase = await canConnectToIntegrationDatabase();

describe.skipIf(!hasDatabase)("review apply integration", () => {
  const pool = createIntegrationDatabaseStore();

  beforeAll(async () => {
    await migrate(pool);
    await pool.transaction(async (client) => {
      await cleanupRows(client);
      await seedReviewApplyEntities(client);
    });
    await saveNormalizedDocument(pool, supplierListDocument());
  });

  afterAll(async () => {
    await pool.transaction(cleanupRows);
    await pool.close();
  });

  it("applies one approved supplier-list row into supplier and facility edges", async () => {
    const candidate = buildSupplierListReviewCandidate({
      candidate: supplierListCandidate(),
      docId: "DOC-ITEST-APPLE-SUPPLIER",
      sourceUrl: "fixture://apple-suppliers/review-apply.pdf",
      sourceDate: "2022-09-30"
    });

    await enqueueReviewCandidatesTransactionally(pool, [candidate]);
    await decideReviewCandidateTransactionally(pool, {
      reviewId: candidate.review_id,
      decision: "approved",
      reviewer: "integration",
      reason: "integration fixture"
    });

    const result = await applyApprovedReviewCandidate(pool, candidate.review_id, "integration");
    const applied = await getReviewCandidate(pool.read, candidate.review_id);
    const facilityEntityId = supplierListFacilityEntityId(candidate);
    const facilityDisplayName = supplierListFacilityDisplayName(candidate);

    expect(result).toMatchObject({
      status: "applied",
      review_id: candidate.review_id,
      facility_import: {
        entity_id: facilityEntityId,
        display_name: facilityDisplayName
      }
    });
    if (result.status !== "applied") throw new Error("expected supplier-list review apply to succeed");
    expect(result.apply_results.map((item) => item.relation).sort()).toEqual(["BUYS_FROM", "MANUFACTURES_AT"]);
    expect(result.apply_results).toHaveLength(2);
    expect(applied).toMatchObject({ status: "applied" });

    const edges = await pool.read.query<EdgeRow>(
      `SELECT edge_id, relation, subject_id, object_id, evidence_level
       FROM edges
       WHERE subject_id IN ('ENT-ITEST-APPLE','ENT-ITEST-SUPPLIER')
          OR object_id IN ('ENT-ITEST-SUPPLIER',$1)
       ORDER BY relation`,
      [facilityEntityId]
    );
    expect(edges.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: "BUYS_FROM", subject_id: "ENT-ITEST-APPLE", object_id: "ENT-ITEST-SUPPLIER", evidence_level: 4 }),
        expect.objectContaining({ relation: "MANUFACTURES_AT", subject_id: "ENT-ITEST-SUPPLIER", object_id: facilityEntityId, evidence_level: 4 })
      ])
    );

    const facility = await pool.read.query<CountRow>("SELECT count(*)::text AS count FROM entity_master WHERE entity_id = $1 AND kind = 'facility'", [
      facilityEntityId
    ]);
    const facilityAlias = await pool.read.query<CountRow>("SELECT count(*)::text AS count FROM entity_alias WHERE entity_id = $1 AND alias = $2", [
      facilityEntityId,
      facilityDisplayName
    ]);
    const evidence = await pool.read.query<CountRow>("SELECT count(*)::text AS count FROM evidence WHERE doc_id = 'DOC-ITEST-APPLE-SUPPLIER'");
    const evidenceRows = await pool.read.query<EvidenceRow>(
      `SELECT cite_text, cite_start_char, cite_end_char
       FROM evidence
       WHERE doc_id = 'DOC-ITEST-APPLE-SUPPLIER'
       ORDER BY extractor_id`
    );
    const changes = await pool.read.query<CountRow>("SELECT count(*)::text AS count FROM change_records WHERE scope_id = $1 OR evidence_ids && $2::text[]", [
      facilityEntityId,
      result.apply_results.map((item) => item.evidence_id)
    ]);

    expect(facility.rows[0]?.count).toBe("1");
    expect(facilityAlias.rows[0]?.count).toBe("1");
    expect(evidence.rows[0]?.count).toBe("2");
    expect(evidenceRows.rows).toEqual([
      { cite_text: "Integration Supplier Penang Malaysia", cite_start_char: 7, cite_end_char: 44 },
      { cite_text: "Integration Supplier Penang Malaysia", cite_start_char: 7, cite_end_char: 44 }
    ]);
    expect(Number.parseInt(changes.rows[0]?.count ?? "0", 10)).toBeGreaterThanOrEqual(3);
  });
});

async function seedReviewApplyEntities(client: DbClient): Promise<void> {
  await client.query(
    `INSERT INTO entity_master (entity_id, kind, canonical_name, display_name, language_of_canonical, identifiers, primary_country, industry, status, attrs)
     VALUES
       ('ENT-ITEST-APPLE','company','Integration Apple','Integration Apple','en','{}','US','{}','active','{}'),
       ('ENT-ITEST-SUPPLIER','company','Integration Supplier','Integration Supplier','en','{}','MY','{}','active','{}')
     ON CONFLICT (entity_id) DO UPDATE SET updated_at = now()`
  );
  await insertAlias(client, "ENT-ITEST-APPLE", "Integration Apple");
  await insertAlias(client, "ENT-ITEST-SUPPLIER", "Integration Supplier");
}

async function insertAlias(client: DbClient, entityId: string, alias: string): Promise<void> {
  await client.query(
    `INSERT INTO entity_alias (alias_id, entity_id, alias, alias_norm, language, alias_kind, source_type, added_by, status)
     VALUES ($1,$2,$3,$4,'en','official','integration','integration','active')
     ON CONFLICT (entity_id, alias_norm, language) DO UPDATE SET
       alias = EXCLUDED.alias,
       alias_kind = EXCLUDED.alias_kind,
       source_type = EXCLUDED.source_type,
       status = EXCLUDED.status`,
    [`ALIAS-${entityId}`, entityId, alias, normalizeAlias(alias)]
  );
}

function supplierListCandidate(): SupplierListCandidate {
  return {
    buyer_entity_id: "ENT-ITEST-APPLE",
    buyer_name: "Integration Apple",
    supplier_name: "Integration Supplier",
    location_text: "Penang",
    country_or_region: "Malaysia",
    source_row_text: supplierRowText(),
    normalized_record_text: "Integration Apple | Integration Supplier | Penang | Malaysia",
    source_adapter_id: "apple-suppliers",
    source_fiscal_year: 2022,
    source_locator: "Apple Supplier List FY2022 line ITEST",
    confidence: 0.84,
    needs_review: true,
    review_reason: "表格候选需要人工复核。",
    relation_hint: "BUYS_FROM",
    facility_relation_hint: "MANUFACTURES_AT"
  };
}

function supplierListDocument(): NormalizedDocument {
  const text = "Header\nIntegration Supplier Penang Malaysia\nFooter";
  return {
    doc_id: "DOC-ITEST-APPLE-SUPPLIER",
    source_adapter_id: "apple-suppliers",
    document_type: "supplier_list",
    primary_entity_id: "ENT-ITEST-APPLE",
    source_url: "fixture://apple-suppliers/review-apply.pdf",
    source_date: "2022-09-30",
    fetched_at: "2026-05-17T00:00:00.000Z",
    storage_key: "fixtures/apple-suppliers/review-apply.pdf",
    bytes_sha256: createHash("sha256").update(text).digest("hex"),
    language: "en",
    text,
    chunks: [
      {
        chunk_id: "DOC-ITEST-APPLE-SUPPLIER-CHK-0001",
        text,
        locator: "fixture row",
        language: "en",
        token_count: 8
      }
    ],
    metadata: { parser_version: "integration-fixture" }
  };
}

function supplierRowText(): string {
  return "Integration Supplier                 Penang                                     Malaysia";
}

async function cleanupRows(client: DbClient): Promise<void> {
  const reviewCandidate = buildSupplierListReviewCandidate({
    candidate: supplierListCandidate(),
    docId: "DOC-ITEST-APPLE-SUPPLIER",
    sourceUrl: "fixture://apple-suppliers/review-apply.pdf",
    sourceDate: "2022-09-30"
  });
  const facilityEntityId = supplierListFacilityEntityId(reviewCandidate);

  await client.query("DELETE FROM review_candidates WHERE review_id = $1", [reviewCandidate.review_id]);
  await client.query(
    "DELETE FROM change_records WHERE scope_id IN (SELECT edge_id FROM edges WHERE subject_id IN ('ENT-ITEST-APPLE','ENT-ITEST-SUPPLIER') OR object_id IN ('ENT-ITEST-SUPPLIER',$1))",
    [facilityEntityId]
  );
  await client.query("DELETE FROM change_records WHERE scope_kind = 'entity' AND scope_id = $1", [facilityEntityId]);
  await client.query("DELETE FROM edges WHERE subject_id IN ('ENT-ITEST-APPLE','ENT-ITEST-SUPPLIER') OR object_id IN ('ENT-ITEST-SUPPLIER',$1)", [
    facilityEntityId
  ]);
  await client.query("DELETE FROM evidence WHERE doc_id = 'DOC-ITEST-APPLE-SUPPLIER'");
  await client.query("DELETE FROM document_chunks WHERE doc_id = 'DOC-ITEST-APPLE-SUPPLIER'");
  await client.query("DELETE FROM documents WHERE doc_id = 'DOC-ITEST-APPLE-SUPPLIER'");
  await client.query("DELETE FROM entity_alias WHERE entity_id IN ('ENT-ITEST-APPLE','ENT-ITEST-SUPPLIER',$1)", [facilityEntityId]);
  await client.query("DELETE FROM entity_master WHERE entity_id IN ('ENT-ITEST-APPLE','ENT-ITEST-SUPPLIER',$1)", [facilityEntityId]);
}
