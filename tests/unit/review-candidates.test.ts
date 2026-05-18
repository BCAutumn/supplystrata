import { describe, expect, it } from "vitest";
import {
  buildEntitySourceReviewCandidate,
  buildSemanticChangeReviewCandidate,
  buildSupplierListReviewCandidate,
  supplierListFacilityDisplayName,
  supplierListFacilityEntityId,
  supplierListReviewToFacilityRelation,
  supplierListReviewToSupplierRelation
} from "@supplystrata/review-candidates";
import { createEntitySourceCandidate } from "@supplystrata/entity-source";
import type { SupplierListCandidate } from "@supplystrata/supplier-list";

describe("review candidates", () => {
  it("converts supplier-list rows into generic review candidates", () => {
    const source: SupplierListCandidate = {
      buyer_entity_id: "ENT-BUYER",
      buyer_name: "Buyer",
      supplier_name: "Supplier Co.",
      location_text: "Penang",
      country_or_region: "Malaysia",
      source_row_text: "Supplier Co.                         Penang                                     Malaysia",
      normalized_record_text: "Buyer | Supplier Co. | Penang | Malaysia",
      source_adapter_id: "example-supplier-list",
      source_fiscal_year: 2026,
      source_locator: "Example Supplier List FY26 line 1",
      confidence: 0.7,
      needs_review: true,
      review_reason: "表格候选需要人工复核。",
      relation_hint: "BUYS_FROM",
      facility_relation_hint: "MANUFACTURES_AT"
    };

    const candidate = buildSupplierListReviewCandidate({
      candidate: source,
      docId: "DOC-example",
      sourceUrl: "https://example.com/suppliers.pdf",
      sourceDate: "2026-09-30"
    });

    expect(candidate).toMatchObject({
      kind: "supplier_list_row",
      title: "Buyer -> Supplier Co.",
      candidate_key:
        "example-supplier-list|https://example.com/suppliers.pdf|ENT-BUYER|Supplier Co.|Penang|Malaysia|Example Supplier List FY26 line 1|Supplier Co.                         Penang                                     Malaysia",
      payload: {
        buyer_entity_id: "ENT-BUYER",
        supplier_name: "Supplier Co.",
        relation_hint: "BUYS_FROM",
        facility_relation_hint: "MANUFACTURES_AT"
      },
      evidence: {
        doc_id: "DOC-example",
        source_adapter_id: "example-supplier-list",
        source_row_text: "Supplier Co.                         Penang                                     Malaysia",
        normalized_record_text: "Buyer | Supplier Co. | Penang | Malaysia"
      }
    });
    expect(candidate.review_id).toContain("REV-SUPPLIER");
    expect(supplierListReviewToSupplierRelation(candidate)).toMatchObject({
      relation: "BUYS_FROM",
      subject_resolve: { surface: "Buyer" },
      object_resolve: { surface: "Supplier Co." },
      extractor_id: "review.supplier-list-row"
    });
  });

  it("creates stable facility ids and facility relations from supplier-list reviews", () => {
    const source: SupplierListCandidate = {
      buyer_entity_id: "ENT-APPLE",
      buyer_name: "Apple",
      supplier_name: "Supplier Co.",
      location_text: "Penang",
      country_or_region: "Malaysia",
      source_row_text: "Supplier Co.                         Penang                                     Malaysia",
      normalized_record_text: "Apple | Supplier Co. | Penang | Malaysia",
      source_adapter_id: "apple-suppliers",
      source_fiscal_year: 2022,
      source_locator: "Apple Supplier List FY2022 line 99",
      confidence: 0.82,
      needs_review: true,
      review_reason: "表格候选需要人工复核。",
      relation_hint: "BUYS_FROM",
      facility_relation_hint: "MANUFACTURES_AT"
    };
    const candidate = buildSupplierListReviewCandidate({
      candidate: source,
      docId: "DOC-apple",
      sourceUrl: "https://www.apple.com/supplier-responsibility/pdf/Apple-Supplier-List.pdf"
    });

    const displayName = supplierListFacilityDisplayName(candidate);
    const relation = supplierListReviewToFacilityRelation(candidate, displayName);

    expect(displayName).toBe("Supplier Co. facility: Penang, Malaysia");
    expect(supplierListFacilityEntityId(candidate)).toMatch(/^ENT-FAC-[A-F0-9]{16}$/);
    expect(supplierListFacilityEntityId(candidate)).toBe(supplierListFacilityEntityId(candidate));
    expect(relation).toMatchObject({
      relation: "MANUFACTURES_AT",
      subject_resolve: { surface: "Supplier Co." },
      object_resolve: { surface: "Supplier Co. facility: Penang, Malaysia" },
      cite_text: "Supplier Co.                         Penang                                     Malaysia",
      cite_locator: "Apple Supplier List FY2022 line 99",
      extractor_id: "review.supplier-list-facility-row",
      raw_evidence_level_hint: 4
    });
  });

  it("keeps review ids stable without colliding on nearby rows", () => {
    const base: SupplierListCandidate = {
      buyer_entity_id: "ENT-BUYER",
      buyer_name: "Buyer",
      supplier_name: "Very Long Supplier Name That Would Otherwise Collide When Truncated",
      location_text: "Guangdong, Jiangsu, Shanghai",
      country_or_region: "China mainland",
      source_row_text: "row",
      normalized_record_text: "record",
      source_adapter_id: "example-supplier-list",
      source_fiscal_year: 2026,
      source_locator: "line 1",
      confidence: 0.7,
      needs_review: true,
      review_reason: "review",
      relation_hint: "BUYS_FROM",
      facility_relation_hint: "MANUFACTURES_AT"
    };
    const first = buildSupplierListReviewCandidate({ candidate: base, docId: "DOC-example", sourceUrl: "https://example.com/a.pdf" });
    const second = buildSupplierListReviewCandidate({
      candidate: { ...base, location_text: "Guangdong, Jiangsu, Shenzhen", source_locator: "line 2" },
      docId: "DOC-example",
      sourceUrl: "https://example.com/a.pdf"
    });

    expect(first.review_id).not.toBe(second.review_id);
    expect(first.candidate_key).not.toBe(second.candidate_key);
    expect(first.review_id).toBe(buildSupplierListReviewCandidate({ candidate: base, docId: "DOC-example", sourceUrl: "https://example.com/a.pdf" }).review_id);
    expect(first.candidate_key).toBe(
      buildSupplierListReviewCandidate({ candidate: base, docId: "DOC-other", sourceUrl: "https://example.com/a.pdf" }).candidate_key
    );
  });

  it("converts external entity source hits into review/import candidates", () => {
    const candidate = buildEntitySourceReviewCandidate({
      surface: "3M",
      candidate: createEntitySourceCandidate({
        source_adapter_id: "opencorporates",
        source_url: "https://api.opencorporates.com/v0.4/companies/search?q=3M",
        external_id: "us_mn/00001764",
        name: "3M COMPANY",
        jurisdiction_code: "us_mn",
        company_number: "00001764",
        current_status: "Active",
        previous_names: [],
        alternative_names: [],
        identifiers: {
          open_corporates_id: "us_mn/00001764",
          company_number: "00001764",
          jurisdiction_code: "us_mn"
        },
        confidence: 0.74,
        provenance_note: "OpenCorporates company search result"
      })
    });

    expect(candidate).toMatchObject({
      kind: "entity_source_candidate",
      title: "3M -> 3M COMPANY",
      payload: {
        surface: "3M",
        candidate: {
          source_adapter_id: "opencorporates",
          external_id: "us_mn/00001764",
          name: "3M COMPANY"
        },
        proposed_aliases: ["3M", "3M COMPANY"]
      },
      evidence: {
        source_adapter_id: "opencorporates",
        source_locator: "external_id us_mn/00001764"
      }
    });
    expect(candidate.review_id).toContain("REV-ENTITY");
    expect(candidate.payload.proposed_entity_id).toContain("ENT-OC");
  });

  it("converts semantic relation changes into review-only candidates", () => {
    const candidate = buildSemanticChangeReviewCandidate({
      changeType: "PURCHASE_OBLIGATION_CHANGED",
      sourceItemId: "SRCITEM-sec-edgar-nvidia",
      sourceUrl: "https://www.sec.gov/Archives/fixture/nvidia-10q.htm",
      snapshot: {
        doc_id: "DOC-NVIDIA-10Q",
        source_adapter_id: "sec-edgar",
        relation: "BUYS_FROM",
        semantic_relation_kind: "purchase_obligation",
        subject_surface: "nvidia",
        object_surface: "tsmc",
        component_id: "COMP-WAFER",
        component: "wafer",
        component_specificity: "explicit",
        cite_text: "We have purchase obligations with TSMC for wafer capacity.",
        cite_locator: "Item 2",
        fingerprint: "we have purchase obligations with tsmc for wafer capacity",
        extractor_id: "rule.sec.official-supply-chain"
      }
    });

    expect(candidate).toMatchObject({
      kind: "semantic_change",
      title: "PURCHASE_OBLIGATION_CHANGED: nvidia -> tsmc",
      payload: {
        change_type: "PURCHASE_OBLIGATION_CHANGED",
        semantic_relation_kind: "purchase_obligation",
        relation: "BUYS_FROM",
        subject_surface: "nvidia",
        object_surface: "tsmc",
        component_id: "COMP-WAFER"
      },
      evidence: {
        doc_id: "DOC-NVIDIA-10Q",
        source_adapter_id: "sec-edgar",
        source_locator: "Item 2",
        source_row_text: "We have purchase obligations with TSMC for wafer capacity."
      }
    });
    expect(candidate.review_id).toContain("REV-SEMANTIC");
    expect(candidate.needs_review).toBe(true);
  });
});
