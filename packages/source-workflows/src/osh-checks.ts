import { saveNormalizedDocumentTx, type DatabaseStore, type DbClient } from "@supplystrata/db";
import { getLogger, messageFromUnknown } from "@supplystrata/observability";
import { storeObservation } from "@supplystrata/observation-store";
import { buildOshFacilityReviewCandidate } from "@supplystrata/review-candidates";
import { enqueueReviewCandidates } from "@supplystrata/review-store";
import { recordSourceFailure } from "@supplystrata/source-monitor";
import {
  optionalConfigPositiveInteger,
  requireConfigString,
  type SourceCheckConnector,
  type SourceCheckConnectorLogger
} from "@supplystrata/source-connectors";
import {
  createOshAdapterContext,
  oshAdapter,
  parseOshFacilityCandidates,
  type OshFacilityCandidate,
  type OshFacilitySearchInput
} from "@supplystrata/sources-osh";
import { recordSavedDocumentObservation } from "@supplystrata/pipeline";
import type { SourceCheckSummary } from "./source-check-runner.js";
import { OSH_CREDENTIALS } from "./source-check-credentials.js";

export const oshSourceCheckConnector: SourceCheckConnector<DatabaseStore, SourceCheckSummary> = {
  source_adapter_id: "osh",
  target_kind: "facility-search",
  credential_requirements: OSH_CREDENTIALS,
  config_schema: {
    fields: [
      { key: "query", type: "string", required: true, description: "Facility search query." },
      { key: "country_code", type: "string", required: false, description: "Optional OSH country filter." },
      { key: "sector", type: "string", required: false, description: "Optional OSH sector filter." },
      { key: "page", type: "positive_integer", required: false, description: "OSH result page." },
      { key: "page_size", type: "positive_integer", required: false, description: "OSH result page size." },
      { key: "scope_id", type: "string", required: false, description: "Entity or facility scope that requested the search." },
      { key: "lead_id", type: "string", required: false, description: "Lead observation id that triggered the search." },
      { key: "source_supplier_name", type: "string", required: false, description: "Supplier name from the upstream source." },
      { key: "source_location_text", type: "string", required: false, description: "Location text from the upstream source." },
      { key: "source_country_or_region", type: "string", required: false, description: "Country or region text from the upstream source." }
    ]
  },
  run(store, target, context) {
    return runOshFacilitySearchCheck(store, oshInputFromConfig(target.target_config), {
      checkTargetId: target.check_target_id,
      targetConfig: target.target_config,
      ...(context.logger === undefined ? {} : { logger: context.logger })
    });
  }
};

interface OshCheckOptions {
  checkTargetId: string;
  targetConfig: Record<string, unknown>;
  logger?: SourceCheckConnectorLogger;
}

async function runOshFacilitySearchCheck(store: DatabaseStore, input: OshFacilitySearchInput, options: OshCheckOptions): Promise<SourceCheckSummary[]> {
  const context = createOshAdapterContext();
  const summaries: SourceCheckSummary[] = [];
  const logger = options.logger ?? getLogger();
  try {
    for await (const task of oshAdapter.plan(input, context)) {
      logger.info({ stage: "source-check", adapter: oshAdapter.id, task_id: task.task_id }, "checking OSH facility source task");
      const raw = await oshAdapter.fetch(task, context);
      const normalized = await oshAdapter.normalize(raw, context);
      const candidates = parseOshFacilityCandidates(raw.body, normalized.source_url);
      const { saved, documentObservation, storedObservations, reviewCandidates } = await store.transaction(async (client) => {
        const savedDocument = await saveNormalizedDocumentTx(client, normalized);
        const savedObservation = await recordSavedDocumentObservation(client, normalized, savedDocument.doc_id, { checkTargetId: options.checkTargetId });
        const observationResult = await storeOshFacilityObservations(client, candidates, {
          docId: savedDocument.doc_id,
          sourceItemId: savedObservation.source_item_id,
          sourceUrl: normalized.source_url,
          query: input.query,
          targetConfig: options.targetConfig
        });
        const enqueueResult = await enqueueReviewCandidates(client, observationResult.reviewCandidates);
        return {
          saved: savedDocument,
          documentObservation: savedObservation,
          storedObservations: observationResult.observations,
          reviewCandidates: enqueueResult.inserted
        };
      });
      summaries.push({
        source_adapter_id: oshAdapter.id,
        task_id: task.task_id,
        doc_id: saved.doc_id,
        source_url: normalized.source_url,
        change_type: documentObservation.change_type,
        source_item_id: documentObservation.source_item_id,
        source_event_id: documentObservation.event_id,
        observations: storedObservations,
        review_candidates: reviewCandidates,
        semantic_changes: 0,
        relation_changes: 0
      });
    }
    return summaries;
  } catch (error) {
    await store.transaction(async (client) => {
      await recordSourceFailure(client, {
        source_adapter_id: oshAdapter.id,
        check_target_id: options.checkTargetId,
        error_message: messageFromUnknown(error),
        caused_by: "source-check.osh"
      });
    });
    throw error;
  }
}

