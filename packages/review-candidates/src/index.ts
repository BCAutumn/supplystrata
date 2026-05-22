import { createHash } from "node:crypto";
import type { CandidateRelation } from "@supplystrata/core";
import { candidateAliases, type EntitySourceCandidate } from "@supplystrata/entity-source";
import type { SupplierListCandidate } from "@supplystrata/supplier-list";
import type {
  ClaimConflictReviewPayload,
  ClaimConflictReviewCandidate,
  EntitySourceReviewCandidate,
  OfficialDisclosureSignalReviewCandidate,
  OfficialDisclosureSignalReviewInput,
  OshFacilityCandidateSnapshot,
  OshFacilityReviewCandidate,
  SemanticChangeReviewCandidate,
  SemanticChangeReviewPayloadSnapshot,
  SupplierListReviewCandidate
} from "./definitions.js";

export * from "./definitions.js";
export * from "./guards.js";

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

export function buildOshFacilityReviewCandidate(input: {
  candidate: OshFacilityCandidateSnapshot;
  docId: string;
  sourceItemId: string;
  observationId: string;
  sourceUrl: string;
  query: string;
  sourceLeadId?: string;
  targetScopeId?: string;
  sourceSupplierName?: string;
  sourceLocationText?: string;
  sourceCountryOrRegion?: string;
}): OshFacilityReviewCandidate {
  const candidateKey = stableOshFacilityCandidateKey(input);
  const sourceRowText = oshFacilitySourceRowText(input.candidate);
  return {
    review_id: stableOshFacilityReviewId(input.candidate, candidateKey),
    candidate_key: candidateKey,
    kind: "osh_facility_candidate",
    title: `OSH facility candidate: ${input.query} -> ${input.candidate.name}`,
    payload: {
      source_item_id: input.sourceItemId,
      observation_id: input.observationId,
      query: input.query,
      osh_candidate: input.candidate,
      ...(input.sourceLeadId === undefined ? {} : { source_lead_id: input.sourceLeadId }),
      ...(input.targetScopeId === undefined ? {} : { target_scope_id: input.targetScopeId }),
      ...(input.sourceSupplierName === undefined ? {} : { source_supplier_name: input.sourceSupplierName }),
      ...(input.sourceLocationText === undefined ? {} : { source_location_text: input.sourceLocationText }),
      ...(input.sourceCountryOrRegion === undefined ? {} : { source_country_or_region: input.sourceCountryOrRegion })
    },
    evidence: {
      doc_id: input.docId,
      source_url: input.sourceUrl,
      source_adapter_id: "osh",
      source_locator: `Open Supply Hub facility ${input.candidate.os_id}`,
      source_row_text: sourceRowText,
      normalized_record_text: [
        input.query,
        input.candidate.name,
        input.candidate.address ?? "",
        input.candidate.country_name ?? input.candidate.country_code ?? ""
      ]
        .join(" | ")
        .trim()
    },
    confidence: 0.72,
    needs_review: true,
    review_reason: "Open Supply Hub 只提供设施候选和 contributor 声明；必须人工确认后才能作为设施校验结果使用，不能自动生成供应链事实边。"
  };
}

export function buildClaimConflictReviewCandidate(input: { payload: ClaimConflictReviewPayload }): ClaimConflictReviewCandidate {
  const candidateKey = stableClaimConflictCandidateKey(input.payload);
  const evidenceIds = input.payload.evidence_refs.map((ref) => `${ref.role}:${ref.evidence_id}`);
  const unknownIds = input.payload.unknown_refs.map((ref) => `${ref.role}:${ref.status}:${ref.unknown_id}`);
  return {
    review_id: stableClaimConflictReviewId(input.payload, candidateKey),
    candidate_key: candidateKey,
    kind: "claim_conflict_review",
    title: `Claim conflict: ${input.payload.claim_id}`,
    payload: input.payload,
    evidence: {
      source_url: `supplystrata://claims/${input.payload.claim_id}/conflict-review`,
      source_adapter_id: "claim-builder",
      source_locator: input.payload.edge_id === null ? input.payload.claim_id : `${input.payload.claim_id} / ${input.payload.edge_id}`,
      source_row_text: input.payload.claim_text,
      normalized_record_text: [input.payload.claim_id, input.payload.conflict_state, ...evidenceIds, ...unknownIds].join(" | ")
    },
    confidence: claimConflictReviewConfidence(input.payload),
    needs_review: true,
    review_reason:
      "Claim has contradicting evidence or an open conflict unknown. This review candidate blocks automatic fact mutation and requires human resolution before any edge deprecation or claim status change."
  };
}

