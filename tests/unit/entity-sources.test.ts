import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import type { RawDocument } from "@supplystrata/core";
import {
  buildEntityResolutionLookupQueries,
  buildGleifLeiSearchUrl,
  extractGleifLeiCandidates,
  normalizeEntityResolutionQueries
} from "@supplystrata/source-workflows";
import { buildCompaniesHouseSearchUrl, extractCompaniesHouseCandidates } from "@supplystrata/sources-companies-house";
import { buildOpenCorporatesSearchUrl, extractOpenCorporatesCandidates } from "@supplystrata/sources-opencorporates";

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

function rawJson(sourceAdapterId: "gleif" | "opencorporates" | "companies-house", value: unknown): RawDocument<Uint8Array> {
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
