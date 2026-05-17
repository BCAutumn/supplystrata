import type pg from "pg";
import { loadEnv } from "@supplystrata/config";
import {
  type ApprovedCandidate,
  type CandidateRelation,
  type DocumentType,
  type FetchTask,
  type NormalizedDocument,
  type RawDocument,
  type ResolveResult
} from "@supplystrata/core";
import { saveNormalizedDocument } from "@supplystrata/db";
import { DbEntityResolver, SeedEntityResolver } from "@supplystrata/entity-resolver";
import { DeterministicEvidenceScorer } from "@supplystrata/evidence-scorer";
import { GraphBuilder } from "@supplystrata/graph-builder";
import { getLogger } from "@supplystrata/observability";
import { ruleExtractors } from "@supplystrata/relation-extractor-rule";
import { buildSupplierListReviewCandidate } from "@supplystrata/review-candidates";
import { enqueueReviewCandidates } from "@supplystrata/review-store";
import {
  extractAsmlSignalsFromText,
  extractSamsungSignalsFromText,
  extractSkHynixSignalsFromText,
  extractTsmcIrSignalsFromText,
  type OfficialDisclosureSignal
} from "@supplystrata/signal-extractor";
import { recordDocumentObservation } from "@supplystrata/source-monitor";
import {
  appleSuppliersAdapter,
  createAppleSuppliersAdapterContext,
  extractAppleSupplierCandidates,
  type AppleSupplierCandidate,
  type AppleSuppliersInput
} from "@supplystrata/sources-apple-suppliers";
import { asmlIrAdapter, createAsmlIrAdapterContext, type AsmlIrInput } from "@supplystrata/sources-asml-ir";
import { createSamsungIrAdapterContext, samsungIrAdapter, type SamsungIrInput } from "@supplystrata/sources-samsung-ir";
import { createAdapterContext, secEdgarAdapter, type SecEdgarInput } from "@supplystrata/sources-sec-edgar";
import { createSkHynixIrAdapterContext, skHynixIrAdapter, type SkHynixIrInput } from "@supplystrata/sources-skhynix-ir";
import { createTsmcIrAdapterContext, tsmcIrAdapter, type TsmcIrInput } from "@supplystrata/sources-tsmc-ir";
import type { AdapterContext, SourceAdapter } from "@supplystrata/source-adapter-spec";

export { enqueueEntitySourceReviewCandidates, lookupEntitySourceCandidates } from "./entity-sources.js";
export type { EntityLookupInput, EntityLookupSource, EntityLookupSummary, EntityReviewEnqueueSummary } from "./entity-sources.js";
export { applyApprovedReviewCandidate, applyApprovedReviewCandidates } from "./review-apply.js";
export type { AppliedReviewEdgeResult, ReviewApplyBatchItem, ReviewApplyBatchSummary, ReviewApplyResult } from "./review-apply.js";

export interface PipelineSummary {
  doc_id: string;
  fetched_url: string;
  chunks: number;
  candidates: number;
  applied_edges: number;
  evidence_ids: string[];
}

export interface NormalizedPipelineInput {
  normalized: NormalizedDocument;
  fetchedUrl?: string;
}

export interface SupplyChainPreviewCandidate {
  relation: CandidateRelation["relation"];
  subject_surface: string;
  subject_resolution: ResolveResult["status"];
  subject_entity_id?: string;
  subject_name?: string;
  object_surface: string;
  object_resolution: ResolveResult["status"];
  object_entity_id?: string;
  object_name?: string;
  component?: string;
  evidence_level: number;
  confidence: number;
  is_inferred: boolean;
  needs_review: boolean;
  extractor_id: string;
  cite_text: string;
  cite_locator: string;
}

export interface SupplyChainPreview {
  doc_id: string;
  fetched_url: string;
  document_type: DocumentType;
  source_date?: string;
  chunks: number;
  candidates: SupplyChainPreviewCandidate[];
}

