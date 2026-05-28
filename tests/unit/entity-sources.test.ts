import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import type { RawDocument } from "@supplystrata/core";
import { buildEntityResolutionLookupQueries, normalizeEntityResolutionQueries } from "@supplystrata/source-workflows";
import { buildGleifLeiSearchUrl, extractGleifLeiCandidates } from "@supplystrata/sources-gleif";
import { findSecCompanyDirectoryCandidates, normalizeCompanyDirectoryQuery, parseSecCompanyDirectoryPayload } from "@supplystrata/sources-sec-edgar";
import { buildCompaniesHouseSearchUrl, extractCompaniesHouseCandidates } from "@supplystrata/sources-companies-house";
import { buildOpenFigiSearchBody, buildOpenFigiSearchUrl, extractOpenFigiCandidates } from "@supplystrata/sources-openfigi";
import { buildOpenCorporatesSearchUrl, extractOpenCorporatesCandidates } from "@supplystrata/sources-opencorporates";
import {
  buildWikidataCompanySearchSparql,
  buildWikidataEntityDataUrl,
  buildWikidataSparqlSearchUrl,
  extractWikidataCandidates,
  extractWikidataEntityDataProfile
} from "@supplystrata/sources-wikidata";

describe("entity source adapters", () => {
  it("normalizes entity resolution backlog queries before enqueueing review candidates", () => {
    expect(normalizeEntityResolutionQueries([" Amkor  Technology Incorporated ", "amkor technology incorporated", "", "NXP Semiconductors N.V."])).toEqual([
      "Amkor Technology Incorporated",
      "NXP Semiconductors N.V."
    ]);
  });

  it("adds controlled legal suffix lookup variants without dropping the original supplier surface", () => {
    expect(buildEntityResolutionLookupQueries("Skyworks Solutions Incorporated")).toEqual(["Skyworks Solutions Incorporated", "Skyworks Solutions Inc."]);
    expect(buildEntityResolutionLookupQueries("Alps Alpine Company Limited")).toEqual(["Alps Alpine Company Limited", "Alps Alpine Co., Ltd."]);
  });

  it("normalizes SEC listed-company directory records for research bootstrap", () => {
    const records = parseSecCompanyDirectoryPayload({
      "0": { cik_str: 1318605, ticker: "TSLA", title: "Tesla, Inc." },
      "1": { cik_str: 1045810, ticker: "NVDA", title: "NVIDIA CORP" }
    });

    expect(records.find((record) => record.ticker === "TSLA")).toMatchObject({
      cik: "0001318605",
      title: "Tesla, Inc.",
      display_name: "Tesla",
      entity_id: "ENT-TESLA"
    });
    expect(normalizeCompanyDirectoryQuery("ENT-TESLA")).toBe("TESLA");
    expect(findSecCompanyDirectoryCandidates(records, { query: "ENT-TESLA" })).toMatchObject([{ ticker: "TSLA" }]);
    expect(findSecCompanyDirectoryCandidates(records, { query: "TSLA" })).toMatchObject([{ entity_id: "ENT-TESLA" }]);
  });

  it("builds GLEIF LEI search URLs and normalizes global legal entity identifiers", () => {
    expect(buildGleifLeiSearchUrl({ query: "NVIDIA Corporation", limit: 2 })).toBe(
      "https://api.gleif.org/api/v1/lei-records?filter%5Bentity.legalName%5D=NVIDIA+Corporation&page%5Bsize%5D=2"
    );

    const candidates = extractGleifLeiCandidates(
      rawJson("gleif", {
        data: [
          {
            type: "lei-records",
            id: "549300S4KLFTLO7GSQ80",
            attributes: {
              lei: "549300S4KLFTLO7GSQ80",
              entity: {
                legalName: { name: "NVIDIA CORPORATION", language: "en" },
                otherNames: [{ name: "NVIDIA Corp." }],
                transliteratedOtherNames: [],
                legalAddress: {
                  addressLines: ["C/O CORPORATION SERVICE COMPANY", "251 LITTLE FALLS DRIVE"],
                  city: "WILMINGTON",
                  region: "US-DE",
                  country: "US",
                  postalCode: "19808"
                },
                headquartersAddress: {
                  addressLines: ["2788 SAN TOMAS EXPRESSWAY"],
                  city: "SANTA CLARA",
                  region: "US-CA",
                  country: "US",
                  postalCode: "95051"
                },
                registeredAt: { id: "RA000602" },
                registeredAs: "2862596",
                jurisdiction: "US-DE",
                category: "GENERAL",
                status: "ACTIVE",
                creationDate: "1998-02-24T00:00:00Z"
              },
              registration: {
                status: "ISSUED",
                nextRenewalDate: "2027-02-06T17:45:00Z",
                corroborationLevel: "FULLY_CORROBORATED"
              },
              bic: ["NVDAUS6SXXX"],
              ocid: "us_de/2862596",
              spglobal: ["32307"]
            },
            links: { self: "https://api.gleif.org/api/v1/lei-records/549300S4KLFTLO7GSQ80" }
          }
        ]
      })
    );

    expect(candidates).toMatchObject([
      {
        source_adapter_id: "gleif",
        external_id: "549300S4KLFTLO7GSQ80",
        name: "NVIDIA CORPORATION",
        jurisdiction_code: "US-DE",
        company_number: "2862596",
        current_status: "ACTIVE",
        company_type: "GENERAL",
        incorporation_date: "1998-02-24",
        registered_address: "C/O CORPORATION SERVICE COMPANY, 251 LITTLE FALLS DRIVE, WILMINGTON, US-DE, 19808, US",
        alternative_names: ["NVIDIA Corp."],
        identifiers: {
          lei: "549300S4KLFTLO7GSQ80",
          gleif_lei: "549300S4KLFTLO7GSQ80",
          bic: "NVDAUS6SXXX",
          spglobal_id: "32307",
          open_corporates_id: "us_de/2862596",
          registration_authority_id: "RA000602",
          registration_authority_entity_id: "2862596",
          jurisdiction_code: "US-DE",
          company_number: "2862596"
        }
      }
    ]);
    expect(candidates[0]?.provenance_note).toContain("registration=ISSUED");
    expect(candidates[0]?.provenance_note).toContain("corroboration=FULLY_CORROBORATED");
  });

  it("builds OpenCorporates search URLs and normalizes company candidates", () => {
    expect(buildOpenCorporatesSearchUrl({ query: "Arm Holdings", jurisdictionCode: "gb", limit: 2 })).toBe(
      "https://api.opencorporates.com/v0.4/companies/search?q=Arm+Holdings&per_page=2&jurisdiction_code=gb"
    );

    const candidates = extractOpenCorporatesCandidates(
      rawJson("opencorporates", {
        results: {
          companies: [
            {
              company: {
                name: "ARM HOLDINGS PLC",
                company_number: "02557590",
                jurisdiction_code: "gb",
                current_status: "Active",
                company_type: "Public Limited Company",
                incorporation_date: "1990-11-12",
                registered_address: "110 Fulbourn Road, Cambridge",
                opencorporates_url: "https://opencorporates.com/companies/gb/02557590",
                previous_names: [{ company_name: "ADVANCED RISC MACHINES LIMITED" }],
                alternative_names: ["Arm Holdings"]
              }
            }
          ]
        }
      })
    );

    expect(candidates).toMatchObject([
      {
        source_adapter_id: "opencorporates",
        external_id: "gb/02557590",
        name: "ARM HOLDINGS PLC",
        jurisdiction_code: "gb",
        company_number: "02557590",
        previous_names: ["ADVANCED RISC MACHINES LIMITED"],
        alternative_names: ["Arm Holdings"],
        identifiers: {
          open_corporates_id: "gb/02557590",
          company_number: "02557590",
          jurisdiction_code: "gb"
        }
      }
    ]);
  });

  it("builds OpenFIGI search requests and normalizes listed security candidates", () => {
    expect(buildOpenFigiSearchUrl()).toBe("https://api.openfigi.com/v3/search");
    expect(buildOpenFigiSearchBody({ query: " Taiwan Semiconductor Manufacturing Company ", exchangeCode: "tw" })).toEqual({
      query: "Taiwan Semiconductor Manufacturing Company",
      exchCode: "TW"
    });

    const candidates = extractOpenFigiCandidates(
      rawJson("openfigi", {
        data: [
          {
            figi: "BBG000BD8ZK0",
            compositeFIGI: "BBG000BD8ZK0",
            shareClassFIGI: "BBG001S5N8V8",
            ticker: "TSM",
            exchCode: "US",
            name: "TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD",
            marketSector: "Equity",
            securityType: "Common Stock",
            securityType2: "Common Stock",
            securityDescription: "TSM US"
          }
        ]
      })
    );

    expect(candidates).toMatchObject([
      {
        source_adapter_id: "openfigi",
        external_id: "BBG000BD8ZK0",
        name: "TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD",
        company_type: "Common Stock",
        identifiers: {
          figi: "BBG000BD8ZK0",
          openfigi_figi: "BBG000BD8ZK0",
          openfigi_composite_figi: "BBG000BD8ZK0",
          openfigi_share_class_figi: "BBG001S5N8V8",
          ticker: "TSM",
          exchange_code: "US"
        },
        alternative_names: ["TSM US", "TSM"]
      }
    ]);
    expect(candidates[0]?.provenance_note).toContain("ticker=TSM");
  });

  it("returns no OpenFIGI candidates for empty result payloads", () => {
    expect(extractOpenFigiCandidates(rawJson("openfigi", {}))).toEqual([]);
    expect(extractOpenFigiCandidates(rawJson("openfigi", { data: [] }))).toEqual([]);
  });

  it("builds Wikidata SPARQL requests and normalizes collaborative identity candidates", () => {
    const sparql = buildWikidataCompanySearchSparql({ query: "LVMH", limit: 3 });
    expect(sparql).toContain('mwapi:search "LVMH"');
    expect(sparql).toContain("wdt:P1278 ?lei");
    expect(buildWikidataSparqlSearchUrl({ query: "LVMH", limit: 3 })).toContain("https://query.wikidata.org/sparql?query=");

    const candidates = extractWikidataCandidates(
      rawJson("wikidata", {
        results: {
          bindings: [
            wikidataBinding({
              item: "http://www.wikidata.org/entity/Q504998",
              itemLabel: "LVMH",
              itemDescription: "French multinational luxury goods conglomerate",
              officialWebsite: "https://www.lvmh.com/",
              lei: "969500FP1Q07I98R6P10",
              isin: "FR0000121014",
              ticker: "MC",
              countryLabel: "France",
              industryLabel: "luxury goods"
            }),
            wikidataBinding({
              item: "http://www.wikidata.org/entity/Q504998",
              itemLabel: "LVMH",
              cik: "824046",
              industryLabel: "fashion"
            })
          ]
        }
      })
    );

    expect(candidates).toMatchObject([
      {
        source_adapter_id: "wikidata",
        external_id: "Q504998",
        name: "LVMH",
        company_type: "luxury goods",
        identifiers: {
          wikidata_qid: "Q504998",
          lei: "969500FP1Q07I98R6P10",
          gleif_lei: "969500FP1Q07I98R6P10",
          isin: "FR0000121014",
          cik: "824046",
          ticker: "MC",
          official_website: "https://www.lvmh.com/"
        },
        alternative_names: ["French multinational luxury goods conglomerate", "https://www.lvmh.com/", "France", "luxury goods", "fashion"]
      }
    ]);
    expect(candidates[0]?.provenance_note).toContain("Wikidata collaborative entity Q504998");
  });

  it("extracts Wikidata EntityData profiles for profile hints and cross-identifiers", () => {
    expect(buildWikidataEntityDataUrl("q504998")).toBe("https://www.wikidata.org/wiki/Special:EntityData/Q504998.json");

    const profile = extractWikidataEntityDataProfile(
      rawJson("wikidata", {
        entities: {
          Q504998: {
            labels: { en: { language: "en", value: "LVMH" } },
            descriptions: { en: { language: "en", value: "French luxury goods conglomerate" } },
            aliases: { en: [{ language: "en", value: "Moet Hennessy Louis Vuitton" }] },
            claims: {
              P856: [wikidataStringClaim("https://www.lvmh.com/")],
              P1278: [wikidataStringClaim("969500FP1Q07I98R6P10")],
              P946: [wikidataStringClaim("FR0000121014")],
              P5531: [wikidataStringClaim("824046")],
              P249: [wikidataStringClaim("MC")],
              P452: [wikidataEntityClaim("Q219577")],
              P17: [wikidataEntityClaim("Q142")]
            }
          }
        }
      })
    );

    expect(profile).toEqual({
      qid: "Q504998",
      label: "LVMH",
      description: "French luxury goods conglomerate",
      aliases: ["Moet Hennessy Louis Vuitton"],
      official_websites: ["https://www.lvmh.com/"],
      identifiers: {
        wikidata_qid: "Q504998",
        lei: "969500FP1Q07I98R6P10",
        isin: "FR0000121014",
        cik: "824046",
        ticker: "MC"
      },
      industry_qids: ["Q219577"],
      country_qids: ["Q142"]
    });
  });

  it("rejects malformed GLEIF, OpenFIGI, and Wikidata payloads instead of guessing", () => {
    expect(() => extractGleifLeiCandidates(rawJson("gleif", { data: [{ attributes: {} }] }))).toThrow("GLEIF");
    expect(() => extractOpenFigiCandidates(rawJson("openfigi", { data: [{ ticker: "LVMH" }] }))).toThrow("OpenFIGI");
    expect(() => extractWikidataCandidates(rawJson("wikidata", { results: { bindings: [{ itemLabel: { type: "literal", value: "LVMH" } }] } }))).toThrow(
      "Wikidata"
    );
  });

  it("builds Companies House search URLs and normalizes company candidates", () => {
    expect(buildCompaniesHouseSearchUrl({ query: "ARM HOLDINGS", limit: 1 })).toBe(
      "https://api.company-information.service.gov.uk/search/companies?q=ARM+HOLDINGS&items_per_page=1"
    );

    const candidates = extractCompaniesHouseCandidates(
      rawJson("companies-house", {
        items: [
          {
            title: "ARM HOLDINGS PLC",
            company_number: "02557590",
            company_status: "active",
            company_type: "plc",
            date_of_creation: "1990-11-12",
            address_snippet: "110 Fulbourn Road, Cambridge",
            links: { self: "/company/02557590" }
          }
        ]
      })
    );

    expect(candidates).toMatchObject([
      {
        source_adapter_id: "companies-house",
        external_id: "02557590",
        name: "ARM HOLDINGS PLC",
        jurisdiction_code: "gb",
        company_number: "02557590",
        identifiers: {
          companies_house_number: "02557590",
          company_number: "02557590",
          jurisdiction_code: "gb"
        }
      }
    ]);
  });
});

function rawJson(sourceAdapterId: "gleif" | "openfigi" | "wikidata" | "opencorporates" | "companies-house", value: unknown): RawDocument<Uint8Array> {
  const bytes = new Uint8Array(Buffer.from(JSON.stringify(value), "utf8"));
  return {
    doc_id: "DOC-test",
    source_adapter_id: sourceAdapterId,
    url: "https://example.test/search",
    fetched_at: "2026-05-16T00:00:00.000Z",
    bytes_sha256: "fixture",
    storage_key: "fixture.json",
    body: bytes,
    metadata: {}
  };
}

function wikidataBinding(values: Record<string, string>): Record<string, { type: string; value: string }> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { type: key === "item" ? "uri" : "literal", value }]));
}

function wikidataStringClaim(value: string): Record<string, unknown> {
  return {
    mainsnak: {
      datavalue: { value }
    }
  };
}

function wikidataEntityClaim(qid: string): Record<string, unknown> {
  return {
    mainsnak: {
      datavalue: {
        value: {
          "entity-type": "item",
          "numeric-id": Number.parseInt(qid.slice(1), 10)
        }
      }
    }
  };
}
