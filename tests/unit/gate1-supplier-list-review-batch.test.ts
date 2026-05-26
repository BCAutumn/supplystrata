import { describe, expect, it } from "vitest";
import { createEntitySourceCandidate, type EntitySourceCandidate } from "@supplystrata/entity-source";
import { buildGate1SupplierEntityResolutionBacklog, unsafeGate1EntitySourceReviewReason, unsafeSupplierListReviewReason } from "@supplystrata/pipeline";
import { buildEntitySourceReviewCandidate, buildSupplierListReviewCandidate } from "@supplystrata/review-candidates";
import type { SupplierListCandidate } from "@supplystrata/supplier-list";

describe("Gate 1 supplier-list review batch", () => {
  it("accepts official Apple supplier-list rows with auditable source text", () => {
    const candidate = buildSupplierListReviewCandidate({
      candidate: supplierListCandidate(),
      docId: "DOC-APPLE-SUPPLIERS",
      sourceUrl: "https://www.apple.com.cn/supplier-responsibility/pdf/Apple-Supplier-List.pdf",
      sourceDate: "2022-09-30"
    });

    expect(unsafeSupplierListReviewReason(candidate)).toBeUndefined();
  });

  it("rejects page markers before they can be batch-approved", () => {
    const candidate = buildSupplierListReviewCandidate({
      candidate: {
        ...supplierListCandidate(),
        location_text: "Supplier List",
        country_or_region: "24",
        source_row_text: "Supplier List                                                                                           24",
        normalized_record_text: "Apple | Wistron Corporation | Supplier List | 24"
      },
      docId: "DOC-APPLE-SUPPLIERS",
      sourceUrl: "https://www.apple.com.cn/supplier-responsibility/pdf/Apple-Supplier-List.pdf"
    });

    expect(unsafeSupplierListReviewReason(candidate)).toBe("supplier-list page marker is not facility evidence");
  });

  it("summarizes unresolved supplier entities as the next Gate 1 backlog", () => {
    const backlog = buildGate1SupplierEntityResolutionBacklog([
      unresolvedItem("REV-1", "Amkor Technology Incorporated", "Japan"),
      unresolvedItem("REV-2", "Amkor Technology Incorporated", "South Korea"),
      unresolvedItem("REV-3", "Broadcom Limited", "United States"),
      {
        ...unresolvedItem("REV-4", "Ignored Supplier", "Taiwan"),
        reason: "supplier-list page marker is not facility evidence"
      }
    ]);

    expect(backlog).toEqual([
      {
        supplier_name: "Amkor Technology Incorporated",
        unresolved_candidates: 2,
        countries_or_regions: ["Japan", "South Korea"],
        sample_review_id: "REV-1",
        suggested_next_action: "resolve_supplier_entity"
      },
      {
        supplier_name: "Broadcom Limited",
        unresolved_candidates: 1,
        countries_or_regions: ["United States"],
        sample_review_id: "REV-3",
        suggested_next_action: "resolve_supplier_entity"
      }
    ]);
  });
});

