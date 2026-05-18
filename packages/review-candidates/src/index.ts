import { createHash } from "node:crypto";
import { RELATION_TYPES, type CandidateRelation, type RelationType } from "@supplystrata/core";
import { candidateAliases, type EntitySourceCandidate } from "@supplystrata/entity-source";
import type { SupplierListCandidate } from "@supplystrata/supplier-list";

export type ReviewCandidateKind = ReviewCandidate["kind"];
export type ReviewCandidateStatus = "pending" | "in_review" | "approved" | "rejected" | "blocked" | "applied";

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

export interface SemanticChangeReviewPayload {
  change_type: string;
  semantic_relation_kind: string;
  source_item_id: string;
  doc_id: string;
  source_adapter_id: string;
  relation: RelationType;
  subject_surface: string;
  object_surface: string;
  cite_text: string;
  cite_locator: string;
  fingerprint: string;
  extractor_id: string;
  component_id?: string;
  component?: string;
  component_specificity?: CandidateRelation["component_specificity"];
}

export interface SemanticChangeReviewCandidate {
  review_id: string;
  candidate_key: string;
  kind: "semantic_change";
  title: string;
  payload: SemanticChangeReviewPayload;
  evidence: ReviewEvidenceContext;
  confidence: number;
  needs_review: true;
  review_reason: string;
}

export type ReviewCandidate = SupplierListReviewCandidate | EntitySourceReviewCandidate | SemanticChangeReviewCandidate;

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

export function buildEntitySourceReviewCandidate(input: { surface: string; candidate: EntitySourceCandidate }): EntitySourceReviewCandidate {
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

export function buildSemanticChangeReviewCandidate(input: {
  changeType: string;
  sourceItemId: string;
  sourceUrl: string;
  snapshot: SemanticChangeReviewPayloadSnapshot;
}): SemanticChangeReviewCandidate {
  const candidateKey = stableSemanticChangeCandidateKey(input);
  return {
    review_id: stableSemanticChangeReviewId(input, candidateKey),
    candidate_key: candidateKey,
    kind: "semantic_change",
    title: `${input.changeType}: ${input.snapshot.subject_surface} -> ${input.snapshot.object_surface}`,
    payload: {
      change_type: input.changeType,
      semantic_relation_kind: input.snapshot.semantic_relation_kind,
      source_item_id: input.sourceItemId,
      doc_id: input.snapshot.doc_id,
      source_adapter_id: input.snapshot.source_adapter_id,
      relation: input.snapshot.relation,
      subject_surface: input.snapshot.subject_surface,
      object_surface: input.snapshot.object_surface,
      cite_text: input.snapshot.cite_text,
      cite_locator: input.snapshot.cite_locator,
      fingerprint: input.snapshot.fingerprint,
      extractor_id: input.snapshot.extractor_id,
      ...(input.snapshot.component_id === undefined ? {} : { component_id: input.snapshot.component_id }),
      ...(input.snapshot.component === undefined ? {} : { component: input.snapshot.component }),
      ...(input.snapshot.component_specificity === undefined ? {} : { component_specificity: input.snapshot.component_specificity })
    },
    evidence: {
      doc_id: input.snapshot.doc_id,
      source_url: input.sourceUrl,
      source_adapter_id: input.snapshot.source_adapter_id,
      source_locator: input.snapshot.cite_locator,
      source_row_text: input.snapshot.cite_text,
      normalized_record_text: [
        input.changeType,
        input.snapshot.semantic_relation_kind,
        input.snapshot.subject_surface,
        input.snapshot.relation,
        input.snapshot.object_surface,
        input.snapshot.component ?? input.snapshot.component_id ?? ""
      ]
        .join(" | ")
        .trim()
    },
    confidence: confidenceForSemanticChange(input.changeType),
    needs_review: true,
    review_reason: "官方披露的关系语义发生变化。该候选只代表“值得研究员复核的变化”，不会自动写入事实图谱；确认后用于后续 claim / 研究摘要。"
  };
}

export interface SemanticChangeReviewPayloadSnapshot {
  doc_id: string;
  source_adapter_id: string;
  relation: RelationType;
  semantic_relation_kind: string;
  subject_surface: string;
  object_surface: string;
  cite_text: string;
  cite_locator: string;
  fingerprint: string;
  extractor_id: string;
  component_id?: string;
  component?: string;
  component_specificity?: CandidateRelation["component_specificity"];
}

export function isReviewCandidate(value: unknown): value is ReviewCandidate {
  if (!isRecord(value)) return false;
  if (value["kind"] === "supplier_list_row") return isSupplierListReviewCandidatePayload(value);
  if (value["kind"] === "entity_source_candidate") return isEntitySourceReviewCandidatePayload(value);
  if (value["kind"] === "semantic_change") return isSemanticChangeReviewCandidatePayload(value);
  return false;
}

export function isSupplierListReviewCandidate(candidate: ReviewCandidate): candidate is SupplierListReviewCandidate {
  return candidate.kind === "supplier_list_row";
}

export function isEntitySourceReviewCandidate(candidate: ReviewCandidate): candidate is EntitySourceReviewCandidate {
  return candidate.kind === "entity_source_candidate";
}

export function isSemanticChangeReviewCandidate(candidate: ReviewCandidate): candidate is SemanticChangeReviewCandidate {
  return candidate.kind === "semantic_change";
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
  const readable = [candidate.source_adapter_id, candidate.name, candidate.jurisdiction_code ?? ""]
    .join("|")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 56);
  const digest = createHash("sha256").update(candidateKey).digest("hex").slice(0, 16);
  return `REV-ENTITY-${readable}-${digest}`;
}

