import type pg from "pg";
import { describe, expect, it } from "vitest";
import { ensureSupplierListFacilityEntity } from "@supplystrata/entity-import";
import { buildSupplierListReviewCandidate } from "@supplystrata/review-candidates";
import { dbTxClientBrand, type DbTxClient } from "@supplystrata/db/write";
import type { SupplierListCandidate } from "@supplystrata/supplier-list";

interface QueryCall {
  sql: string;
  params: readonly unknown[];
}

class MockDbClient implements DbTxClient {
  readonly [dbTxClientBrand]: true = true;
  readonly calls: QueryCall[] = [];
  readonly #aliasConflictEntityId: string | undefined;

  constructor(input: { aliasConflictEntityId?: string } = {}) {
    this.#aliasConflictEntityId = input.aliasConflictEntityId;
  }

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    if (sql.includes("FROM entity_alias") && this.#aliasConflictEntityId !== undefined) {
      return queryResult([{ entity_id: this.#aliasConflictEntityId, alias: String(params[0] ?? "") } as unknown as T]);
    }
    const rowCount = sql.includes("INSERT INTO entity_alias") ? 1 : 0;
    return queryResult([], rowCount);
  }
}

describe("entity import", () => {
  it("creates stable facility entities from approved supplier-list rows", async () => {
    const client = new MockDbClient();
    const candidate = supplierListReviewCandidate();

    const result = await ensureSupplierListFacilityEntity(client, candidate, "tester");

    expect(result).toMatchObject({
      status: "applied",
      display_name: "Supplier Co. facility: Penang, Malaysia",
      aliases_inserted: 1,
      aliases_skipped: 0
    });
    if (result.status !== "applied") throw new Error("expected applied facility import");
    expect(result.entity_id).toMatch(/^ENT-FAC-[A-F0-9]{16}$/);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO entity_master") && call.sql.includes("'facility'"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO entity_alias") && call.params.includes(result.display_name))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO change_records") && call.sql.includes("'facility_source_import'"))).toBe(true);
  });

  it("blocks facility imports when the canonical facility alias belongs to another entity", async () => {
    const client = new MockDbClient({ aliasConflictEntityId: "ENT-FAC-OTHER" });
    const result = await ensureSupplierListFacilityEntity(client, supplierListReviewCandidate(), "tester");

    expect(result).toEqual({
      status: "blocked",
      reason: "facility alias already belongs to ENT-FAC-OTHER: Supplier Co. facility: Penang, Malaysia"
    });
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO entity_master"))).toBe(false);
  });
});

function supplierListReviewCandidate() {
  const source: SupplierListCandidate = {
    buyer_entity_id: "ENT-APPLE",
    buyer_name: "Apple",
    supplier_name: "Supplier Co.",
    location_text: "Penang",
    country_or_region: "Malaysia",
    source_row_text: "Supplier Co.                         Penang                                     Malaysia",
    normalized_record_text: "Apple | Supplier Co. | Penang | Malaysia",
    source_adapter_id: "apple-suppliers",
    source_fiscal_year: 2022,
    source_locator: "Apple Supplier List FY2022 line 99",
    confidence: 0.82,
    needs_review: true,
    review_reason: "表格候选需要人工复核。",
    relation_hint: "BUYS_FROM",
    facility_relation_hint: "MANUFACTURES_AT"
  };
  return buildSupplierListReviewCandidate({
    candidate: source,
    docId: "DOC-apple",
    sourceUrl: "https://www.apple.com/supplier-responsibility/pdf/Apple-Supplier-List.pdf"
  });
}

function queryResult<T extends pg.QueryResultRow>(rows: T[], rowCount = rows.length): pg.QueryResult<T> {
  return {
    command: "",
    rowCount,
    oid: 0,
    fields: [],
    rows
  };
}