describe("Gate 1 entity-source review batch", () => {
  it("accepts ACTIVE fully corroborated GLEIF candidates when the legal name exactly matches the supplier surface", () => {
    const candidate = buildEntitySourceReviewCandidate({
      surface: "ON Semiconductor Corporation",
      candidate: gleifCandidate({
        name: "ON SEMICONDUCTOR CORPORATION",
        provenanceNote: "GLEIF LEI record ZV20P4CNJVT8V1ZGJ064; corroboration=FULLY_CORROBORATED"
      })
    });

    expect(unsafeGate1EntitySourceReviewReason(candidate)).toBeUndefined();
  });

  it("accepts punctuation-only differences in fully corroborated GLEIF legal names", () => {
    const candidate = buildEntitySourceReviewCandidate({
      surface: "Skyworks Solutions Inc.",
      candidate: gleifCandidate({
        name: "Skyworks Solutions, Inc.",
        provenanceNote: "GLEIF LEI record 5493000L1YP6JSKXYR94; corroboration=FULLY_CORROBORATED"
      })
    });

    expect(unsafeGate1EntitySourceReviewReason(candidate)).toBeUndefined();
  });

  it("accepts controlled legal suffix differences in fully corroborated GLEIF legal names", () => {
    const candidate = buildEntitySourceReviewCandidate({
      surface: "Skyworks Solutions Incorporated",
      candidate: gleifCandidate({
        name: "Skyworks Solutions, Inc.",
        provenanceNote: "GLEIF LEI record 5493000L1YP6JSKXYR94; corroboration=FULLY_CORROBORATED"
      })
    });

    expect(unsafeGate1EntitySourceReviewReason(candidate)).toBeUndefined();
  });

  it("rejects non-GLEIF entity-source candidates before batch approval", () => {
    const candidate = buildEntitySourceReviewCandidate({
      surface: "ON Semiconductor Corporation",
      candidate: {
        ...gleifCandidate({
          name: "ON SEMICONDUCTOR CORPORATION",
          provenanceNote: "OpenCorporates company search result; corroboration=FULLY_CORROBORATED"
        }),
        source_adapter_id: "opencorporates",
        source_url: "https://api.opencorporates.com/v0.4/companies/us_de/2301314",
        external_id: "us_de/2301314"
      }
    });

    expect(unsafeGate1EntitySourceReviewReason(candidate)).toBe("unsupported entity source: opencorporates");
  });

  it("rejects GLEIF candidates whose legal name does not exactly match the unresolved supplier surface", () => {
    const candidate = buildEntitySourceReviewCandidate({
      surface: "ON Semiconductor",
      candidate: gleifCandidate({
        name: "ON SEMICONDUCTOR CORPORATION",
        provenanceNote: "GLEIF LEI record ZV20P4CNJVT8V1ZGJ064; corroboration=FULLY_CORROBORATED"
      })
    });

    expect(unsafeGate1EntitySourceReviewReason(candidate)).toBe(
      "surface does not exactly match normalized GLEIF legal name: ON Semiconductor -> ON SEMICONDUCTOR CORPORATION"
    );
  });

  it("rejects manually malformed GLEIF candidates that would not write to the GLEIF entity namespace", () => {
    const candidate = buildEntitySourceReviewCandidate({
      surface: "ON Semiconductor Corporation",
      candidate: gleifCandidate({
        name: "ON SEMICONDUCTOR CORPORATION",
        provenanceNote: "GLEIF LEI record ZV20P4CNJVT8V1ZGJ064; corroboration=FULLY_CORROBORATED"
      })
    });

    expect(
      unsafeGate1EntitySourceReviewReason({
        ...candidate,
        payload: {
          ...candidate.payload,
          proposed_entity_id: "ENT-OC-ON-SEMICONDUCTOR-CORPORATION-US-DE-2301314"
        }
      })
    ).toBe("GLEIF proposed entity id must use ENT-GLEIF prefix: ENT-OC-ON-SEMICONDUCTOR-CORPORATION-US-DE-2301314");
  });
});

function unresolvedItem(reviewId: string, supplierName: string, countryOrRegion: string) {
  return {
    review_id: reviewId,
    supplier_name: supplierName,
    location_text: "sample",
    country_or_region: countryOrRegion,
    decision: "skipped" as const,
    reason: `supplier does not resolve to a curated entity: ${supplierName}`
  };
}

function supplierListCandidate(): SupplierListCandidate {
  return {
    buyer_entity_id: "ENT-APPLE",
    buyer_name: "Apple",
    supplier_name: "Wistron Corporation",
    location_text: "Karnataka",
    country_or_region: "India",
    source_row_text: "Wistron Corporation Guangdong China mainland",
    normalized_record_text: "Apple | Wistron Corporation | Karnataka | India",
    source_adapter_id: "apple-suppliers",
    source_fiscal_year: 2022,
    source_locator: "Apple Supplier List FY22 line 480",
    confidence: 0.65,
    needs_review: true,
    review_reason: "供应商名单来自 PDF 表格解析，候选边必须人工复核后才能 apply。",
    relation_hint: "BUYS_FROM",
    facility_relation_hint: "MANUFACTURES_AT"
  };
}

function gleifCandidate(input: { name: string; provenanceNote: string }): EntitySourceCandidate {
  return createEntitySourceCandidate({
    source_adapter_id: "gleif",
    source_url: "https://api.gleif.org/api/v1/lei-records?filter%5Bentity.legalName%5D=ON+Semiconductor+Corporation",
    external_id: "ZV20P4CNJVT8V1ZGJ064",
    name: input.name,
    jurisdiction_code: "US-DE",
    company_number: "2301314",
    current_status: "ACTIVE",
    previous_names: [],
    alternative_names: [],
    identifiers: {
      lei: "ZV20P4CNJVT8V1ZGJ064",
      gleif_lei: "ZV20P4CNJVT8V1ZGJ064",
      company_number: "2301314",
      jurisdiction_code: "US-DE"
    },
    confidence: 0.86,
    provenance_note: input.provenanceNote
  });
}