export type TsmcIrSignal = OfficialDisclosureSignal;

export interface OfficialDisclosurePreview {
  doc_id: string;
  source_adapter_id: string;
  fetched_url: string;
  source_date?: string;
  chunks: number;
  signals: TsmcIrSignal[];
  error_message?: string;
}

export interface TsmcIrPreview {
  doc_id: string;
  fetched_url: string;
  source_date?: string;
  chunks: number;
  mentions_nvidia: boolean;
  signals: TsmcIrSignal[];
}

export interface NvidiaResearchReportPreview {
  nvidia: SupplyChainPreview;
  tsmc: TsmcIrPreview;
  samsung: OfficialDisclosurePreview;
  skhynix: OfficialDisclosurePreview;
  asml: OfficialDisclosurePreview;
}

export interface AppleSuppliersPreview {
  doc_id: string;
  fetched_url: string;
  source_date?: string;
  chunks: number;
  candidates: AppleSupplierCandidate[];
}

export interface ReviewEnqueueSummary {
  doc_id: string;
  source_url: string;
  candidates: number;
  inserted: number;
  skipped: number;
}

export async function runSecEdgarPipeline(pool: pg.Pool, input: SecEdgarInput): Promise<PipelineSummary> {
  const { raw, normalized } = await fetchAndParseSecEdgar(input);
  return runSupplyChainPipelineFromNormalized(pool, { normalized, fetchedUrl: raw.url });
}

export async function runSupplyChainPipelineFromNormalized(pool: pg.Pool, input: NormalizedPipelineInput): Promise<PipelineSummary> {
  const normalized = input.normalized;
  const savedDocument = await saveNormalizedDocument(pool, normalized);
  await recordSavedDocumentObservation(pool, normalized, savedDocument.doc_id);

  const resolver = new DbEntityResolver(pool);
  const scorer = new DeterministicEvidenceScorer();
  const graphBuilder = new GraphBuilder(pool, resolver);
  const evidenceIds: string[] = [];
  let candidates = 0;
  let applied = 0;

  try {
    for (const extractor of ruleExtractors) {
      for await (const candidate of extractor.extract(normalized)) {
        candidates += 1;
        if (!isValidCandidate(candidate, normalized.text)) {
          getLogger().warn({ stage: "extract", extractor: candidate.extractor_id }, "candidate rejected by local validation");
          continue;
        }
        const scoring = await scorer.score(candidate, normalized);
        if (scoring.needs_review) {
          getLogger().warn({ stage: "score", candidate: candidate.extractor_id }, "candidate needs review and was not auto-applied");
          continue;
        }
        const chunkId = savedDocument.chunks.find((chunk) => chunk.text.includes(candidate.cite_text))?.chunk_id;
        const approved: ApprovedCandidate = {
          candidate,
          scoring,
          approved_by: "auto",
          doc_id: savedDocument.doc_id,
          ...(chunkId === undefined ? {} : { chunk_id: chunkId })
        };
        const result = await graphBuilder.apply(approved);
        evidenceIds.push(result.evidence_id);
        applied += 1;
      }
    }
  } finally {
    await graphBuilder.close();
  }

  return {
    doc_id: savedDocument.doc_id,
    fetched_url: input.fetchedUrl ?? normalized.source_url,
    chunks: savedDocument.chunks.length,
    candidates,
    applied_edges: applied,
    evidence_ids: evidenceIds
  };
}

