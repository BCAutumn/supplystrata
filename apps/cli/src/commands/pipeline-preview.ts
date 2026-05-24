import type { Command } from "commander";
import type { DatabaseStore } from "@supplystrata/db/write";
import type { GraphSyncMode } from "@supplystrata/graph-builder";
import { messageFromUnknown } from "@supplystrata/observability";
import { runSupplyChainPipelineFromNormalized, type PipelineSummary } from "@supplystrata/pipeline";
import { recordSourceFailure } from "@supplystrata/source-monitor";
import {
  fetchAndParseSecEdgar,
  NVIDIA_SEC_10K_EXAMPLE_PROFILE,
  previewAppleSuppliers,
  previewNvidiaResearchReport,
  previewSecEdgarSupplyChain,
  previewSecEdgarSupplyChainProfile
} from "@supplystrata/source-workflows";
import {
  isSupportedFormType,
  parseFormat,
  parseGraphSyncMode,
  parseLanguage,
  parseLimit,
  parsePositiveInteger,
  parsePreviewFormat,
  withDatabase,
  write,
  writeJson
} from "../cli-utils.js";
import { currentIsoTimestamp } from "../cli-clock.js";
import { createCliNeo4jGraphStore } from "../graph-store.js";
import { renderAppleSuppliersPreview, renderPreview, renderResearchReport } from "../preview-render.js";
import { sourceWorkflowRuntime, type CliSourceWorkflowRuntime } from "../source-workflow-runtime.js";

export function registerPipelinePreviewCommands(program: Command): void {
  registerExampleCommands(program);
  const ingest = program.command("ingest").description("ingestion commands");
  ingest
    .command("sec-edgar")
    .requiredOption("--cik <cik>", "SEC CIK")
    .requiredOption("--entity <entityId>", "primary entity id")
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

  const preview = program.command("preview").description("database-free supply-chain parsing previews");
  preview
    .command("apple-suppliers")
    .requiredOption("--entity <entityId>", "buyer entity id; Apple Supplier List currently supports ENT-APPLE")
    .requiredOption("--fiscal-year <year>", "Apple Supplier List fiscal year; currently supports 2022")
    .option("--format <format>", "markdown, json, or csv", "markdown")
    .option("--limit <count>", "max rows for markdown preview", "25")
    .description("preview supplier-list semi-auto candidates from the Apple Supplier List source")
    .action(async (options: { entity: string; fiscalYear: string; format: string; limit: string }) => {
      const result = await previewAppleSuppliers(sourceWorkflowRuntime(), appleSuppliersInputFromCli(options));
      write(renderAppleSuppliersPreview(result, parsePreviewFormat(options.format), parseLimit(options.limit)));
    });
  preview
    .command("sec-edgar")
    .requiredOption("--cik <cik>", "SEC CIK")
    .requiredOption("--entity <entityId>", "primary entity id")
    .option("--types <types>", "comma separated filing types", "10-K")
    .option("--format <format>", "markdown or json", "markdown")
    .description("preview SEC EDGAR supply-chain parsing without database")
    .action(async (options: { cik: string; entity: string; types: string; format: string }) => {
      const formTypes = parseFormTypes(options.types);
      const result = await previewSecEdgarSupplyChain({ cik: options.cik, entityId: options.entity, formTypes }, sourceWorkflowRuntime());
      write(renderPreview(result, parseFormat(options.format)));
    });
}

function registerExampleCommands(program: Command): void {
  const examples = program.command("examples").description("curated example profiles; not generic ingestion defaults");
  const nvidia = examples.command("nvidia").description("NVIDIA SEC 10-K / AI memory example profile");
  nvidia
    .command("preview")
    .option("--format <format>", "markdown or json", "markdown")
    .description("preview the NVIDIA SEC 10-K example without database writes")
    .action(runNvidiaExamplePreview);
  nvidia
    .command("ingest")
    .option("--graph-sync <mode>", "GraphStore projection sync mode: defer or sync", "defer")
    .description("run the NVIDIA SEC 10-K example through the vertical pipeline")
    .action(runNvidiaExampleIngest);
  nvidia
    .command("report")
    .option("--format <format>", "markdown or json", "markdown")
    .option("--lang <lang>", "en or zh", "en")
    .description("preview the NVIDIA research memo example")
    .action(runNvidiaExampleReport);

  const apple = examples.command("apple-suppliers").description("Apple Supplier List FY2022 semi-auto example");
  apple
    .command("preview")
    .option("--format <format>", "markdown, json, or csv", "markdown")
    .option("--limit <count>", "max rows for markdown preview", "25")
    .description("preview the Apple Supplier List example with explicit source input")
    .action(async (options: { format: string; limit: string }) => {
      const result = await previewAppleSuppliers(sourceWorkflowRuntime(), { fiscalYear: 2022, entityId: "ENT-APPLE" });
      write(renderAppleSuppliersPreview(result, parsePreviewFormat(options.format), parseLimit(options.limit)));
    });
}

async function runNvidiaExamplePreview(options: { format: string }): Promise<void> {
  const result = await previewSecEdgarSupplyChainProfile(NVIDIA_SEC_10K_EXAMPLE_PROFILE, sourceWorkflowRuntime());
  write(renderPreview(result, parseFormat(options.format)));
}

async function runNvidiaExampleIngest(options: { graphSync: string }): Promise<void> {
  await withDatabase(async (pool) => {
    const graphSyncMode = parseGraphSyncMode(options.graphSync);
    const summary = await runSecEdgarPipeline(pool, NVIDIA_SEC_10K_EXAMPLE_PROFILE.input, graphOptions(graphSyncMode));
    writeJson(summary);
  });
}

async function runNvidiaExampleReport(options: { format: string; lang: string }): Promise<void> {
  const result = await previewNvidiaResearchReport(sourceWorkflowRuntime());
  write(renderResearchReport(result, parseFormat(options.format), parseLanguage(options.lang)));
}

function parseFormTypes(value: string): ("10-K" | "10-Q" | "20-F" | "8-K")[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(isSupportedFormType);
}

function appleSuppliersInputFromCli(options: { entity: string; fiscalYear: string }): { fiscalYear: number; entityId: string } {
  return {
    fiscalYear: parsePositiveInteger(options.fiscalYear, "Apple Supplier List fiscal year"),
    entityId: options.entity
  };
}

interface SecPipelineInput {
  cik: string;
  entityId: string;
  formTypes: readonly ("10-K" | "10-Q" | "20-F" | "8-K")[];
}

interface SecPipelineOptions {
  adapterContextInput: CliSourceWorkflowRuntime["adapterContextInput"];
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
        failed_at: currentIsoTimestamp(),
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

function graphOptions(graphSyncMode: GraphSyncMode): SecPipelineOptions {
  const runtime = sourceWorkflowRuntime();
  if (graphSyncMode === "defer") return { graphSyncMode, ...runtime };
  return { graphSyncMode, graphStore: createCliNeo4jGraphStore(), ...runtime };
}
