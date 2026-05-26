import type pg from "pg";
import { describe, expect, it } from "vitest";
import { applyEntitySourceReviewCandidate, ensureSupplierListFacilityEntity } from "@supplystrata/entity-import";
import { createEntitySourceCandidate } from "@supplystrata/entity-source";
import { buildEntitySourceReviewCandidate, buildSupplierListReviewCandidate } from "@supplystrata/review-candidates";
import { dbTxClientBrand, type DbTxClient } from "@supplystrata/db/write";
import type { EntitySourceIdentifierSet } from "@supplystrata/entity-source";
import type { SupplierListCandidate } from "@supplystrata/supplier-list";

interface QueryCall {
  sql: string;
  params: readonly unknown[];
}

class MockDbClient implements DbTxClient {
  readonly [dbTxClientBrand]: true = true;
  readonly calls: QueryCall[] = [];
  readonly #aliasConflictEntityId: string | undefined;
  readonly #identifierConflicts: ReadonlyMap<string, string>;

  constructor(input: { aliasConflictEntityId?: string; identifierConflicts?: ReadonlyMap<string, string> } = {}) {
    this.#aliasConflictEntityId = input.aliasConflictEntityId;
    this.#identifierConflicts = input.identifierConflicts ?? new Map();
  }

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    if (sql.includes("FROM entity_master") && params.length >= 2) {
      const conflict = this.#identifierConflicts.get(`${String(params[0])}:${String(params[1])}`);
      if (conflict !== undefined) return queryResult([{ entity_id: conflict } as unknown as T]);
    }
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

  it("does not treat jurisdiction or local company number as globally unique entity-source identifiers", async () => {
    const client = new MockDbClient({
      identifierConflicts: new Map([
        ["jurisdiction_code:US-DE", "ENT-OTHER-US-DE"],
        ["company_number:2301314", "ENT-OTHER-COMPANY-NUMBER"]
      ])
    });
    const result = await applyEntitySourceReviewCandidate(
      client,
      entitySourceReviewCandidate({
        identifiers: {
          company_number: "2301314",
          jurisdiction_code: "US-DE"
        }
      }),
      "tester"
    );

    expect(result.status).toBe("applied");
    expect(client.calls.some((call) => call.sql.includes("FROM entity_master") && call.params[0] === "jurisdiction_code")).toBe(false);
    expect(client.calls.some((call) => call.sql.includes("FROM entity_master") && call.params[0] === "company_number")).toBe(false);
  });

  it("blocks entity-source imports when a globally unique LEI already belongs to another entity", async () => {
    const client = new MockDbClient({ identifierConflicts: new Map([["lei:ZV20P4CNJVT8V1ZGJ064", "ENT-OTHER-LEI"]]) });
    const result = await applyEntitySourceReviewCandidate(client, entitySourceReviewCandidate(), "tester");

    expect(result).toEqual({
      status: "blocked",
      reason: "identifier already belongs to ENT-OTHER-LEI"
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

function entitySourceReviewCandidate(input: { identifiers?: EntitySourceIdentifierSet } = {}) {
  return buildEntitySourceReviewCandidate({
    surface: "ON Semiconductor Corporation",
    candidate: createEntitySourceCandidate({
      source_adapter_id: "gleif",
      source_url: "https://api.gleif.org/api/v1/lei-records?filter%5Bentity.legalName%5D=ON+Semiconductor+Corporation",
      external_id: "ZV20P4CNJVT8V1ZGJ064",
      name: "ON SEMICONDUCTOR CORPORATION",
      jurisdiction_code: "US-DE",
      company_number: "2301314",
      current_status: "ACTIVE",
      previous_names: [],
      alternative_names: [],
      identifiers: input.identifiers ?? {
        lei: "ZV20P4CNJVT8V1ZGJ064",
        gleif_lei: "ZV20P4CNJVT8V1ZGJ064",
        company_number: "2301314",
        jurisdiction_code: "US-DE"
      },
      confidence: 0.86,
      provenance_note: "GLEIF LEI record ZV20P4CNJVT8V1ZGJ064; corroboration=FULLY_CORROBORATED"
    })
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