export function buildOfficialDisclosureSignalReviewCandidate(input: {
  signal: OfficialDisclosureSignalReviewInput;
  docId: string;
  sourceItemId: string;
  sourceAdapterId: string;
  sourceUrl: string;
  sourceDate?: string;
  sourceLocator: string;
}): OfficialDisclosureSignalReviewCandidate {
  const candidateKey = stableOfficialDisclosureSignalCandidateKey(input);
  return {
    review_id: stableOfficialDisclosureSignalReviewId(input, candidateKey),
    candidate_key: candidateKey,
    kind: "official_disclosure_signal",
    title: `Official disclosure signal: ${input.signal.title}`,
    payload: {
      source_item_id: input.sourceItemId,
      doc_id: input.docId,
      source_adapter_id: input.sourceAdapterId,
      signal_title: input.signal.title,
      cite_text: input.signal.cite_text,
      cite_locator: input.sourceLocator,
      evidence_level_hint: input.signal.evidence_level,
      fact_write_policy: {
        automatic_fact_mutation_allowed: false,
        allowed_edge_mutation: "none",
        requires_human_review: true,
        reason_codes: ["review_only_official_signal", "not_a_relation_extractor", "no_counterparty_edge_without_review"]
      }
    },
    evidence: {
      doc_id: input.docId,
      source_url: input.sourceUrl,
      ...(input.sourceDate === undefined ? {} : { source_date: input.sourceDate }),
      source_adapter_id: input.sourceAdapterId,
      source_locator: input.sourceLocator,
      source_row_text: input.signal.cite_text,
      normalized_record_text: [input.signal.title, `evidence_level=${input.signal.evidence_level}`, input.signal.cite_text].join(" | ")
    },
    confidence: input.signal.confidence,
    needs_review: true,
    review_reason: "官方披露信号只说明该文档出现了供应链、产能、需求或技术路线相关内容；它用于研究员复核、补充 claim 或寻找 corroboration，不会自动写入事实边。"
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

function stableOshFacilityCandidateKey(input: { candidate: OshFacilityCandidateSnapshot; sourceUrl: string; query: string; observationId: string }): string {
  return ["osh-facility", input.sourceUrl, input.query, input.observationId, input.candidate.os_id, input.candidate.name].join("|");
}

function stableOshFacilityReviewId(candidate: OshFacilityCandidateSnapshot, candidateKey: string): string {
  const readable = ["osh", candidate.name, candidate.country_code ?? candidate.country_name ?? ""]
    .join("|")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 56);
  const digest = createHash("sha256").update(candidateKey).digest("hex").slice(0, 16);
  return `REV-OSH-FACILITY-${readable}-${digest}`;
}

function stableClaimConflictCandidateKey(payload: ClaimConflictReviewPayload): string {
  return [
    "claim-conflict-review",
    payload.claim_id,
    payload.edge_id ?? "",
    payload.conflict_state,
    payload.safe_write_status,
    payload.evidence_refs.map((ref) => `${ref.role}:${ref.evidence_id}`).join(","),
    payload.unknown_refs.map((ref) => `${ref.role}:${ref.status}:${ref.unknown_id}`).join(",")
  ].join("|");
}

function stableOfficialDisclosureSignalCandidateKey(input: {
  signal: OfficialDisclosureSignalReviewInput;
  docId: string;
  sourceItemId: string;
  sourceAdapterId: string;
  sourceUrl: string;
  sourceLocator: string;
}): string {
  return [
    "official-disclosure-signal",
    input.sourceAdapterId,
    input.sourceItemId,
    input.docId,
    input.sourceUrl,
    input.sourceLocator,
    input.signal.title,
    input.signal.cite_text
  ].join("|");
}

function stableOfficialDisclosureSignalReviewId(input: { signal: OfficialDisclosureSignalReviewInput; sourceAdapterId: string }, candidateKey: string): string {
  const readable = [input.sourceAdapterId, input.signal.title]
    .join("|")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 56);
  const digest = createHash("sha256").update(candidateKey).digest("hex").slice(0, 16);
  return `REV-OFFICIAL-SIGNAL-${readable}-${digest}`;
}

function stableClaimConflictReviewId(payload: ClaimConflictReviewPayload, candidateKey: string): string {
  const readable = [payload.claim_id, payload.conflict_state]
    .join("|")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 56);
  const digest = createHash("sha256").update(candidateKey).digest("hex").slice(0, 16);
  return `REV-CLAIM-CONFLICT-${readable}-${digest}`;
}

function claimConflictReviewConfidence(payload: ClaimConflictReviewPayload): number {
  if (payload.severity === "high") return 0.9;
  return 0.78;
}

function oshFacilitySourceRowText(candidate: OshFacilityCandidateSnapshot): string {
  return [
    `os_id=${candidate.os_id}`,
    `name=${candidate.name}`,
    candidate.address === undefined ? undefined : `address=${candidate.address}`,
    candidate.country_code === undefined ? undefined : `country_code=${candidate.country_code}`,
    candidate.country_name === undefined ? undefined : `country_name=${candidate.country_name}`,
    candidate.sector === undefined ? undefined : `sector=${candidate.sector}`,
    candidate.product_type === undefined ? undefined : `product_type=${candidate.product_type}`,
    candidate.contributors.length === 0 ? undefined : `contributors=${candidate.contributors.join("; ")}`
  ]
    .filter((item): item is string => item !== undefined)
    .join(" | ");
}

function confidenceForSemanticChange(changeType: string): number {
  if (changeType.includes("REMOVED")) return 0.7;
  if (changeType.includes("CHANGED")) return 0.82;
  return 0.86;
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
