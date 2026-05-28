import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { type FetchTask, type NormalizedDocument, type RawDocument } from "@supplystrata/core";
import { createEntitySourceCandidate, type EntitySourceCandidate } from "@supplystrata/entity-source";
import {
  createAdapterContext as createRuntimeAdapterContext,
  createRateLimitedSourceAdapter,
  fetchBytesWithTimeout,
  persistRawDocumentSnapshot,
  type AdapterContext,
  type CreateAdapterContextInput,
  type SourceAdapter
} from "@supplystrata/source-adapter-runtime";
import { normalizeTextDocument } from "@supplystrata/source-normalizers";

export interface OpenFigiSearchInput {
  query: string;
  exchangeCode?: string;
  limit?: number;
}

interface OpenFigiInstrument {
  figi: string;
  name: string;
  ticker?: string;
  exchCode?: string;
  compositeFIGI?: string;
  shareClassFIGI?: string;
  securityType?: string;
  marketSector?: string;
  securityType2?: string;
  securityDescription?: string;
}

const openFigiAdapterBase: SourceAdapter<OpenFigiSearchInput, Uint8Array> = {
  id: "openfigi",
  tier: "P0",
  description: "OpenFIGI search API for listed security identity candidates",
  tos_url: "https://www.openfigi.com/api/documentation",
  rate_limit: { requests: 25, per_seconds: 60 },
  async *plan(input) {
    yield {
      task_id: `openfigi-search-${stableQueryId(input)}`,
      url: buildOpenFigiSearchUrl(),
      expected_format: "json",
      params: {
        query: normalizedQuery(input),
        ...normalizedExchangeCodeParams(input),
        request_body_sha256: requestBodySha256(input)
      },
      hint: { document_type: "company_registry" }
    };
  },
  async fetch(task, ctx) {
    const bytes = await fetchBytesWithTimeout(task.url, {
      method: "POST",
      body: JSON.stringify(buildOpenFigiSearchBody(inputFromTask(task))),
      userAgent: ctx.userAgent,
      timeoutMs: 12_000,
      sourceLabel: "OpenFIGI",
      attempts: 2,
      retryDelayMs: 500,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      }
    });
    return persistRawDocumentSnapshot({
      ctx,
      sourceAdapterId: "openfigi",
      url: task.url,
      body: bytes,
      metadata: {
        task_id: task.task_id,
        document_type: "company_registry",
        query: task.params?.["query"],
        exchange_code: task.params?.["exchange_code"],
        request_body_sha256: task.params?.["request_body_sha256"]
      },
      storageKeyForSha256: (sha256) => `entity-resolution/openfigi/${sha256}.json`
    });
  },
  async normalize(raw) {
    return normalizeOpenFigiDocument(raw);
  }
};

export const openFigiAdapter = createRateLimitedSourceAdapter(openFigiAdapterBase);

export function createOpenFigiAdapterContext(input: CreateAdapterContextInput): AdapterContext {
  return createRuntimeAdapterContext(input);
}

export async function lookupOpenFigiInstruments(
  input: OpenFigiSearchInput,
  ctx: AdapterContext
): Promise<{ raw: RawDocument<Uint8Array>; candidates: EntitySourceCandidate[] }> {
  const task = await firstTask(openFigiAdapter.plan(input, ctx));
  const raw = await openFigiAdapter.fetch(task, ctx);
  return { raw, candidates: extractOpenFigiCandidates(raw, input.limit) };
}

export function buildOpenFigiSearchUrl(): string {
  return "https://api.openfigi.com/v3/search";
}

export function buildOpenFigiSearchBody(input: OpenFigiSearchInput): { query: string; exchCode?: string } {
  const query = normalizedQuery(input);
  const exchangeCode = input.exchangeCode?.trim();
  return {
    query,
    ...(exchangeCode === undefined || exchangeCode.length === 0 ? {} : { exchCode: exchangeCode.toUpperCase() })
  };
}

export function extractOpenFigiCandidates(raw: RawDocument<Uint8Array>, limit?: number): EntitySourceCandidate[] {
  return parseOpenFigiPayload(raw.body)
    .slice(0, clampLimit(limit))
    .map((instrument) =>
      createEntitySourceCandidate({
        source_adapter_id: "openfigi",
        source_url: raw.url,
        external_id: instrument.figi,
        name: instrument.name,
        ...(instrument.securityType2 === undefined ? {} : { company_type: instrument.securityType2 }),
        previous_names: [],
        alternative_names: alternativeNames(instrument),
        identifiers: {
          figi: instrument.figi,
          openfigi_figi: instrument.figi,
          ...(instrument.compositeFIGI === undefined ? {} : { openfigi_composite_figi: instrument.compositeFIGI }),
          ...(instrument.shareClassFIGI === undefined ? {} : { openfigi_share_class_figi: instrument.shareClassFIGI }),
          ...(instrument.ticker === undefined ? {} : { ticker: instrument.ticker }),
          ...(instrument.exchCode === undefined ? {} : { exchange_code: instrument.exchCode })
        },
        confidence: 0.68,
        provenance_note: [
          `OpenFIGI instrument ${instrument.figi}`,
          instrument.ticker === undefined ? undefined : `ticker=${instrument.ticker}`,
          instrument.exchCode === undefined ? undefined : `exchange=${instrument.exchCode}`,
          instrument.marketSector === undefined ? undefined : `sector=${instrument.marketSector}`,
          instrument.securityType === undefined ? undefined : `security_type=${instrument.securityType}`
        ]
          .filter((item): item is string => item !== undefined)
          .join("; ")
      })
    );
}

