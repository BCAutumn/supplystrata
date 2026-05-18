import { describe, expect, it } from "vitest";
import { listSources, sourceAuthorityFor, sourceStatusSummary } from "@supplystrata/source-registry";

describe("source registry", () => {
  it("tracks the free P0 sources needed by the MVP", () => {
    const ids = new Set(listSources().map((source) => source.id));
    expect(ids.has("sec-edgar")).toBe(true);
    expect(ids.has("tsmc-ir")).toBe(true);
    expect(ids.has("samsung-ir")).toBe(true);
    expect(ids.has("skhynix-ir")).toBe(true);
    expect(ids.has("micron-ir")).toBe(true);
    expect(ids.has("asml-ir")).toBe(true);
    expect(ids.has("apple-suppliers")).toBe(true);
    expect(ids.has("opencorporates")).toBe(true);
    expect(ids.has("companies-house")).toBe(true);
    expect(ids.has("seed-entities")).toBe(true);
    expect(ids.has("dart-kr")).toBe(true);
    expect(ids.has("edinet")).toBe(true);
    expect(ids.has("osh")).toBe(true);
    expect(ids.has("un-comtrade")).toBe(true);
    expect(ids.has("census-trade")).toBe(true);
    expect(ids.has("noaa-ais")).toBe(true);
    expect(ids.has("usgs-mcs")).toBe(true);
  });

  it("summarizes implemented and preview source coverage", () => {
    expect(sourceStatusSummary()).toMatchObject({
      total: 31,
      implemented: 2,
      preview: 9,
      planned: 2,
      scoped: 17,
      manualOnly: 1,
      requiresKey: 9
    });
  });

  it("maps known sources to explicit authority metadata", () => {
    expect(sourceAuthorityFor({ source_adapter_id: "sec-edgar", document_type: "10-K" })).toMatchObject({
      publisher_type: "regulator",
      relation_authority: "self_disclosure",
      max_evidence_level: 5
    });
    expect(sourceAuthorityFor({ source_adapter_id: "tsmc-ir", document_type: "annual_report" })).toMatchObject({
      publisher_type: "company_official",
      relation_authority: "self_disclosure",
      max_evidence_level: 4
    });
    expect(sourceAuthorityFor({ source_adapter_id: "apple-suppliers", document_type: "supplier_list" })).toMatchObject({
      publisher_type: "official_supplier_list",
      relation_authority: "facility_claim",
      max_evidence_level: 4
    });
    expect(sourceAuthorityFor({ source_adapter_id: "import-yeti", document_type: "manual" })).toMatchObject({
      relation_authority: "lead_only",
      max_evidence_level: 3
    });
    expect(sourceAuthorityFor({ source_adapter_id: "un-comtrade", document_type: "manual" })).toMatchObject({
      relation_authority: "macro_trend",
      max_evidence_level: 2
    });
    expect(sourceAuthorityFor({ source_adapter_id: "census-trade", document_type: "trade_dataset" })).toMatchObject({
      relation_authority: "macro_trend",
      max_evidence_level: 2
    });
    expect(sourceAuthorityFor({ source_adapter_id: "osh", document_type: "supplier_list" })).toMatchObject({
      relation_authority: "facility_claim",
      max_evidence_level: 3
    });
    expect(sourceAuthorityFor({ source_adapter_id: "osh", document_type: "facility_dataset" })).toMatchObject({
      relation_authority: "facility_claim",
      max_evidence_level: 3
    });
    expect(sourceAuthorityFor({ source_adapter_id: "manual", document_type: "manual" })).toMatchObject({
      publisher_type: "manual",
      relation_authority: "lead_only",
      max_evidence_level: 2
    });
  });

  it("caps unregistered adapters as manual leads until they are explicitly registered", () => {
    expect(sourceAuthorityFor({ source_adapter_id: "future-sec-adapter", document_type: "10-K" })).toMatchObject({
      publisher_type: "manual",
      relation_authority: "lead_only",
      max_evidence_level: 2
    });
    expect(sourceAuthorityFor({ source_adapter_id: "future-macro-adapter", document_type: "manual" })).toMatchObject({
      publisher_type: "manual",
      relation_authority: "lead_only",
      max_evidence_level: 2
    });
  });
});
