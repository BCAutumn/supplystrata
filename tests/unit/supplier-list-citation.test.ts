import { describe, expect, it } from "vitest";
import { locateSupplierListRowContext } from "@supplystrata/pipeline";
import { buildSupplierListReviewCandidate } from "@supplystrata/review-candidates";

describe("supplier-list citation location", () => {
  it("locates continuation rows by supplier plus row context", () => {
    const candidate = buildSupplierListReviewCandidate({
      docId: "DOC-APPLE-SUPPLIERS",
      sourceUrl: "https://example.test/apple-supplier-list.pdf",
      sourceDate: "2022-09-30",
      candidate: {
        buyer_entity_id: "ENT-APPLE",
        buyer_name: "Apple",
        supplier_name: "Taiwan Semiconductor Manufacturing Company Limited",
        location_text: "Taiwan",
        country_or_region: "Taiwan",
        source_adapter_id: "apple-suppliers",
        source_fiscal_year: 2022,
        source_locator: "Apple Supplier List FY22 line 396",
        source_row_text: "Taiwan Taiwan",
        normalized_record_text: "Apple | Taiwan Semiconductor Manufacturing Company Limited | Taiwan | Taiwan",
        confidence: 0.86,
        needs_review: true,
        review_reason: "Official supplier list row requires review.",
        relation_hint: "BUYS_FROM",
        facility_relation_hint: "MANUFACTURES_AT"
      }
    });

    const location = locateSupplierListRowContext(
      [
        { chunk_id: "DOC-APPLE-SUPPLIERS-CHK-0001", text: "Other Supplier Taiwan Taiwan" },
        {
          chunk_id: "DOC-APPLE-SUPPLIERS-CHK-0002",
          text: ["Taiwan Semiconductor Manufacturing Company Limited Shanghai China mainland", "Taiwan Taiwan", "Washington United States"].join("\n")
        }
      ],
      candidate
    );

    expect(location).toEqual({ status: "located", chunk_id: "DOC-APPLE-SUPPLIERS-CHK-0002", occurrence_count: 1 });
  });

  it("rejects row context that appears under multiple chunks", () => {
    const candidate = buildSupplierListReviewCandidate({
      docId: "DOC-APPLE-SUPPLIERS",
      sourceUrl: "https://example.test/apple-supplier-list.pdf",
      candidate: {
        buyer_entity_id: "ENT-APPLE",
        buyer_name: "Apple",
        supplier_name: "Example Supplier",
        location_text: "Texas",
        country_or_region: "United States",
        source_adapter_id: "apple-suppliers",
        source_fiscal_year: 2022,
        source_locator: "Apple Supplier List FY22 line 10",
        source_row_text: "Texas United States",
        normalized_record_text: "Apple | Example Supplier | Texas | United States",
        confidence: 0.86,
        needs_review: true,
        review_reason: "Official supplier list row requires review.",
        relation_hint: "BUYS_FROM",
        facility_relation_hint: "MANUFACTURES_AT"
      }
    });

    const location = locateSupplierListRowContext(
      [
        { chunk_id: "DOC-APPLE-SUPPLIERS-CHK-0001", text: "Example Supplier Texas United States" },
        { chunk_id: "DOC-APPLE-SUPPLIERS-CHK-0002", text: "Example Supplier Texas United States" }
      ],
      candidate
    );

    expect(location).toMatchObject({ status: "ambiguous", occurrence_count: 2 });
  });
});