export async function previewSecEdgarSupplyChain(input: SecEdgarInput): Promise<SupplyChainPreview> {
  const { raw, normalized, documentType, sourceDate } = await fetchAndParseSecEdgar(input);
  const scorer = new DeterministicEvidenceScorer();
  const resolver = await SeedEntityResolver.fromCsv();
  const candidates: SupplyChainPreviewCandidate[] = [];

  for (const extractor of ruleExtractors) {
    for await (const candidate of extractor.extract(normalized)) {
      if (!isValidCandidate(candidate, normalized.text)) continue;
      const scoring = await scorer.score(candidate, normalized);
      const subject = await resolver.resolve(candidate.subject_resolve);
      const object = await resolver.resolve(candidate.object_resolve);
      const base = {
        relation: candidate.relation,
        subject_surface: candidate.subject_resolve.surface,
        subject_resolution: subject.status,
        ...resolvedPreviewFields("subject", subject, resolver),
        object_surface: candidate.object_resolve.surface,
        object_resolution: object.status,
        ...resolvedPreviewFields("object", object, resolver),
        evidence_level: scoring.evidence_level,
        confidence: scoring.confidence,
        is_inferred: scoring.is_inferred,
        needs_review: scoring.needs_review,
        extractor_id: candidate.extractor_id,
        cite_text: candidate.cite_text,
        cite_locator: candidate.cite_locator
      };
      candidates.push(candidate.component === undefined ? base : { ...base, component: candidate.component });
    }
  }

  return {
    doc_id: normalized.doc_id,
    fetched_url: raw.url,
    document_type: documentType,
    ...(sourceDate === undefined ? {} : { source_date: sourceDate }),
    chunks: normalized.chunks.length,
    candidates
  };
}

function resolvedPreviewFields(prefix: "subject" | "object", result: ResolveResult, resolver: SeedEntityResolver): Partial<SupplyChainPreviewCandidate> {
  if (result.status !== "resolved" || result.entity_id === undefined) return {};
  const name = resolver.displayName(result.entity_id);
  if (prefix === "subject") {
    return {
      subject_entity_id: result.entity_id,
      ...(name === undefined ? {} : { subject_name: name })
    };
  }
  return {
    object_entity_id: result.entity_id,
    ...(name === undefined ? {} : { object_name: name })
  };
}

export async function runDefaultNvidiaSlice(pool: pg.Pool): Promise<PipelineSummary> {
  const env = loadEnv();
  getLogger().info({ stage: "pipeline", llm_provider: env.LLM_PROVIDER }, "running default NVIDIA SEC slice");
  return runSecEdgarPipeline(pool, { cik: "0001045810", entityId: "ENT-NVIDIA", formTypes: ["10-K"] });
}

export async function previewDefaultNvidiaSlice(): Promise<SupplyChainPreview> {
  const env = loadEnv();
  getLogger().info({ stage: "preview", llm_provider: env.LLM_PROVIDER }, "previewing default NVIDIA SEC slice without database");
  return previewSecEdgarSupplyChain({ cik: "0001045810", entityId: "ENT-NVIDIA", formTypes: ["10-K"] });
}

export async function previewTsmcIr(input: TsmcIrInput = { year: 2025, entityId: "ENT-TSMC" }): Promise<TsmcIrPreview> {
  const { raw, normalized, sourceDate } = await fetchAndNormalizeFirstTask({
    adapter: tsmcIrAdapter,
    input,
    context: createTsmcIrAdapterContext(),
    logLabel: "TSMC IR annual report"
  });
  return {
    doc_id: normalized.doc_id,
    fetched_url: raw.url,
    ...(sourceDate === undefined ? {} : { source_date: sourceDate }),
    chunks: normalized.chunks.length,
    mentions_nvidia: /\bnvidia\b/i.test(normalized.text),
    signals: extractTsmcIrSignalsFromText(normalized.text)
  };
}

export async function previewNvidiaResearchReport(): Promise<NvidiaResearchReportPreview> {
  const [nvidia, tsmc, samsung, skhynix, asml] = await Promise.all([
    previewDefaultNvidiaSlice(),
    previewTsmcIr(),
    previewOptionalDisclosure("samsung-ir", previewSamsungIr),
    previewOptionalDisclosure("skhynix-ir", previewSkHynixIr),
    previewOptionalDisclosure("asml-ir", previewAsmlIr)
  ]);
  return { nvidia, tsmc, samsung, skhynix, asml };
}

