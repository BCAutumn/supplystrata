import { describe, expect, it } from "vitest";
import { appleSupplierListUrl, extractAppleSupplierCandidatesFromText } from "@supplystrata/sources-apple-suppliers";

describe("Apple Supplier List preview", () => {
  it("uses the official FY22 supplier list PDF URL", () => {
    expect(appleSupplierListUrl(2022)).toBe("https://www.apple.com.cn/supplier-responsibility/pdf/Apple-Supplier-List.pdf");
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
});
