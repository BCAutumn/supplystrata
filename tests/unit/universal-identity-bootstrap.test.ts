import type pg from "pg";
import { describe, expect, it } from "vitest";
import { envSchema } from "@supplystrata/config";
import { dbTxClientBrand, type DatabaseStore, type DbClient, type DbTxClient } from "@supplystrata/db/write";
import { createEntitySourceCandidate, type EntitySourceAdapterId, type EntitySourceCandidate } from "@supplystrata/entity-source";
import {
  buildUniversalIdentityLookupQueries,
  ensureResearchCompanyEntity,
  normalizeResearchEntityQuery,
  type EntityLookupInput,
  type EntityLookupSummary,
  type ResearchCompanyEntityBootstrapRuntime
} from "@supplystrata/source-workflows";

interface QueryCall {
  sql: string;
  params: readonly unknown[];
}

class MockTxClient implements DbTxClient {
  readonly [dbTxClientBrand]: true = true;
  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    const rowCount = sql.includes("INSERT INTO entity_alias") ? 1 : 0;
    return queryResult([], rowCount);
  }
}

class MockStore implements DatabaseStore {
  readonly adapter_id = "mock";
  readonly client = new MockTxClient();
  transaction_count = 0;
  readonly read: DbClient = {
    query: async <T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> => {
      this.client.calls.push({ sql, params });
      return queryResult([]);
    }
  };

  async transaction<T>(fn: (client: DbTxClient) => Promise<T>): Promise<T> {
    this.transaction_count += 1;
    return fn(this.client);
  }

  async close(): Promise<void> {}
}

const env = envSchema.parse({});
const now = "2026-05-28T00:00:00.000Z";

describe("universal identity bootstrap", () => {
  it("normalizes global company query variants without ASCII-only assumptions", () => {
    expect(normalizeResearchEntityQuery(" ENT-LVMH-Moët-Hennessy-Louis-Vuitton-SE ")).toBe("LVMH Moët Hennessy Louis Vuitton SE");
    expect(buildUniversalIdentityLookupQueries("969500FP1Q07I98R6P10")).toEqual(["969500FP1Q07I98R6P10"]);
    expect(buildUniversalIdentityLookupQueries("TSM")).toEqual(["TSM"]);
    expect(buildUniversalIdentityLookupQueries(" 阿里巴巴集团控股有限公司 ")).toEqual(["阿里巴巴集团控股有限公司"]);
    expect(buildUniversalIdentityLookupQueries("LVMH Moët Hennessy Louis Vuitton SE")).toEqual(["LVMH Moët Hennessy Louis Vuitton SE"]);
    expect(buildUniversalIdentityLookupQueries("東京エレクトロン株式会社")).toEqual(["東京エレクトロン株式会社"]);
    expect(buildUniversalIdentityLookupQueries("삼성전자")).toEqual(["삼성전자"]);
    expect(buildUniversalIdentityLookupQueries("Skyworks Solutions Incorporated")).toEqual(["Skyworks Solutions Incorporated", "Skyworks Solutions Inc."]);
  });

  it("bootstraps a unique GLEIF identity candidate through the entity-import boundary", async () => {
    const store = new MockStore();
    const result = await ensureResearchCompanyEntity(
      store,
      { query: "LVMH", env, now, reviewer: "test" },
      runtimeWithCandidates({ gleif: [gleifCandidate("969500FP1Q07I98R6P10", "LVMH MOET HENNESSY LOUIS VUITTON SE", "FR")] })
    );

    expect(result).toMatchObject({
      status: "resolved",
      source_adapter_id: "gleif",
      candidate_count: 1
    });
    expect(result.entity_id).toMatch(/^ENT-GLEIF-/);
    expect(store.transaction_count).toBe(1);
    expect(store.client.calls.some((call) => call.sql.includes("INSERT INTO entity_master"))).toBe(true);
    expect(store.client.calls.some((call) => call.sql.includes("INSERT INTO change_records") && call.params.includes("entity_source_bootstrap"))).toBe(true);
  });

  it("returns ambiguous for multiple authoritative candidates and does not write entity_master", async () => {
    const store = new MockStore();
    const result = await ensureResearchCompanyEntity(
      store,
      { query: "Samsung", env, now },
      {
        ...runtimeWithCandidates({
          gleif: [
            gleifCandidate("988400K1R0A5KSIXZL66", "SAMSUNG ELECTRONICS CO., LTD.", "KR"),
            gleifCandidate("549300VDLCNR3S1X5267", "SAMSUNG SDI CO., LTD.", "KR")
          ]
        }),
        disambiguateEntity: async () => ({
          schema_version: "1.0.0",
          generated_at: now,
          helper: "disambiguate_entity",
          status: "candidate",
          confidence: 0.8,
          citations: [],
          rationale: "Ranking is advisory only.",
          provider_request_id: null,
          model: null,
          fact_write_allowed: false,
          ranked_candidates: []
        })
      }
    );

    expect(result).toMatchObject({
      status: "ambiguous",
      candidate_count: 2,
      disambiguation_status: "candidate"
    });
    expect(store.transaction_count).toBe(0);
    expect(store.client.calls.some((call) => call.sql.includes("INSERT INTO entity_master"))).toBe(false);
  });

  it("does not promote a single Wikidata hint as an automatic company identity", async () => {
    const store = new MockStore();
    const result = await ensureResearchCompanyEntity(
      store,
      { query: "AstraZeneca", env, now },
      runtimeWithCandidates({ wikidata: [wikidataCandidate("Q731938", "AstraZeneca")] })
    );

    expect(result).toMatchObject({
      status: "ambiguous",
      candidate_count: 1,
      disambiguation_status: "disabled"
    });
    expect(store.transaction_count).toBe(0);
  });

  it("keeps SEC as the explicit US ticker branch instead of treating it as the only identity source", async () => {
    const store = new MockStore();
    const result = await ensureResearchCompanyEntity(
      store,
      { query: "NVDA", env, now, reviewer: "test" },
      {
        ...runtimeWithCandidates({ openfigi: [openFigiCandidate("BBG000BBJQV0", "NVIDIA CORP", "NVDA")] }),
        lookupSecCompanyDirectory: async () => ({
          query: "NVDA",
          source_url: "https://www.sec.gov/files/company_tickers.json",
          candidates: [
            {
              cik: "0001045810",
              ticker: "NVDA",
              title: "NVIDIA CORP",
              display_name: "NVIDIA",
              entity_id: "ENT-NVIDIA",
              source_url: "https://www.sec.gov/files/company_tickers.json"
            }
          ]
        })
      }
    );

    expect(result).toMatchObject({
      status: "resolved",
      source_adapter_id: "sec-edgar",
      entity_id: "ENT-NVIDIA",
      source_adapter_ids: ["gleif", "openfigi", "wikidata", "sec-edgar"]
    });
    expect(store.transaction_count).toBe(1);
    expect(store.client.calls.some((call) => call.sql.includes("sec_listed_company_bootstrap"))).toBe(true);
  });

  it("returns unresolved when identity sources are reachable but empty", async () => {
    const result = await ensureResearchCompanyEntity(new MockStore(), { query: "No Such Listed Company", env, now }, runtimeWithCandidates({}));

    expect(result).toMatchObject({
      status: "unresolved",
      candidate_count: 0
    });
  });

  it("returns unreachable when every universal identity source fails", async () => {
    const runtime: ResearchCompanyEntityBootstrapRuntime = {
      lookupEntityCandidates: async (input) => ({
        query: input.query,
        results: [
          {
            source_adapter_id: universalSource(input.source),
            candidates: [],
            error_message: `${input.source} unavailable`
          }
        ]
      })
    };
    const result = await ensureResearchCompanyEntity(new MockStore(), { query: "LVMH", env, now }, runtime);

    expect(result).toMatchObject({
      status: "unreachable",
      candidate_count: 0
    });
    expect(result.reason).toContain("gleif unavailable");
    expect(result.reason).toContain("openfigi unavailable");
    expect(result.reason).toContain("wikidata unavailable");
  });
});

