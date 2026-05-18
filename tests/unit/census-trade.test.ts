import { describe, expect, it } from "vitest";
import { buildCensusTradeUrl, censusFetchUrl, censusTradeAdapter, parseCensusTradeRows, type CensusTradeInput } from "@supplystrata/sources-census-trade";

describe("census-trade source adapter", () => {
  it("builds a public API URL without leaking the API key into provenance", () => {
    const input: CensusTradeInput = {
      direction: "imports",
      time: "2025-12",
      commodityCode: "854232",
      countryCode: "5800"
    };

    const publicUrl = buildCensusTradeUrl(input);
    const fetchUrl = censusFetchUrl(publicUrl, "test-key");

    expect(publicUrl).toContain("/timeseries/intltrade/imports/hs");
    expect(publicUrl).toContain("I_COMMODITY=854232");
    expect(publicUrl).toContain("CTY_CODE=5800");
    expect(publicUrl).not.toContain("test-key");
    expect(fetchUrl).toContain("key=test-key");
  });

  it("parses Census table JSON into observation-ready trade rows", () => {
    const payload = new TextEncoder().encode(
      JSON.stringify([
        ["time", "I_COMMODITY", "I_COMMODITY_LDESC", "CTY_CODE", "CTY_NAME", "GEN_VAL_MO"],
        ["2025-12", "854232", "Memories", "5800", "Taiwan", "123456789"]
      ])
    );

    expect(parseCensusTradeRows(payload, "imports")).toEqual([
      {
        direction: "imports",
        time: "2025-12",
        commodity_code: "854232",
        commodity_description: "Memories",
        country_code: "5800",
        country_name: "Taiwan",
        value_usd: "123456789",
        metric_name: "GEN_VAL_MO"
      }
    ]);
  });

  it("normalizes fetched JSON as a trade dataset document", async () => {
    const payload = new TextEncoder().encode(
      JSON.stringify([
        ["time", "E_COMMODITY", "E_COMMODITY_LDESC", "CTY_CODE", "CTY_NAME", "ALL_VAL_MO"],
        ["2025-12", "854231", "Processors and controllers", "5700", "Korea, South", "987654321"]
      ])
    );
    const normalized = await censusTradeAdapter.normalize(
      {
        doc_id: "DOC-CENSUS",
        source_adapter_id: "census-trade",
        url: "https://api.census.gov/data/timeseries/intltrade/exports/hs?get=time%2CE_COMMODITY%2CE_COMMODITY_LDESC%2CCTY_CODE%2CCTY_NAME%2CALL_VAL_MO&time=2025-12&E_COMMODITY=854231",
        fetched_at: "2026-01-01T00:00:00.000Z",
        bytes_sha256: "sha",
        storage_key: "trade/census/exports/hs/2025-12/sha.json",
        body: payload,
        metadata: { document_type: "trade_dataset", direction: "exports", source_date: "2025-12-31" }
      },
      { userAgent: "SupplyStrata test@example.com", now: () => new Date("2026-01-01T00:00:00.000Z") }
    );

    expect(normalized.document_type).toBe("trade_dataset");
    expect(normalized.text).toContain("direction: exports");
    expect(normalized.text).toContain("value_usd: 987654321");
    expect(normalized.source_date).toBe("2025-12-31");
  });
});