function stableSemanticChangeCandidateKey(input: {
  changeType: string;
  sourceItemId: string;
  sourceUrl: string;
  snapshot: SemanticChangeReviewPayloadSnapshot;
}): string {
  return [
    "semantic-change",
    input.changeType,
    input.sourceItemId,
    input.sourceUrl,
    input.snapshot.doc_id,
    input.snapshot.semantic_relation_kind,
    input.snapshot.relation,
    input.snapshot.subject_surface,
    input.snapshot.object_surface,
    input.snapshot.component_id ?? "",
    input.snapshot.component ?? "",
    input.snapshot.component_specificity ?? "",
    input.snapshot.fingerprint
  ].join("|");
}

function stableSemanticChangeReviewId(input: { changeType: string; snapshot: SemanticChangeReviewPayloadSnapshot }, candidateKey: string): string {
  const readable = [input.changeType, input.snapshot.subject_surface, input.snapshot.object_surface]
    .join("|")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 56);
  const digest = createHash("sha256").update(candidateKey).digest("hex").slice(0, 16);
  return `REV-SEMANTIC-${readable}-${digest}`;
}

function confidenceForSemanticChange(changeType: string): number {
  if (changeType.includes("REMOVED")) return 0.7;
  if (changeType.includes("CHANGED")) return 0.82;
  return 0.86;
}

function isSupplierListReviewCandidatePayload(value: Record<string, unknown>): boolean {
  const payload = value["payload"];
  const evidence = value["evidence"];
  if (!hasCommonReviewFields(value) || !isRecord(payload) || !isReviewEvidenceContext(evidence)) return false;
  return (
    isNonEmptyString(payload["buyer_entity_id"]) &&
    isNonEmptyString(payload["buyer_name"]) &&
    isNonEmptyString(payload["supplier_name"]) &&
    isNonEmptyString(payload["location_text"]) &&
    isNonEmptyString(payload["country_or_region"]) &&
    payload["relation_hint"] === "BUYS_FROM" &&
    payload["facility_relation_hint"] === "MANUFACTURES_AT"
  );
}

function isEntitySourceReviewCandidatePayload(value: Record<string, unknown>): boolean {
  const payload = value["payload"];
  const evidence = value["evidence"];
  if (!hasCommonReviewFields(value) || !isRecord(payload) || !isReviewEvidenceContext(evidence)) return false;
  const proposedAliases = payload["proposed_aliases"];
  const candidate = payload["candidate"];
  return (
    isNonEmptyString(payload["surface"]) &&
    isNonEmptyString(payload["proposed_entity_id"]) &&
    Array.isArray(proposedAliases) &&
    proposedAliases.every(isNonEmptyString) &&
    isRecord(candidate) &&
    isNonEmptyString(candidate["source_adapter_id"]) &&
    isNonEmptyString(candidate["source_url"]) &&
    isNonEmptyString(candidate["external_id"]) &&
    isNonEmptyString(candidate["name"]) &&
    isRecord(candidate["identifiers"]) &&
    isNumber(candidate["confidence"])
  );
}

function isSemanticChangeReviewCandidatePayload(value: Record<string, unknown>): boolean {
  const payload = value["payload"];
  const evidence = value["evidence"];
  if (!hasCommonReviewFields(value) || !isRecord(payload) || !isReviewEvidenceContext(evidence)) return false;
  return (
    isNonEmptyString(payload["change_type"]) &&
    isNonEmptyString(payload["semantic_relation_kind"]) &&
    isNonEmptyString(payload["source_item_id"]) &&
    isNonEmptyString(payload["doc_id"]) &&
    isNonEmptyString(payload["source_adapter_id"]) &&
    isRelationType(payload["relation"]) &&
    isNonEmptyString(payload["subject_surface"]) &&
    isNonEmptyString(payload["object_surface"]) &&
    isNonEmptyString(payload["cite_text"]) &&
    isNonEmptyString(payload["cite_locator"]) &&
    isNonEmptyString(payload["fingerprint"]) &&
    isNonEmptyString(payload["extractor_id"]) &&
    isOptionalString(payload["component_id"]) &&
    isOptionalString(payload["component"]) &&
    isOptionalComponentSpecificity(payload["component_specificity"])
  );
}

function hasCommonReviewFields(value: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(value["review_id"]) &&
    isNonEmptyString(value["candidate_key"]) &&
    isNonEmptyString(value["title"]) &&
    isNumber(value["confidence"]) &&
    value["needs_review"] === true &&
    isNonEmptyString(value["review_reason"])
  );
}

function isReviewEvidenceContext(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isOptionalString(value["doc_id"]) &&
    isNonEmptyString(value["source_url"]) &&
    isOptionalString(value["source_date"]) &&
    isNonEmptyString(value["source_adapter_id"]) &&
    isNonEmptyString(value["source_locator"]) &&
    isNonEmptyString(value["source_row_text"]) &&
    isNonEmptyString(value["normalized_record_text"])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRelationType(value: unknown): value is RelationType {
  return typeof value === "string" && (RELATION_TYPES as readonly string[]).includes(value);
}

function isOptionalComponentSpecificity(value: unknown): boolean {
  return value === undefined || value === "explicit" || value === "inferred" || value === "unspecified";
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
