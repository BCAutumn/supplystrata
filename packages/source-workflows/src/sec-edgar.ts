import { loadEnv } from "@supplystrata/config";
import type { DatabaseStore } from "@supplystrata/db";
import type { GraphSyncMode } from "@supplystrata/graph-builder";
import type { GraphStore } from "@supplystrata/graph-store";
import { getLogger, messageFromUnknown } from "@supplystrata/observability";
import { recordSourceFailure } from "@supplystrata/source-monitor";
import { optionalConfigPositiveInteger, requireConfigString, requireConfigStringArray, type SourceCheckConnector } from "@supplystrata/source-connectors";
import { isSecEdgarFormType, type SecEdgarFormType, type SecEdgarInput } from "@supplystrata/sources-sec-edgar";
import { createAdapterContext, secEdgarAdapter } from "@supplystrata/sources-sec-edgar";
import { runSupplyChainPipelineFromNormalized, type PipelineSummary } from "@supplystrata/pipeline";
import { fetchAndParseSecEdgar } from "./source-documents.js";
import { runSourceAdapterCheck, type SourceCheckSummary } from "./source-check-runner.js";

export interface SourceCheckOptions {
  checkTargetId?: string;
}

export const secEdgarSourceCheckConnector: SourceCheckConnector<DatabaseStore, SourceCheckSummary> = {
  source_adapter_id: "sec-edgar",
  target_kind: "sec-company-filings",
  run(store, target) {
    return checkSecEdgarSource(store, secEdgarInputFromTargetConfig(target.target_config), { checkTargetId: target.check_target_id });
  }
};

export async function runSecEdgarPipeline(
  store: DatabaseStore,
  input: SecEdgarInput,
  options: { graphSyncMode?: GraphSyncMode; graphStore?: GraphStore } = {}
): Promise<PipelineSummary> {
  let fetched: Awaited<ReturnType<typeof fetchAndParseSecEdgar>>;
  try {
    fetched = await fetchAndParseSecEdgar(input);
  } catch (error) {
    await store.transaction(async (client) => {
      await recordSourceFailure(client, {
        source_adapter_id: "sec-edgar",
        error_message: messageFromUnknown(error),
        caused_by: "pipeline.sec-edgar"
      });
    });
    throw error;
  }
  return runSupplyChainPipelineFromNormalized(store, {
    normalized: fetched.normalized,
    fetchedUrl: fetched.raw.url,
    ...(options.graphSyncMode === undefined ? {} : { graphSyncMode: options.graphSyncMode }),
    ...(options.graphStore === undefined ? {} : { graphStore: options.graphStore })
  });
}

export async function runDefaultNvidiaSlice(
  store: DatabaseStore,
  options: { graphSyncMode?: GraphSyncMode; graphStore?: GraphStore } = {}
): Promise<PipelineSummary> {
  const env = loadEnv();
  getLogger().info({ stage: "pipeline", llm_provider: env.LLM_PROVIDER }, "running default NVIDIA SEC slice");
  return runSecEdgarPipeline(store, { cik: "0001045810", entityId: "ENT-NVIDIA", formTypes: ["10-K"] }, options);
}

export async function checkSecEdgarSource(store: DatabaseStore, input: SecEdgarInput, options: SourceCheckOptions = {}): Promise<SourceCheckSummary[]> {
  const context = createAdapterContext();
  return runSourceAdapterCheck(store, {
    adapter: secEdgarAdapter,
    adapterInput: input,
    context,
    options: { ...options, failureCausedBy: "source-check.sec-edgar" }
  });
}

function secEdgarInputFromTargetConfig(config: Record<string, unknown>): SecEdgarInput {
  const label = "SEC source check target";
  const cik = requireConfigString(config, "cik", label);
  const entityId = requireConfigString(config, "entity_id", label);
  const formTypes = requireSecForms(config);
  const limit = optionalConfigPositiveInteger(config, "limit", label);
  return {
    cik,
    entityId,
    formTypes,
    ...(limit === undefined ? {} : { limit })
  };
}

function requireSecForms(config: Record<string, unknown>): SecEdgarFormType[] {
  const forms: SecEdgarFormType[] = [];
  for (const item of requireConfigStringArray(config, "form_types", "SEC source check target")) {
    if (!isSecEdgarFormType(item)) throw new Error(`Unsupported SEC source check form type: ${item}`);
    forms.push(item);
  }
  return [...new Set(forms)];
}
