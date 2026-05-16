import { describe, expect, it } from "vitest";
import { extractFixedWidthSupplierListCandidates } from "@supplystrata/supplier-list";

describe("generic supplier list parser", () => {
  it("extracts fixed-width buyer-supplier-location review candidates", () => {
    const candidates = extractFixedWidthSupplierListCandidates(
      [
        "Supplier List",
        "SUPPLIER NAME                         PRIMARY LOCATIONS WHERE MANUFACTURING OCCURS",
        "Acme Components                       Guangdong, Jiangsu                         China",
        "                                      Penang                                     Malaysia",
        "Beta Manufacturing                    Texas                                      United States"
      ].join("\n"),
      {
        sourceAdapterId: "example-supplier-list",
        buyerEntityId: "ENT-EXAMPLE-BUYER",
        buyerName: "Example Buyer",
        sourceFiscalYear: 2026,
        locatorPrefix: "Example Supplier List FY26",
        confidence: 0.7,
        reviewReason: "表格候选需要人工复核。",
        ignoredExactLines: ["Supplier List"],
        ignoredLinePrefixes: ["SUPPLIER NAME"]
      }
    );

    expect(candidates).toMatchObject([
      {
        buyer_entity_id: "ENT-EXAMPLE-BUYER",
        buyer_name: "Example Buyer",
        supplier_name: "Acme Components",
        location_text: "Guangdong, Jiangsu",
        country_or_region: "China",
        source_row_text: "Acme Components                       Guangdong, Jiangsu                         China",
        normalized_record_text: "Example Buyer | Acme Components | Guangdong, Jiangsu | China",
        source_adapter_id: "example-supplier-list",
        relation_hint: "BUYS_FROM",
        facility_relation_hint: "MANUFACTURES_AT",
        needs_review: true
      },
      {
        supplier_name: "Acme Components",
        location_text: "Penang",
        country_or_region: "Malaysia",
        source_row_text: "Penang                                     Malaysia",
        normalized_record_text: "Example Buyer | Acme Components | Penang | Malaysia"
      },
      {
        supplier_name: "Beta Manufacturing",
        location_text: "Texas",
        country_or_region: "United States"
      }
    ]);
  });
});
