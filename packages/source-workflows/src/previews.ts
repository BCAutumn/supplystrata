import type { ResolveResult } from "@supplystrata/core";
import { SeedEntityResolver } from "@supplystrata/entity-resolver";
import { DeterministicEvidenceScorer } from "@supplystrata/evidence-scorer";
import { noopLogger } from "@supplystrata/observability";
import { ruleExtractors } from "@supplystrata/relation-extractor-rule";
import {
  extractAsmlSignalsFromText,
  extractSamsungSignalsFromText,
  extractSkHynixSignalsFromText,
  extractTsmcIrSignalsFromText,
  type OfficialDisclosureSignal
} from "@supplystrata/signal-extractor";
import {
  appleSuppliersAdapter,
  createAppleSuppliersAdapterContext,
  extractAppleSupplierCandidates,
  type AppleSuppliersInput
} from "@supplystrata/sources-apple-suppliers";
import type { SecEdgarInput } from "@supplystrata/sources-sec-edgar";
import type { AdapterContext, SourceAdapter } from "@supplystrata/source-adapter-spec";
import { isValidCandidate as validateCandidate } from "@supplystrata/pipeline";
import {
  asmlIrAdapter,
  createOfficialIrAdapterContext,
  samsungIrAdapter,
  skHynixIrAdapter,
  tsmcIrAdapter,
  type AsmlIrInput,
  type SamsungIrInput,
  type SkHynixIrInput,
  type TsmcIrInput
} from "./official-ir-adapters.js";
import { sourceWorkflowAdapterContextInputFromEnv } from "./adapter-context.js";
import { fetchAndNormalizeFirstTask, fetchAndParseSecEdgar } from "./source-documents.js";
import type {
  AppleSuppliersPreview,
  NvidiaResearchReportPreview,
  OfficialDisclosurePreview,
  SupplyChainPreview,
  SupplyChainPreviewCandidate,
  TsmcIrPreview
} from "./types.js";

export async function previewSecEdgarSupplyChain(input: SecEdgarInput): Promise<SupplyChainPreview> {
  const { raw, normalized, documentType, sourceDate } = await fetchAndParseSecEdgar(input);
  const scorer = new DeterministicEvidenceScorer();
  const resolver = await SeedEntityResolver.fromCsv();
  const candidates: SupplyChainPreviewCandidate[] = [];

  for (const extractor of ruleExtractors) {
    for await (const candidate of extractor.extract(normalized)) {
      if (!validateCandidate(candidate, normalized.text)) continue;
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

export async function previewDefaultNvidiaSlice(): Promise<SupplyChainPreview> {
  return previewSecEdgarSupplyChain({ cik: "0001045810", entityId: "ENT-NVIDIA", formTypes: ["10-K"] });
}

export async function previewTsmcIr(input: TsmcIrInput = { year: 2025, entityId: "ENT-TSMC" }): Promise<TsmcIrPreview> {
  const { raw, normalized, sourceDate } = await fetchAndNormalizeFirstTask({
    adapter: tsmcIrAdapter,
    input,
    context: createOfficialIrAdapterContext(),
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

export async function previewSamsungIr(input: SamsungIrInput = { year: 2025, entityId: "ENT-SAMSUNG-ELECTRONICS" }): Promise<OfficialDisclosurePreview> {
  return previewOfficialDisclosure({
    adapter: samsungIrAdapter,
    input,
    context: createOfficialIrAdapterContext(),
    logLabel: "Samsung official disclosure",
    extractSignals: extractSamsungSignalsFromText
  });
}

export async function previewSkHynixIr(input: SkHynixIrInput = { year: 2025, entityId: "ENT-SKHYNIX" }): Promise<OfficialDisclosurePreview> {
  return previewOfficialDisclosure({
    adapter: skHynixIrAdapter,
    input,
    context: createOfficialIrAdapterContext(),
    logLabel: "SK hynix official disclosure",
    extractSignals: extractSkHynixSignalsFromText
  });
}

export async function previewAsmlIr(input: AsmlIrInput = { year: 2025, entityId: "ENT-ASML" }): Promise<OfficialDisclosurePreview> {
  return previewOfficialDisclosure({
    adapter: asmlIrAdapter,
    input,
    context: createOfficialIrAdapterContext(),
    logLabel: "ASML annual report",
    extractSignals: extractAsmlSignalsFromText
  });
}

export async function previewAppleSuppliers(input: AppleSuppliersInput = { fiscalYear: 2022, entityId: "ENT-APPLE" }): Promise<AppleSuppliersPreview> {
  const { raw, normalized, sourceDate } = await fetchAndNormalizeFirstTask({
    adapter: appleSuppliersAdapter,
    input,
    context: createAppleSuppliersAdapterContext(sourceWorkflowAdapterContextInputFromEnv()),
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

async function previewOptionalDisclosure(sourceAdapterId: string, fn: () => Promise<OfficialDisclosurePreview>): Promise<OfficialDisclosurePreview> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    noopLogger.warn({ stage: "preview", adapter: sourceAdapterId, error: message }, "optional disclosure source unavailable");
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
