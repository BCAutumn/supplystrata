import { saveNormalizedDocument, type DatabaseStore, type DbClient } from "@supplystrata/db";
import { getLogger } from "@supplystrata/observability";
import { storeObservation } from "@supplystrata/observation-store";
import { recordSourceFailure } from "@supplystrata/source-monitor";
import { optionalConfigPositiveInteger, requireConfigString, type SourceCheckConnector } from "@supplystrata/source-connectors";
import {
  createOshAdapterContext,
  oshAdapter,
  parseOshFacilityCandidates,
  type OshFacilityCandidate,
  type OshFacilitySearchInput
} from "@supplystrata/sources-osh";
import { recordSavedDocumentObservation } from "./document-observations.js";
import type { SourceCheckSummary } from "./source-check-runner.js";

export const oshSourceCheckConnector: SourceCheckConnector<DatabaseStore, SourceCheckSummary> = {
  source_adapter_id: "osh",
  target_kind: "facility-search",
  run(store, target) {
    return runOshFacilitySearchCheck(store, oshInputFromConfig(target.target_config), {
      checkTargetId: target.check_target_id,
      targetConfig: target.target_config
    });
  }
};

interface OshCheckOptions {
  checkTargetId: string;
  targetConfig: Record<string, unknown>;
}

async function runOshFacilitySearchCheck(store: DatabaseStore, input: OshFacilitySearchInput, options: OshCheckOptions): Promise<SourceCheckSummary[]> {
  const context = createOshAdapterContext();
  const summaries: SourceCheckSummary[] = [];
  try {
    for await (const task of oshAdapter.plan(input, context)) {
      getLogger().info({ stage: "source-check", adapter: oshAdapter.id, task_id: task.task_id }, "checking OSH facility source task");
      const raw = await oshAdapter.fetch(task, context);
      const normalized = await oshAdapter.normalize(raw, context);
      const candidates = parseOshFacilityCandidates(raw.body, normalized.source_url);
      const { saved, documentObservation, storedObservations } = await store.transaction(async (client) => {
        const savedDocument = await saveNormalizedDocument(client, normalized);
        const savedObservation = await recordSavedDocumentObservation(client, normalized, savedDocument.doc_id, { checkTargetId: options.checkTargetId });
        const observationCount = await storeOshFacilityObservations(client, candidates, {
          docId: savedDocument.doc_id,
          sourceItemId: savedObservation.source_item_id,
          query: input.query,
          targetConfig: options.targetConfig
        });
        return { saved: savedDocument, documentObservation: savedObservation, storedObservations: observationCount };
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
        semantic_changes: 0,
        relation_changes: 0
      });
    }
    return summaries;
  } catch (error) {
    await recordSourceFailure(store, {
      source_adapter_id: oshAdapter.id,
      check_target_id: options.checkTargetId,
      error_message: messageFromUnknown(error),
      caused_by: "source-check.osh"
    });
    throw error;
  }
}

async function storeOshFacilityObservations(
  client: DbClient,
  candidates: readonly OshFacilityCandidate[],
  input: { docId: string; sourceItemId: string; query: string; targetConfig: Record<string, unknown> }
): Promise<number> {
  let count = 0;
  for (const candidate of candidates) {
    // OSH contributor 声明只证明设施候选和地理/行业背景，不能直接生成供应关系事实边。
    await storeObservation(client, {
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
    count += 1;
  }
  return count;
}

function oshInputFromConfig(config: Record<string, unknown>): OshFacilitySearchInput {
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

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}
