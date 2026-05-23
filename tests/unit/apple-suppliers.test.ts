import { describe, expect, it } from "vitest";
import { buildAppleOshCrossCheckLead, buildAppleOshSourceCheckTarget } from "@supplystrata/source-workflows";
import { appleSupplierListUrl, extractAppleSupplierCandidatesFromText, validateAppleSuppliersInput } from "@supplystrata/sources-apple-suppliers";

describe("Apple Supplier List preview", () => {
  it("uses the official FY22 supplier list PDF URL", () => {
    expect(appleSupplierListUrl(2022)).toBe("https://www.apple.com.cn/supplier-responsibility/pdf/Apple-Supplier-List.pdf");
  });

  it("keeps Apple source limits in the adapter instead of CLI defaults", () => {
    expect(() => validateAppleSuppliersInput({ fiscalYear: 2023, entityId: "ENT-APPLE" })).toThrow(/Unsupported Apple Supplier List fiscal year: 2023/);
    expect(() => validateAppleSuppliersInput({ fiscalYear: 2022, entityId: "ENT-NVIDIA" })).toThrow(/entity_id must be ENT-APPLE/);
  });

  it("extracts supplier-location candidate rows from pdftotext layout output", () => {
    const candidates = extractAppleSupplierCandidatesFromText(
      [
        "Supplier List",
        "SUPPLIER NAME                                                     PRIMARY LOCATIONS WHERE MANUFACTURING FOR APPLE OCCURS",
        "3M                                                                Guangdong, Jiangsu, Shanghai                                         China mainland",
        "                                                                  Miyazaki, Yamagata                                                   Japan",
        "Advanced Semiconductor Engineering Technology Holding Co., Ltd.   Jiangsu, Shanghai                                                    China mainland",
        "                                                                  Taiwan                                                               Taiwan"
      ].join("\n"),
      2022
    );

    expect(candidates).toMatchObject([
      {
        buyer_entity_id: "ENT-APPLE",
        buyer_name: "Apple",
        supplier_name: "3M",
        location_text: "Guangdong, Jiangsu, Shanghai",
        country_or_region: "China mainland",
        normalized_record_text: "Apple | 3M | Guangdong, Jiangsu, Shanghai | China mainland",
        needs_review: true
      },
      {
        buyer_entity_id: "ENT-APPLE",
        buyer_name: "Apple",
        supplier_name: "3M",
        location_text: "Miyazaki, Yamagata",
        country_or_region: "Japan",
        needs_review: true
      },
      {
        buyer_entity_id: "ENT-APPLE",
        buyer_name: "Apple",
        supplier_name: "Advanced Semiconductor Engineering Technology Holding Co., Ltd.",
        location_text: "Jiangsu, Shanghai",
        country_or_region: "China mainland",
        needs_review: true
      },
      {
        buyer_entity_id: "ENT-APPLE",
        buyer_name: "Apple",
        supplier_name: "Advanced Semiconductor Engineering Technology Holding Co., Ltd.",
        location_text: "Taiwan",
        country_or_region: "Taiwan",
        needs_review: true
      }
    ]);
  });

  it("builds OSH cross-check leads without promoting facility candidates to fact edges", () => {
    const [candidate] = extractAppleSupplierCandidatesFromText(
      [
        "Supplier List",
        "SUPPLIER NAME                                                     PRIMARY LOCATIONS WHERE MANUFACTURING FOR APPLE OCCURS",
        "3M                                                                Guangdong, Jiangsu, Shanghai                                         China mainland"
      ].join("\n"),
      2022
    );
    if (candidate === undefined) throw new Error("expected Apple supplier candidate");

    const lead = buildAppleOshCrossCheckLead(candidate, {
      docId: "DOC-APPLE-SUPPLIERS",
      sourceUrl: "https://www.apple.com.cn/supplier-responsibility/pdf/Apple-Supplier-List.pdf",
      sourceDate: "2022-09-30"
    });

    expect(lead).toMatchObject({
      lead_type: "UNVERIFIED_FACILITY_SIGNAL",
      source_adapter_id: "apple-suppliers",
      doc_id: "DOC-APPLE-SUPPLIERS",
      scope_kind: "company",
      scope_id: "ENT-APPLE",
      cite_text:
        "3M                                                                Guangdong, Jiangsu, Shanghai                                         China mainland"
    });
    expect(lead.summary).toContain("do not promote OSH matches to fact edges without review");
    expect(lead.attrs).toMatchObject({
      semantic_layer: "lead",
      cross_check_source_adapter_id: "osh",
      cross_check_target_kind: "facility-search",
      source_date: "2022-09-30",
      supplier_name: "3M",
      location_text: "Guangdong, Jiangsu, Shanghai",
      country_or_region: "China mainland",
      no_company_edge: true,
      suggested_target_config: {
        query: "3M",
        scope_id: "ENT-APPLE",
        source_location_text: "Guangdong, Jiangsu, Shanghai",
        source_country_or_region: "China mainland"
      }
    });

    const target = buildAppleOshSourceCheckTarget(candidate, { leadId: "LEAD-APPLE-OSH", sourceDate: "2022-09-30" });
    expect(target).toMatchObject({
      check_target_id: "osh:apple-supplier:LEAD-APPLE-OSH",
      source_adapter_id: "osh",
      target_kind: "facility-search",
      enabled: true,
      subject_entity_id: "ENT-APPLE",
      target_config: {
        query: "3M",
        scope_id: "ENT-APPLE",
        lead_id: "LEAD-APPLE-OSH",
        source_location_text: "Guangdong, Jiangsu, Shanghai",
        source_country_or_region: "China mainland",
        page_size: 10
      }
    });
  });
});
