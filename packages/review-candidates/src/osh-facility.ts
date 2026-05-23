import { createHash } from "node:crypto";
import type { OshFacilityCandidateSnapshot, OshFacilityReviewCandidate } from "./definitions.js";

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
