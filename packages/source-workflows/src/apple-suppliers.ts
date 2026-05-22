import { markLeadObservationInReview, saveNormalizedDocumentTx, type DatabaseStore, type DbTxClient } from "@supplystrata/db";
import { messageFromUnknown } from "@supplystrata/observability";
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
import { ensureSourceCheckTarget, recordSourceFailure, type SourceCheckTargetInput } from "@supplystrata/source-monitor";
import {
  optionalConfigPositiveInteger,
  requireConfigString,
  type SourceCheckConnector,
  type SourceCheckConnectorLogger
} from "@supplystrata/source-connectors";
import { sourceWorkflowAdapterContextInputFromEnv } from "./adapter-context.js";
import { fetchAndNormalizeFirstTask } from "./source-documents.js";
import type { SourceCheckSummary } from "./source-check-runner.js";
import type { ReviewEnqueueSummary } from "./types.js";

export const appleSupplierListReviewSourceCheckConnector: SourceCheckConnector<DatabaseStore, SourceCheckSummary> = {
  source_adapter_id: "apple-suppliers",
  target_kind: "supplier-list-review",
  config_schema: {
    fields: [
      { key: "fiscal_year", type: "positive_integer", required: true, description: "Apple Supplier List fiscal year." },
      { key: "entity_id", type: "string", required: true, description: "Buyer entity id.", allowed_values: ["ENT-APPLE"] },
      {
        key: "scope_kind",
        type: "string",
        required: false,
        description: "Research scope kind that requested this list.",
        allowed_values: ["company", "component"]
      },
      { key: "scope_id", type: "string", required: false, description: "Research scope id that requested this list." },
      { key: "component_id", type: "string", required: false, description: "Component target id used by readiness and source-target coverage." }
    ]
  },
  async run(store, target, context) {
    try {
      return [
        await runAppleSupplierListReviewCheck(store, appleSupplierInputFromConfig(target.target_config), {
          checkTargetId: target.check_target_id,
          ...(context.logger === undefined ? {} : { logger: context.logger })
        })
      ];
    } catch (error) {
      await store.transaction(async (client) => {
        await recordSourceFailure(client, {
          source_adapter_id: "apple-suppliers",
          check_target_id: target.check_target_id,
          error_message: messageFromUnknown(error),
          caused_by: "source-check.apple-suppliers"
        });
      });
      throw error;
    }
  }
};

export async function enqueueAppleSupplierReviewCandidates(
  store: DatabaseStore,
  input: AppleSuppliersInput = { fiscalYear: 2022, entityId: "ENT-APPLE" }
): Promise<ReviewEnqueueSummary> {
  const result = await ingestAppleSupplierReviewCandidates(store, input);
  return {
    doc_id: result.saved.doc_id,
    source_url: result.raw.url,
    candidates: result.candidates,
    inserted: result.inserted,
    skipped: result.skipped,
    facility_cross_check_leads: result.facilityCrossCheckLeads,
    facility_cross_check_targets: result.facilityCrossCheckTargets
  };
}

async function runAppleSupplierListReviewCheck(
  store: DatabaseStore,
  input: AppleSuppliersInput,
  options: { checkTargetId: string; logger?: SourceCheckConnectorLogger }
): Promise<SourceCheckSummary> {
  const result = await ingestAppleSupplierReviewCandidates(store, input, options);
  return {
    source_adapter_id: "apple-suppliers",
    task_id: `apple-suppliers-fy${String(input.fiscalYear).slice(2)}`,
    doc_id: result.saved.doc_id,
    source_url: result.raw.url,
    change_type: result.documentObservation.change_type,
    source_item_id: result.documentObservation.source_item_id,
    source_event_id: result.documentObservation.event_id,
    observations: 0,
    review_candidates: result.inserted,
    semantic_changes: 0,
    relation_changes: 0
  };
}

async function ingestAppleSupplierReviewCandidates(
  store: DatabaseStore,
  input: AppleSuppliersInput,
  options: { checkTargetId?: string; logger?: SourceCheckConnectorLogger } = {}
): Promise<{
  raw: Awaited<ReturnType<typeof fetchAndNormalizeFirstTask<AppleSuppliersInput>>>["raw"];
  saved: { doc_id: string };
  documentObservation: Awaited<ReturnType<typeof recordSavedDocumentObservation>>;
  candidates: number;
  inserted: number;
  skipped: number;
  facilityCrossCheckLeads: number;
  facilityCrossCheckTargets: number;
}> {
  const { raw, normalized, sourceDate } = await fetchAndNormalizeFirstTask({
    adapter: appleSuppliersAdapter,
    input,
    context: createAppleSuppliersAdapterContext(sourceWorkflowAdapterContextInputFromEnv()),
    logLabel: "Apple Supplier List",
    ...(options.logger === undefined ? {} : { logger: options.logger })
  });
  const { saved, documentObservation, candidates, result, facilityCrossCheckLeads, facilityCrossCheckTargets } = await store.transaction(async (client) => {
    const savedDocument = await saveNormalizedDocumentTx(client, normalized);
    const savedObservation = await recordSavedDocumentObservation(client, normalized, savedDocument.doc_id, {
      ...(options.checkTargetId === undefined ? {} : { checkTargetId: options.checkTargetId })
    });
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
      documentObservation: savedObservation,
      candidates: reviewCandidates,
      result: enqueueResult,
      facilityCrossCheckLeads: crossCheckSummary.leads,
      facilityCrossCheckTargets: crossCheckSummary.checkTargets
    };
  });
  return {
    raw,
    saved,
    documentObservation,
    candidates: candidates.length,
    inserted: result.inserted,
    skipped: result.skipped,
    facilityCrossCheckLeads,
    facilityCrossCheckTargets
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

export function appleSupplierInputFromConfig(config: Record<string, unknown>): AppleSuppliersInput {
  const label = "Apple Supplier List source check target";
  const fiscalYear = optionalConfigPositiveInteger(config, "fiscal_year", label);
  if (fiscalYear !== 2022) throw new Error(`${label} fiscal_year must be 2022`);
  const entityId = requireConfigString(config, "entity_id", label);
  if (entityId !== "ENT-APPLE") throw new Error(`${label} entity_id must be ENT-APPLE`);
  return { fiscalYear, entityId };
}