async function previewOptionalDisclosure(sourceAdapterId: string, fn: () => Promise<OfficialDisclosurePreview>): Promise<OfficialDisclosurePreview> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    getLogger().warn({ stage: "preview", adapter: sourceAdapterId, error: message }, "optional disclosure source unavailable");
    return {
      doc_id: "",
      source_adapter_id: sourceAdapterId,
      fetched_url: "",
      chunks: 0,
      signals: [],
      error_message: message
    };
  }
}

export async function previewSamsungIr(input: SamsungIrInput = { year: 2025, entityId: "ENT-SAMSUNG-ELECTRONICS" }): Promise<OfficialDisclosurePreview> {
  return previewOfficialDisclosure({
    adapter: samsungIrAdapter,
    input,
    context: createSamsungIrAdapterContext(),
    logLabel: "Samsung official disclosure",
    extractSignals: extractSamsungSignalsFromText
  });
}

export async function previewSkHynixIr(input: SkHynixIrInput = { year: 2025, entityId: "ENT-SKHYNIX" }): Promise<OfficialDisclosurePreview> {
  return previewOfficialDisclosure({
    adapter: skHynixIrAdapter,
    input,
    context: createSkHynixIrAdapterContext(),
    logLabel: "SK hynix official disclosure",
    extractSignals: extractSkHynixSignalsFromText
  });
}

export async function previewAsmlIr(input: AsmlIrInput = { year: 2025, entityId: "ENT-ASML" }): Promise<OfficialDisclosurePreview> {
  return previewOfficialDisclosure({
    adapter: asmlIrAdapter,
    input,
    context: createAsmlIrAdapterContext(),
    logLabel: "ASML annual report",
    extractSignals: extractAsmlSignalsFromText
  });
}

export async function previewAppleSuppliers(input: AppleSuppliersInput = { fiscalYear: 2022, entityId: "ENT-APPLE" }): Promise<AppleSuppliersPreview> {
  const { raw, normalized, sourceDate } = await fetchAndNormalizeFirstTask({
    adapter: appleSuppliersAdapter,
    input,
    context: createAppleSuppliersAdapterContext(),
    logLabel: "Apple Supplier List"
  });
  return {
    doc_id: normalized.doc_id,
    fetched_url: raw.url,
    ...(sourceDate === undefined ? {} : { source_date: sourceDate }),
    chunks: normalized.chunks.length,
    candidates: extractAppleSupplierCandidates(normalized, input.fiscalYear)
  };
}

export async function enqueueAppleSupplierReviewCandidates(
  pool: pg.Pool,
  input: AppleSuppliersInput = { fiscalYear: 2022, entityId: "ENT-APPLE" }
): Promise<ReviewEnqueueSummary> {
  const { raw, normalized, sourceDate } = await fetchAndNormalizeFirstTask({
    adapter: appleSuppliersAdapter,
    input,
    context: createAppleSuppliersAdapterContext(),
    logLabel: "Apple Supplier List"
  });
  const saved = await saveNormalizedDocument(pool, normalized);
  await recordSavedDocumentObservation(pool, normalized, saved.doc_id);
  const candidates = extractAppleSupplierCandidates(normalized, input.fiscalYear).map((candidate) =>
    buildSupplierListReviewCandidate({
      candidate,
      docId: saved.doc_id,
      sourceUrl: raw.url,
      ...(sourceDate === undefined ? {} : { sourceDate })
    })
  );
  const result = await enqueueReviewCandidates(pool, candidates);
  return {
    doc_id: saved.doc_id,
    source_url: raw.url,
    candidates: candidates.length,
    inserted: result.inserted,
    skipped: result.skipped
  };
}

interface FetchAndNormalizeInput<TInput> {
  adapter: SourceAdapter<TInput, Uint8Array>;
  input: TInput;
  context: AdapterContext;
  logLabel: string;
}

