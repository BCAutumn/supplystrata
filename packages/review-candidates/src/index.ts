import { createHash } from "node:crypto";
import { type CandidateRelation, type RelationType } from "@supplystrata/core";
import { candidateAliases, type EntitySourceCandidate } from "@supplystrata/entity-source";
import type { SupplierListCandidate } from "@supplystrata/supplier-list";

export type ReviewCandidateKind = "supplier_list_row" | "entity_source_candidate" | "relation_extraction";
export type ReviewCandidateStatus = "pending" | "approved" | "rejected" | "blocked" | "applied";

export interface ReviewEvidenceContext {
  doc_id?: string;
  source_url: string;
  source_date?: string;
  source_adapter_id: string;
  source_locator: string;
  source_row_text: string;
  normalized_record_text: string;
}

export interface SupplierListReviewPayload {
  buyer_entity_id: string;
  buyer_name: string;
  supplier_name: string;
  location_text: string;
  country_or_region: string;
  relation_hint: Extract<RelationType, "BUYS_FROM">;
  facility_relation_hint: Extract<RelationType, "MANUFACTURES_AT">;
}

export interface SupplierListReviewCandidate {
  review_id: string;
  candidate_key: string;
  kind: "supplier_list_row";
  title: string;
  payload: SupplierListReviewPayload;
  evidence: ReviewEvidenceContext;
  confidence: number;
  needs_review: true;
  review_reason: string;
}

export interface EntitySourceReviewPayload {
  surface: string;
  proposed_entity_id: string;
  proposed_aliases: string[];
  candidate: EntitySourceCandidate;
}

export interface EntitySourceReviewCandidate {
  review_id: string;
  candidate_key: string;
  kind: "entity_source_candidate";
  title: string;
  payload: EntitySourceReviewPayload;
  evidence: ReviewEvidenceContext;
  confidence: number;
  needs_review: true;
  review_reason: string;
}

export type ReviewCandidate = SupplierListReviewCandidate | EntitySourceReviewCandidate;

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

export function buildEntitySourceReviewCandidate(input: {
  surface: string;
  candidate: EntitySourceCandidate;
}): EntitySourceReviewCandidate {
  const candidateKey = stableEntitySourceCandidateKey(input);
  const aliases = candidateAliases(input.candidate);
  const surface = input.surface.normalize("NFKC").trim().replace(/\s+/g, " ");
  const proposedAliases = aliases.some((alias) => alias.toLowerCase() === surface.toLowerCase()) ? aliases : [surface, ...aliases];
  return {
    review_id: stableEntitySourceReviewId(input.candidate, candidateKey),
    candidate_key: candidateKey,
    kind: "entity_source_candidate",
    title: `${surface} -> ${input.candidate.name}`,
    payload: {
      surface,
      proposed_entity_id: proposedEntityId(input.candidate),
      proposed_aliases: proposedAliases,
      candidate: input.candidate
    },
    evidence: {
      source_url: input.candidate.source_url,
      source_adapter_id: input.candidate.source_adapter_id,
      source_locator: `external_id ${input.candidate.external_id}`,
      source_row_text: input.candidate.provenance_note,
      normalized_record_text: `${surface} | ${input.candidate.name} | ${input.candidate.external_id}`
    },
    confidence: input.candidate.confidence,
    needs_review: true,
    review_reason: "外部登记源候选只用于实体解析补全，必须人工确认后才能写入 entity_master / entity_alias。"
  };
}

export function isReviewCandidate(value: unknown): value is ReviewCandidate {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  const kind = (value as { kind: unknown }).kind;
  return kind === "supplier_list_row" || kind === "entity_source_candidate";
}

export function isSupplierListReviewCandidate(candidate: ReviewCandidate): candidate is SupplierListReviewCandidate {
  return candidate.kind === "supplier_list_row";
}

export function isEntitySourceReviewCandidate(candidate: ReviewCandidate): candidate is EntitySourceReviewCandidate {
  return candidate.kind === "entity_source_candidate";
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
  const readable = [
    candidate.buyer_entity_id,
    candidate.supplier_name,
    candidate.country_or_region
  ]
    .join("|")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 56);
  const digest = createHash("sha256").update(candidateKey).digest("hex").slice(0, 16);
  return `REV-SUPPLIER-${readable}-${digest}`;
}

function stableEntitySourceCandidateKey(input: { surface: string; candidate: EntitySourceCandidate }): string {
  return [
    "entity-source",
    input.candidate.source_adapter_id,
    input.surface.normalize("NFKC").trim().toLowerCase(),
    input.candidate.external_id,
    input.candidate.name,
    input.candidate.jurisdiction_code ?? "",
    input.candidate.company_number ?? ""
  ].join("|");
}

function stableEntitySourceReviewId(candidate: EntitySourceCandidate, candidateKey: string): string {
  const readable = [
    candidate.source_adapter_id,
    candidate.name,
    candidate.jurisdiction_code ?? ""
  ]
    .join("|")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 56);
  const digest = createHash("sha256").update(candidateKey).digest("hex").slice(0, 16);
  return `REV-ENTITY-${readable}-${digest}`;
}

function proposedEntityId(candidate: EntitySourceCandidate): string {
  const source = candidate.source_adapter_id === "companies-house" ? "CH" : "OC";
  const readable = [candidate.name, candidate.jurisdiction_code ?? "", candidate.company_number ?? candidate.external_id]
    .join("|")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 72);
  const digest = createHash("sha256").update(`${candidate.source_adapter_id}|${candidate.external_id}`).digest("hex").slice(0, 8).toUpperCase();
  return `ENT-${source}-${readable}-${digest}`;
}