async function storeOshFacilityObservations(
  client: DbClient,
  candidates: readonly OshFacilityCandidate[],
  input: { docId: string; sourceItemId: string; sourceUrl: string; query: string; targetConfig: Record<string, unknown> }
): Promise<{ observations: number; reviewCandidates: ReturnType<typeof buildOshFacilityReviewCandidate>[] }> {
  const reviewCandidates: ReturnType<typeof buildOshFacilityReviewCandidate>[] = [];
  let observations = 0;
  for (const candidate of candidates) {
    // OSH contributor 声明只证明设施候选和地理/行业背景，不能直接生成供应关系事实边。
    const observation = await storeObservation(client, {
      observation_type: "FACILITY_PROFILE_OBSERVATION",
      source_adapter_id: "osh",
      source_item_id: input.sourceItemId,
      doc_id: input.docId,
      scope_kind: "facility",
      scope_id: `OSH-${candidate.os_id}`,
      ...(candidate.country_code === undefined ? {} : { geography_kind: "country", geography_id: candidate.country_code }),
      metric_name: "osh.facility.profile",
      confidence: 0.72,
      provenance: {
        source_url: candidate.source_url,
        query: input.query,
        os_id: candidate.os_id,
        name: candidate.name,
        address: candidate.address,
        country_code: candidate.country_code,
        country_name: candidate.country_name,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        contributors: candidate.contributors,
        sector: candidate.sector,
        product_type: candidate.product_type,
        no_company_edge: true
      },
      attrs: {
        semantic_layer: "observation",
        facility_candidate: true,
        source_query: input.query,
        target_scope_id: optionalConfigString(input.targetConfig, "scope_id", "OSH source check target")
      }
    });
    observations += 1;
    const sourceLeadId = optionalConfigString(input.targetConfig, "lead_id", "OSH source check target");
    const targetScopeId = optionalConfigString(input.targetConfig, "scope_id", "OSH source check target");
    const sourceSupplierName = optionalConfigString(input.targetConfig, "source_supplier_name", "OSH source check target");
    const sourceLocationText = optionalConfigString(input.targetConfig, "source_location_text", "OSH source check target");
    const sourceCountryOrRegion = optionalConfigString(input.targetConfig, "source_country_or_region", "OSH source check target");
    reviewCandidates.push(
      buildOshFacilityReviewCandidate({
        candidate,
        docId: input.docId,
        sourceItemId: input.sourceItemId,
        observationId: observation.id,
        sourceUrl: input.sourceUrl,
        query: input.query,
        ...(sourceLeadId === undefined ? {} : { sourceLeadId }),
        ...(targetScopeId === undefined ? {} : { targetScopeId }),
        ...(sourceSupplierName === undefined ? {} : { sourceSupplierName }),
        ...(sourceLocationText === undefined ? {} : { sourceLocationText }),
        ...(sourceCountryOrRegion === undefined ? {} : { sourceCountryOrRegion })
      })
    );
  }
  return { observations, reviewCandidates };
}

export function oshInputFromConfig(config: Record<string, unknown>): OshFacilitySearchInput {
  const label = "OSH source check target";
  const countryCode = optionalConfigString(config, "country_code", label);
  const sector = optionalConfigString(config, "sector", label);
  const page = optionalConfigPositiveInteger(config, "page", label);
  const pageSize = optionalConfigPositiveInteger(config, "page_size", label);
  return {
    query: requireConfigString(config, "query", label),
    ...(countryCode === undefined ? {} : { countryCode }),
    ...(sector === undefined ? {} : { sector }),
    ...(page === undefined ? {} : { page }),
    ...(pageSize === undefined ? {} : { pageSize })
  };
}

function optionalConfigString(config: Record<string, unknown>, key: string, label: string): string | undefined {
  const value = config[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} ${key} must be a non-empty string`);
  return value.trim();
}