interface FetchedNormalizedDocument {
  raw: RawDocument<Uint8Array>;
  normalized: NormalizedDocument;
  sourceDate?: string;
}

async function fetchAndNormalizeFirstTask<TInput>(input: FetchAndNormalizeInput<TInput>): Promise<FetchedNormalizedDocument> {
  const tasks: FetchTask[] = [];
  for await (const task of input.adapter.plan(input.input, input.context)) {
    tasks.push(task);
    break;
  }
  const task = tasks[0];
  if (task === undefined) throw new Error(`${input.adapter.id} adapter produced no fetch task`);
  getLogger().info({ stage: "ingest", adapter: input.adapter.id, task_id: task.task_id }, `fetching ${input.logLabel}`);
  const raw = await input.adapter.fetch(task, input.context);
  const normalized = await input.adapter.normalize(raw, input.context);
  const sourceDate = typeof raw.metadata["source_date"] === "string" ? raw.metadata["source_date"] : undefined;
  return { raw, normalized, ...(sourceDate === undefined ? {} : { sourceDate }) };
}

interface OfficialDisclosureInput<TInput> {
  adapter: SourceAdapter<TInput, Uint8Array>;
  input: TInput;
  context: AdapterContext;
  logLabel: string;
  extractSignals(text: string): OfficialDisclosureSignal[];
}

async function previewOfficialDisclosure<TInput>(input: OfficialDisclosureInput<TInput>): Promise<OfficialDisclosurePreview> {
  const { raw, normalized, sourceDate } = await fetchAndNormalizeFirstTask({
    adapter: input.adapter,
    input: input.input,
    context: input.context,
    logLabel: input.logLabel
  });
  return {
    doc_id: normalized.doc_id,
    source_adapter_id: raw.source_adapter_id,
    fetched_url: raw.url,
    ...(sourceDate === undefined ? {} : { source_date: sourceDate }),
    chunks: normalized.chunks.length,
    signals: input.extractSignals(normalized.text)
  };
}

async function recordSavedDocumentObservation(pool: pg.Pool, normalized: NormalizedDocument, docId: string): Promise<void> {
  await recordDocumentObservation(pool, {
    source_adapter_id: normalized.source_adapter_id,
    source_url: normalized.source_url,
    doc_id: docId,
    bytes_sha256: normalized.bytes_sha256,
    storage_key: normalized.storage_key,
    observed_at: normalized.fetched_at,
    caused_by: "pipeline"
  });
}

interface FetchedSecDocument {
  raw: Awaited<ReturnType<typeof secEdgarAdapter.fetch>>;
  normalized: NormalizedDocument;
  documentType: DocumentType;
  sourceDate?: string;
}

async function fetchAndParseSecEdgar(input: SecEdgarInput): Promise<FetchedSecDocument> {
  const ctx = createAdapterContext();
  const tasks: FetchTask[] = [];
  for await (const task of secEdgarAdapter.plan(input, ctx)) {
    tasks.push(task);
    break;
  }
  const task = tasks[0];
  if (task === undefined) throw new Error("SEC adapter produced no fetch task");

  getLogger().info({ stage: "ingest", adapter: "sec-edgar", task_id: task.task_id }, "fetching SEC filing");
  const raw = await secEdgarAdapter.fetch(task, ctx);
  const documentType = readDocumentType(raw.metadata["document_type"]);
  const sourceDate = typeof raw.metadata["source_date"] === "string" ? raw.metadata["source_date"] : undefined;
  const normalized = await secEdgarAdapter.normalize(raw, ctx);
  return { raw, normalized, documentType, ...(sourceDate === undefined ? {} : { sourceDate }) };
}

function isValidCandidate(candidate: CandidateRelation, documentText: string): boolean {
  return candidate.cite_text.length >= 30 && documentText.includes(candidate.cite_text);
}

function readDocumentType(value: unknown): DocumentType {
  if (value === "10-K" || value === "10-Q" || value === "20-F" || value === "8-K") return value;
  return "10-K";
}