function runtimeWithCandidates(input: Partial<Record<EntitySourceAdapterId, EntitySourceCandidate[]>>): ResearchCompanyEntityBootstrapRuntime {
  return {
    lookupEntityCandidates: async (lookupInput: EntityLookupInput): Promise<EntityLookupSummary> => {
      const source = universalSource(lookupInput.source);
      return {
        query: lookupInput.query,
        results: [
          {
            source_adapter_id: source,
            source_url: `fixture://${source}/${lookupInput.query}`,
            candidates: input[source] ?? []
          }
        ]
      };
    }
  };
}

function universalSource(source: EntityLookupInput["source"]): EntitySourceAdapterId {
  if (source === "gleif" || source === "openfigi" || source === "wikidata") return source;
  throw new Error(`Unexpected universal identity source in test: ${source}`);
}

function gleifCandidate(lei: string, name: string, country: string): EntitySourceCandidate {
  return createEntitySourceCandidate({
    source_adapter_id: "gleif",
    source_url: `https://api.gleif.org/api/v1/lei-records/${lei}`,
    external_id: lei,
    name,
    jurisdiction_code: country,
    company_number: lei.slice(0, 8),
    current_status: "ACTIVE",
    company_type: "GENERAL",
    previous_names: [],
    alternative_names: [],
    identifiers: {
      lei,
      gleif_lei: lei,
      jurisdiction_code: country,
      company_number: lei.slice(0, 8)
    },
    confidence: 0.86,
    provenance_note: `GLEIF LEI record ${lei}; corroboration=FULLY_CORROBORATED`
  });
}

function wikidataCandidate(qid: string, name: string): EntitySourceCandidate {
  return createEntitySourceCandidate({
    source_adapter_id: "wikidata",
    source_url: `https://www.wikidata.org/wiki/${qid}`,
    external_id: qid,
    name,
    previous_names: [],
    alternative_names: [],
    identifiers: {
      wikidata_qid: qid
    },
    confidence: 0.58,
    provenance_note: `Wikidata entity ${qid}`
  });
}

function openFigiCandidate(figi: string, name: string, ticker: string): EntitySourceCandidate {
  return createEntitySourceCandidate({
    source_adapter_id: "openfigi",
    source_url: "https://api.openfigi.com/v3/search",
    external_id: figi,
    name,
    previous_names: [],
    alternative_names: [ticker],
    identifiers: {
      figi,
      openfigi_figi: figi,
      ticker,
      exchange_code: "US"
    },
    confidence: 0.68,
    provenance_note: `OpenFIGI instrument ${figi}; ticker=${ticker}; exchange=US`
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
