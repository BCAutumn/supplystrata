import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import type { RawDocument } from "@supplystrata/core";
import { buildCompaniesHouseSearchUrl, extractCompaniesHouseCandidates } from "@supplystrata/sources-companies-house";
import { buildOpenCorporatesSearchUrl, extractOpenCorporatesCandidates } from "@supplystrata/sources-opencorporates";

describe("entity source adapters", () => {
  it("builds OpenCorporates search URLs and normalizes company candidates", () => {
    expect(buildOpenCorporatesSearchUrl({ query: "Arm Holdings", jurisdictionCode: "gb", limit: 2 })).toBe(
      "https://api.opencorporates.com/v0.4/companies/search?q=Arm+Holdings&per_page=2&jurisdiction_code=gb"
    );

    const candidates = extractOpenCorporatesCandidates(rawJson("opencorporates", {
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
    }));

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

    const candidates = extractCompaniesHouseCandidates(rawJson("companies-house", {
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
    }));

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

function rawJson(sourceAdapterId: "opencorporates" | "companies-house", value: unknown): RawDocument<Uint8Array> {
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
