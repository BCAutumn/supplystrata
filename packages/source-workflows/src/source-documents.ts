import { secFormTypeOrDefault, type DocumentType, type FetchTask, type NormalizedDocument, type RawDocument } from "@supplystrata/core";
import { getLogger } from "@supplystrata/observability";
import { createAdapterContext, secEdgarAdapter, type SecEdgarInput } from "@supplystrata/sources-sec-edgar";
import type { AdapterContext, SourceAdapter } from "@supplystrata/source-adapter-spec";
import type { SourceCheckConnectorLogger } from "@supplystrata/source-connectors";

export interface FetchAndNormalizeInput<TInput> {
  adapter: SourceAdapter<TInput, Uint8Array>;
  input: TInput;
  context: AdapterContext;
  logLabel: string;
  logger?: SourceCheckConnectorLogger;
}

export interface FetchedNormalizedDocument {
  raw: RawDocument<Uint8Array>;
  normalized: NormalizedDocument;
  sourceDate?: string;
}

export interface FetchedSecDocument {
  raw: Awaited<ReturnType<typeof secEdgarAdapter.fetch>>;
  normalized: NormalizedDocument;
  documentType: DocumentType;
  sourceDate?: string;
}

export async function fetchAndNormalizeFirstTask<TInput>(input: FetchAndNormalizeInput<TInput>): Promise<FetchedNormalizedDocument> {
  const task = await firstPlannedTask(input.adapter, input.input, input.context);
  const logger = input.logger ?? getLogger();
  logger.info({ stage: "ingest", adapter: input.adapter.id, task_id: task.task_id }, `fetching ${input.logLabel}`);
  const raw = await input.adapter.fetch(task, input.context);
  const normalized = await input.adapter.normalize(raw, input.context);
  const sourceDate = typeof raw.metadata["source_date"] === "string" ? raw.metadata["source_date"] : undefined;
  return { raw, normalized, ...(sourceDate === undefined ? {} : { sourceDate }) };
}

export async function fetchAndParseSecEdgar(input: SecEdgarInput, options: { logger?: SourceCheckConnectorLogger } = {}): Promise<FetchedSecDocument> {
  const context = createAdapterContext();
  const task = await firstPlannedTask(secEdgarAdapter, input, context);
  const logger = options.logger ?? getLogger();
  logger.info({ stage: "ingest", adapter: "sec-edgar", task_id: task.task_id }, "fetching SEC filing");
  const raw = await secEdgarAdapter.fetch(task, context);
  const documentType = readDocumentType(raw.metadata["document_type"]);
  const sourceDate = typeof raw.metadata["source_date"] === "string" ? raw.metadata["source_date"] : undefined;
  const normalized = await secEdgarAdapter.normalize(raw, context);
  return { raw, normalized, documentType, ...(sourceDate === undefined ? {} : { sourceDate }) };
}

async function firstPlannedTask<TInput>(adapter: SourceAdapter<TInput, Uint8Array>, input: TInput, context: AdapterContext): Promise<FetchTask> {
  for await (const task of adapter.plan(input, context)) {
    return task;
  }
  throw new Error(`${adapter.id} adapter produced no fetch task`);
}

function readDocumentType(value: unknown): DocumentType {
  return secFormTypeOrDefault(value);
}
