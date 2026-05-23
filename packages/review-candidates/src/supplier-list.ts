import { createHash } from "node:crypto";
import type { CandidateRelation } from "@supplystrata/core";
import type { SupplierListCandidate } from "@supplystrata/supplier-list";
import type { SupplierListReviewCandidate } from "./definitions.js";

export function buildSupplierListReviewCandidate(input: {
  candidate: SupplierListCandidate;
  docId: string;
  sourceUrl: string;
  sourceDate?: string;
}): SupplierListReviewCandidate {
  const candidateKey = stableSupplierListCandidateKey(input);
  return {
    review_id: stableSupplierListReviewId(input.candidate, candidateKey),
    candidate_key: candidateKey,
    kind: "supplier_list_row",
    title: `${input.candidate.buyer_name} -> ${input.candidate.supplier_name}`,
    payload: {
      buyer_entity_id: input.candidate.buyer_entity_id,
      buyer_name: input.candidate.buyer_name,
      supplier_name: input.candidate.supplier_name,
      location_text: input.candidate.location_text,
      country_or_region: input.candidate.country_or_region,
      relation_hint: input.candidate.relation_hint,
      facility_relation_hint: input.candidate.facility_relation_hint
    },
    evidence: {
      doc_id: input.docId,
      source_url: input.sourceUrl,
      ...(input.sourceDate === undefined ? {} : { source_date: input.sourceDate }),
      source_adapter_id: input.candidate.source_adapter_id,
      source_locator: input.candidate.source_locator,
      source_row_text: input.candidate.source_row_text,
      normalized_record_text: input.candidate.normalized_record_text
    },
    confidence: input.candidate.confidence,
    needs_review: true,
    review_reason: input.candidate.review_reason
  };
}

export function supplierListReviewToSupplierRelation(candidate: SupplierListReviewCandidate): CandidateRelation {
  return {
    subject_resolve: {
      surface: candidate.payload.buyer_name,
      identifiers: {},
      context: {
        nearby_text: candidate.evidence.normalized_record_text,
        document_type: "supplier_list"
      }
    },
    object_resolve: {
      surface: candidate.payload.supplier_name,
      context: {
        nearby_text: candidate.evidence.normalized_record_text,
        document_type: "supplier_list",
        inferred_country: candidate.payload.country_or_region
      }
    },
    relation: candidate.payload.relation_hint,
    cite_text: candidate.evidence.source_row_text,
    cite_locator: candidate.evidence.source_locator,
    extractor_id: "review.supplier-list-row",
    raw_evidence_level_hint: 4,
    raw_confidence_hint: candidate.confidence
  };
}

export function supplierListReviewToCandidateRelation(candidate: SupplierListReviewCandidate): CandidateRelation {
  return supplierListReviewToSupplierRelation(candidate);
}

export function supplierListFacilityDisplayName(candidate: SupplierListReviewCandidate): string {
  return `${candidate.payload.supplier_name} facility: ${candidate.payload.location_text}, ${candidate.payload.country_or_region}`;
}

export function supplierListFacilityEntityId(candidate: SupplierListReviewCandidate): string {
  const digest = createHash("sha256")
    .update(
      [
        candidate.evidence.source_adapter_id,
        candidate.evidence.source_url,
        candidate.payload.supplier_name,
        candidate.payload.location_text,
        candidate.payload.country_or_region
      ].join("|")
    )
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
  return `ENT-FAC-${digest}`;
}

export function supplierListReviewToFacilityRelation(candidate: SupplierListReviewCandidate, facilityDisplayName: string): CandidateRelation {
  return {
    subject_resolve: {
      surface: candidate.payload.supplier_name,
      context: {
        nearby_text: candidate.evidence.normalized_record_text,
        document_type: "supplier_list",
        inferred_country: candidate.payload.country_or_region
      }
    },
    object_resolve: {
      surface: facilityDisplayName,
      context: {
        nearby_text: candidate.evidence.normalized_record_text,
        document_type: "supplier_list",
        inferred_country: candidate.payload.country_or_region
      }
    },
    relation: candidate.payload.facility_relation_hint,
    cite_text: candidate.evidence.source_row_text,
    cite_locator: candidate.evidence.source_locator,
    extractor_id: "review.supplier-list-facility-row",
    raw_evidence_level_hint: 4,
    raw_confidence_hint: candidate.confidence
  };
}

function stableSupplierListCandidateKey(input: { candidate: SupplierListCandidate; sourceUrl: string }): string {
  return [
    input.candidate.source_adapter_id,
    input.sourceUrl,
    input.candidate.buyer_entity_id,
    input.candidate.supplier_name,
    input.candidate.location_text,
    input.candidate.country_or_region,
    input.candidate.source_locator,
    input.candidate.source_row_text
  ].join("|");
}

function stableSupplierListReviewId(candidate: SupplierListCandidate, candidateKey: string): string {
  const readable = [candidate.buyer_entity_id, candidate.supplier_name, candidate.country_or_region]
    .join("|")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 56);
  const digest = createHash("sha256").update(candidateKey).digest("hex").slice(0, 16);
  return `REV-SUPPLIER-${readable}-${digest}`;
}