function normalizeOpenFigiDocument(raw: RawDocument<Uint8Array>): NormalizedDocument {
  const candidates = extractOpenFigiCandidates(raw);
  return normalizeTextDocument({
    raw,
    documentType: "company_registry",
    parserVersion: "openfigi-search-json-v1",
    text: candidates.map(formatEntitySourceCandidateText).join("\n\n"),
    extraMetadata: { candidate_count: candidates.length }
  });
}

function formatEntitySourceCandidateText(candidate: EntitySourceCandidate): string {
  return [
    `name: ${candidate.name}`,
    `figi: ${candidate.external_id}`,
    candidate.identifiers["ticker"] === undefined ? undefined : `ticker: ${candidate.identifiers["ticker"]}`,
    candidate.identifiers["exchange_code"] === undefined ? undefined : `exchange: ${candidate.identifiers["exchange_code"]}`,
    candidate.company_type === undefined ? undefined : `security_type: ${candidate.company_type}`,
    candidate.alternative_names.length === 0 ? undefined : `alternative_names: ${candidate.alternative_names.join("; ")}`,
    `provenance: ${candidate.provenance_note}`
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function parseOpenFigiPayload(bytes: Uint8Array): OpenFigiInstrument[] {
  const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  const root = requireRecord(parsed, "OpenFIGI response");
  const data = root["data"];
  if (data === undefined) return [];
  if (!Array.isArray(data)) throw new Error("OpenFIGI response data must be an array");
  return data.map((item, index) => parseOpenFigiInstrument(item, index));
}

function parseOpenFigiInstrument(value: unknown, index: number): OpenFigiInstrument {
  const item = requireRecord(value, `OpenFIGI data[${index}]`);
  const ticker = optionalString(item["ticker"]);
  const exchCode = optionalString(item["exchCode"]);
  const compositeFIGI = optionalString(item["compositeFIGI"]);
  const shareClassFIGI = optionalString(item["shareClassFIGI"]);
  const securityType = optionalString(item["securityType"]);
  const marketSector = optionalString(item["marketSector"]);
  const securityType2 = optionalString(item["securityType2"]);
  const securityDescription = optionalString(item["securityDescription"]);
  return {
    figi: requireString(item["figi"], `OpenFIGI data[${index}].figi`),
    name: requireString(item["name"], `OpenFIGI data[${index}].name`),
    ...(ticker === undefined ? {} : { ticker }),
    ...(exchCode === undefined ? {} : { exchCode }),
    ...(compositeFIGI === undefined ? {} : { compositeFIGI }),
    ...(shareClassFIGI === undefined ? {} : { shareClassFIGI }),
    ...(securityType === undefined ? {} : { securityType }),
    ...(marketSector === undefined ? {} : { marketSector }),
    ...(securityType2 === undefined ? {} : { securityType2 }),
    ...(securityDescription === undefined ? {} : { securityDescription })
  };
}

function alternativeNames(instrument: OpenFigiInstrument): string[] {
  return [instrument.securityDescription, instrument.ticker].filter((value): value is string => value !== undefined);
}

async function firstTask(tasks: AsyncIterable<FetchTask>): Promise<FetchTask> {
  for await (const task of tasks) return task;
  throw new Error("OpenFIGI adapter produced no fetch task");
}

function inputFromTask(task: FetchTask): OpenFigiSearchInput {
  const query = task.params?.["query"];
  if (typeof query !== "string") throw new Error("OpenFIGI task params query must be present");
  const exchangeCode = task.params?.["exchange_code"];
  return {
    query,
    ...(typeof exchangeCode === "string" ? { exchangeCode } : {})
  };
}

function stableQueryId(input: OpenFigiSearchInput): string {
  return createHash("sha256")
    .update(`${normalizedQuery(input)}|${input.exchangeCode?.trim().toUpperCase() ?? ""}|${String(input.limit ?? "")}`)
    .digest("hex")
    .slice(0, 16);
}

function requestBodySha256(input: OpenFigiSearchInput): string {
  return createHash("sha256")
    .update(JSON.stringify(buildOpenFigiSearchBody(input)))
    .digest("hex");
}

function normalizedQuery(input: OpenFigiSearchInput): string {
  const query = input.query.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (query.length === 0) throw new Error("OpenFIGI query must not be empty");
  return query;
}

function normalizedExchangeCodeParams(input: OpenFigiSearchInput): { exchange_code?: string } {
  const exchangeCode = input.exchangeCode?.trim().toUpperCase();
  return exchangeCode === undefined || exchangeCode.length === 0 ? {} : { exchange_code: exchangeCode };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error(`Unsupported OpenFIGI limit: ${limit}`);
  return limit;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
