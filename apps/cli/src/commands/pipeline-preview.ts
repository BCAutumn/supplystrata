import type { Command } from "commander";
import { loadEnv } from "@supplystrata/config";
import type { DatabaseStore } from "@supplystrata/db";
import type { GraphSyncMode } from "@supplystrata/graph-builder";
import { runSupplyChainPipelineFromNormalized, type PipelineSummary } from "@supplystrata/pipeline";
import { recordSourceFailure } from "@supplystrata/source-monitor";
import {
  fetchAndParseSecEdgar,
  previewAppleSuppliers,
  previewDefaultNvidiaSlice,
  previewNvidiaResearchReport,
  previewSecEdgarSupplyChain,
  sourceWorkflowAdapterContextInput
} from "@supplystrata/source-workflows";
import {
  isSupportedFormType,
  parseFormat,
  parseGraphSyncMode,
  parseLanguage,
  parseLimit,
  parsePreviewFormat,
  withDatabase,
  write,
  writeJson
} from "../cli-utils.js";
import { createCliNeo4jGraphStore } from "../graph-store.js";
import { renderAppleSuppliersPreview, renderPreview, renderResearchReport } from "../preview-render.js";

export function registerPipelinePreviewCommands(program: Command): void {
  const ingest = program.command("ingest").description("ingestion commands");
  ingest
    .command("sec-edgar")
    .requiredOption("--cik <cik>", "SEC CIK")
    .option("--entity <entityId>", "primary entity id", "ENT-NVIDIA")
    .option("--types <types>", "comma separated filing types", "10-K")
    .option("--graph-sync <mode>", "GraphStore projection sync mode: defer or sync", "defer")
    .description("fetch latest matching SEC filing and run the vertical pipeline")
    .action(async (options: { cik: string; entity: string; types: string; graphSync: string }) => {
      await withDatabase(async (pool) => {
        const formTypes = parseFormTypes(options.types);
        const graphSyncMode = parseGraphSyncMode(options.graphSync);
        const summary = await runSecEdgarPipeline(pool, { cik: options.cik, entityId: options.entity, formTypes }, graphOptions(graphSyncMode));
        writeJson(summary);
      });
    });

  const pipeline = program.command("pipeline").description("pipeline shortcuts");
  pipeline
    .command("nvidia")
    .option("--graph-sync <mode>", "GraphStore projection sync mode: defer or sync", "defer")
    .description("run SEC/NVIDIA 10-K vertical slice")
    .action(async (options: { graphSync: string }) => {
      await withDatabase(async (pool) => {
        const graphSyncMode = parseGraphSyncMode(options.graphSync);
        const summary = await runDefaultNvidiaSlice(pool, graphOptions(graphSyncMode));
        writeJson(summary);
      });
    });

  const preview = program.command("preview").description("database-free supply-chain parsing previews");
  preview
    .command("nvidia")
    .option("--format <format>", "markdown or json", "markdown")
    .description("preview NVIDIA SEC 10-K parsing without database")
    .action(async (options: { format: string }) => {
      const result = await previewDefaultNvidiaSlice(sourceWorkflowRuntime());
      write(renderPreview(result, parseFormat(options.format)));
    });

  preview
    .command("apple-suppliers")
    .option("--format <format>", "markdown, json, or csv", "markdown")
    .option("--limit <count>", "max rows for markdown preview", "25")
    .description("preview Apple Supplier List semi-auto candidates")
    .action(async (options: { format: string; limit: string }) => {
      const result = await previewAppleSuppliers(sourceWorkflowRuntime());
      write(renderAppleSuppliersPreview(result, parsePreviewFormat(options.format), parseLimit(options.limit)));
    });

  const previewReport = preview.command("report").description("database-free research reports");
  previewReport
    .command("nvidia")
    .option("--format <format>", "markdown or json", "markdown")
    .option("--lang <lang>", "en or zh", "en")
    .description("preview an NVIDIA supply-chain research memo")
    .action(async (options: { format: string; lang: string }) => {
      const result = await previewNvidiaResearchReport(sourceWorkflowRuntime());
      write(renderResearchReport(result, parseFormat(options.format), parseLanguage(options.lang)));
    });

  preview
    .command("sec-edgar")
    .requiredOption("--cik <cik>", "SEC CIK")
    .option("--entity <entityId>", "primary entity id", "ENT-NVIDIA")
    .option("--types <types>", "comma separated filing types", "10-K")
    .option("--format <format>", "markdown or json", "markdown")
    .description("preview SEC EDGAR supply-chain parsing without database")
    .action(async (options: { cik: string; entity: string; types: string; format: string }) => {
      const formTypes = parseFormTypes(options.types);
      const result = await previewSecEdgarSupplyChain({ cik: options.cik, entityId: options.entity, formTypes }, sourceWorkflowRuntime());
      write(renderPreview(result, parseFormat(options.format)));
    });
}

function parseFormTypes(value: string): ("10-K" | "10-Q" | "20-F" | "8-K")[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(isSupportedFormType);
}

interface SecPipelineInput {
  cik: string;
  entityId: string;
  formTypes: ("10-K" | "10-Q" | "20-F" | "8-K")[];
}

interface SecPipelineOptions {
  adapterContextInput: ReturnType<typeof sourceWorkflowAdapterContextInput>;
  graphSyncMode?: GraphSyncMode;
  graphStore?: ReturnType<typeof createCliNeo4jGraphStore>;
}

async function runSecEdgarPipeline(store: DatabaseStore, input: SecPipelineInput, options: SecPipelineOptions): Promise<PipelineSummary> {
  let fetched: Awaited<ReturnType<typeof fetchAndParseSecEdgar>>;
  try {
    fetched = await fetchAndParseSecEdgar(input, { adapterContextInput: options.adapterContextInput });
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

function runDefaultNvidiaSlice(store: DatabaseStore, options: SecPipelineOptions): Promise<PipelineSummary> {
  return runSecEdgarPipeline(store, { cik: "0001045810", entityId: "ENT-NVIDIA", formTypes: ["10-K"] }, options);
}

function graphOptions(graphSyncMode: GraphSyncMode): SecPipelineOptions {
  const runtime = sourceWorkflowRuntime();
  if (graphSyncMode === "defer") return { graphSyncMode, ...runtime };
  return { graphSyncMode, graphStore: createCliNeo4jGraphStore(), ...runtime };
}

function sourceWorkflowRuntime(): { adapterContextInput: ReturnType<typeof sourceWorkflowAdapterContextInput> } {
  return { adapterContextInput: sourceWorkflowAdapterContextInput(loadEnv()) };
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
