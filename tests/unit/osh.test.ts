import { describe, expect, it } from "vitest";
import { buildOshFacilitySearchUrl, oshAdapter, parseOshFacilityCandidates } from "@supplystrata/sources-osh";

describe("osh source adapter", () => {
  it("builds facility search URLs with scoped query parameters", () => {
    const url = buildOshFacilitySearchUrl({ query: "semiconductor memory", countryCode: "tw", sector: "Electronics", pageSize: 10 });

    expect(url).toContain("/api/facilities/");
    expect(url).toContain("q=semiconductor+memory");
    expect(url).toContain("countries=TW");
    expect(url).toContain("sector=Electronics");
    expect(url).toContain("pageSize=10");
  });

  it("parses GeoJSON-style OSH facility candidates", () => {
    const payload = new TextEncoder().encode(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            id: "OSH-1",
            geometry: { type: "Point", coordinates: [121.55, 25.03] },
            properties: {
              os_id: "TW2026001ABC",
              name: "Example Memory Facility",
              address: "Hsinchu Science Park",
              country_code: "TW",
              country_name: "Taiwan",
              contributors: [{ name: "Example Contributor" }],
              sector: "Electronics",
              product_type: "Semiconductors"
            }
          }
        ]
      })
    );

    expect(parseOshFacilityCandidates(payload, "https://opensupplyhub.org/api/facilities/?q=memory")).toEqual([
      {
        os_id: "TW2026001ABC",
        name: "Example Memory Facility",
        address: "Hsinchu Science Park",
        country_code: "TW",
        country_name: "Taiwan",
        latitude: 25.03,
        longitude: 121.55,
        contributors: ["Example Contributor"],
        sector: "Electronics",
        product_type: "Semiconductors",
        source_url: "https://opensupplyhub.org/api/facilities/?q=memory"
      }
    ]);
  });

  it("normalizes facility candidates as facility dataset documents", async () => {
    const payload = new TextEncoder().encode(
      JSON.stringify({
        results: [
          {
            os_id: "VN2026002XYZ",
            name: "Example Assembly Facility",
            country_code: "VN",
            contributors: ["Brand A", "Brand A"]
          }
        ]
      })
    );
    const normalized = await oshAdapter.normalize(
      {
        doc_id: "DOC-OSH",
        source_adapter_id: "osh",
        url: "https://opensupplyhub.org/api/facilities/?q=assembly",
        fetched_at: "2026-01-01T00:00:00.000Z",
        bytes_sha256: "sha",
        storage_key: "facility/osh/sha.json",
        body: payload,
        metadata: { document_type: "facility_dataset" }
      },
      { userAgent: "SupplyStrata test@example.com", now: () => new Date("2026-01-01T00:00:00.000Z") }
    );

    expect(normalized.document_type).toBe("facility_dataset");
    expect(normalized.text).toContain("os_id: VN2026002XYZ");
    expect(normalized.text).toContain("contributors: Brand A");
  });
});
