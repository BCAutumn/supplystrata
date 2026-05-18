import { markLeadObservationInReview, saveNormalizedDocumentTx, type DatabaseStore, type DbTxClient } from "@supplystrata/db";
import { storeLeadObservation, type LeadStoreInput } from "@supplystrata/observation-store";
import { buildSupplierListReviewCandidate } from "@supplystrata/review-candidates";
import { enqueueReviewCandidates } from "@supplystrata/review-store";
import {
  appleSuppliersAdapter,
  createAppleSuppliersAdapterContext,
  extractAppleSupplierCandidates,
  type AppleSupplierCandidate,
  type AppleSuppliersInput
} from "@supplystrata/sources-apple-suppliers";
import { recordSavedDocumentObservation } from "@supplystrata/pipeline";
import { ensureSourceCheckTarget, type SourceCheckTargetInput } from "@supplystrata/source-monitor";
import { fetchAndNormalizeFirstTask } from "./source-documents.js";
import type { ReviewEnqueueSummary } from "./types.js";

export async function enqueueAppleSupplierReviewCandidates(
  store: DatabaseStore,
  input: AppleSuppliersInput = { fiscalYear: 2022, entityId: "ENT-APPLE" }
): Promise<ReviewEnqueueSummary> {
  const { raw, normalized, sourceDate } = await fetchAndNormalizeFirstTask({
    adapter: appleSuppliersAdapter,
    input,
    context: createAppleSuppliersAdapterContext(),
    logLabel: "Apple Supplier List"
  });
  const { saved, candidates, result, facilityCrossCheckLeads, facilityCrossCheckTargets } = await store.transaction(async (client) => {
    const savedDocument = await saveNormalizedDocumentTx(client, normalized);
    await recordSavedDocumentObservation(client, normalized, savedDocument.doc_id);
    const appleCandidates = extractAppleSupplierCandidates(normalized, input.fiscalYear);
    const reviewCandidates = appleCandidates.map((candidate) =>
      buildSupplierListReviewCandidate({
        candidate,
        docId: savedDocument.doc_id,
        sourceUrl: raw.url,
        ...(sourceDate === undefined ? {} : { sourceDate })
      })
    );
    const enqueueResult = await enqueueReviewCandidates(client, reviewCandidates);
    const crossCheckSummary = await storeAppleOshCrossCheckLeads(client, appleCandidates, {
      docId: savedDocument.doc_id,
      sourceUrl: raw.url,
      ...(sourceDate === undefined ? {} : { sourceDate })
    });
    return {
      saved: savedDocument,
      candidates: reviewCandidates,
      result: enqueueResult,
      facilityCrossCheckLeads: crossCheckSummary.leads,
      facilityCrossCheckTargets: crossCheckSummary.checkTargets
    };
  });
  return {
    doc_id: saved.doc_id,
    source_url: raw.url,
    candidates: candidates.length,
    inserted: result.inserted,
    skipped: result.skipped,
    facility_cross_check_leads: facilityCrossCheckLeads,
    facility_cross_check_targets: facilityCrossCheckTargets
  };
}

export function buildAppleOshCrossCheckLead(
  candidate: AppleSupplierCandidate,
  input: { docId: string; sourceUrl: string; sourceDate?: string }
): LeadStoreInput {
  const title = `Cross-check Apple supplier facility in OSH: ${candidate.supplier_name}`;
  const attrs: Record<string, unknown> = {
    semantic_layer: "lead",
    cross_check_source_adapter_id: "osh",
    cross_check_target_kind: "facility-search",
    supplier_name: candidate.supplier_name,
    location_text: candidate.location_text,
    country_or_region: candidate.country_or_region,
    normalized_record_text: candidate.normalized_record_text,
    suggested_target_config: {
      query: candidate.supplier_name,
      scope_id: candidate.buyer_entity_id,
      source_supplier_name: candidate.supplier_name,
      source_location_text: candidate.location_text,
      source_country_or_region: candidate.country_or_region
    },
    no_company_edge: true
  };
  if (input.sourceDate !== undefined) attrs["source_date"] = input.sourceDate;
  return {
    lead_type: "UNVERIFIED_FACILITY_SIGNAL",
    source_adapter_id: candidate.source_adapter_id,
    doc_id: input.docId,
    scope_kind: "company",
    scope_id: candidate.buyer_entity_id,
    title,
    summary: `${candidate.supplier_name} is listed by Apple for ${candidate.location_text}, ${candidate.country_or_region}. Check Open Supply Hub for facility candidates; do not promote OSH matches to fact edges without review.`,
    cite_text: candidate.source_row_text,
    source_url: input.sourceUrl,
    attrs
  };
}

export function buildAppleOshSourceCheckTarget(candidate: AppleSupplierCandidate, input: { leadId: string; sourceDate?: string }): SourceCheckTargetInput {
  return {
    check_target_id: `osh:apple-supplier:${input.leadId}`,
    source_adapter_id: "osh",
    target_kind: "facility-search",
    enabled: true,
    priority: 30,
    subject_entity_id: candidate.buyer_entity_id,
    target_config: {
      query: candidate.supplier_name,
      scope_id: candidate.buyer_entity_id,
      lead_id: input.leadId,
      source_supplier_name: candidate.supplier_name,
      source_location_text: candidate.location_text,
      source_country_or_region: candidate.country_or_region,
      source_adapter_id: candidate.source_adapter_id,
      source_locator: candidate.source_locator,
      ...(input.sourceDate === undefined ? {} : { source_date: input.sourceDate }),
      page_size: 10
    },
    notes: `Generated from Apple Supplier List lead ${input.leadId}; OSH output remains observation/lead context until reviewed.`
  };
}

async function storeAppleOshCrossCheckLeads(
  client: DbTxClient,
  candidates: readonly AppleSupplierCandidate[],
  input: { docId: string; sourceUrl: string; sourceDate?: string }
): Promise<{ leads: number; checkTargets: number }> {
  let leads = 0;
  let checkTargets = 0;
  for (const candidate of candidates) {
    // Apple 官方名单给出强 facility lead；OSH 只用于交叉查找设施候选，不能在这里生成供应关系事实边。
    const leadResult = await storeLeadObservation(client, buildAppleOshCrossCheckLead(candidate, input));
    leads += 1;
    const target = buildAppleOshSourceCheckTarget(candidate, {
      leadId: leadResult.id,
      ...(input.sourceDate === undefined ? {} : { sourceDate: input.sourceDate })
    });
    await ensureSourceCheckTarget(client, { target, configSource: "lead:apple-suppliers" });
    await markLeadObservationInReview(client, {
      leadId: leadResult.id,
      attrsPatch: {
        source_check_target_id: target.check_target_id,
        source_check_source_adapter_id: target.source_adapter_id,
        source_check_target_kind: target.target_kind
      }
    });
    checkTargets += 1;
  }
  return { leads, checkTargets };
}
