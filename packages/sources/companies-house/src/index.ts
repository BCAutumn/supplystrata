import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { loadEnv, requireEnvValue } from "@supplystrata/config";
import { createId, type FetchTask, type NormalizedDocument, type RawDocument } from "@supplystrata/core";
import { createEntitySourceCandidate, type EntitySourceCandidate } from "@supplystrata/entity-source";
import { FsObjectStore } from "@supplystrata/object-store";
import { createRateLimitedSourceAdapter, fetchBytesWithTimeout, type AdapterContext, type SourceAdapter } from "@supplystrata/source-adapter-spec";
import { normalizeTextDocument } from "@supplystrata/source-normalizers";

export interface CompaniesHouseSearchInput {
  query: string;
  limit?: number;
}

interface CompaniesHouseSearchItem {
  title: string;
  company_number: string;
  company_status?: string;
  company_type?: string;
  date_of_creation?: string;
  address_snippet?: string;
  links_self?: string;
}

const companiesHouseAdapterBase: SourceAdapter<CompaniesHouseSearchInput, Uint8Array> = {
  id: "companies-house",
  tier: "P0",
  description: "UK Companies House official company search API for entity resolution",
  tos_url: "https://developer.company-information.service.gov.uk/",
  rate_limit: { requests: 600, per_seconds: 300 },
  async *plan(input) {
    yield {
      task_id: `companies-house-search-${stableQueryId(input)}`,
      url: buildCompaniesHouseSearchUrl(input),
      expected_format: "json",
      hint: { document_type: "company_registry" }
    };
  },
  async fetch(task, ctx) {
    const apiKey = requireEnvValue(loadEnv().COMPANIES_HOUSE_API_KEY, "COMPANIES_HOUSE_API_KEY");
    const bytes = await fetchBytesWithTimeout(task.url, {
      userAgent: ctx.userAgent,
      timeoutMs: 12_000,
      sourceLabel: "Companies House",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`
      }
    });
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const storageKey = `entity-resolution/companies-house/${sha256}.json`;
    await new FsObjectStore(loadEnv().OBJECT_STORE_FS_BASE).put(storageKey, bytes);
    return {
      doc_id: createId("DOC"),
      source_adapter_id: "companies-house",
      url: task.url,
      fetched_at: ctx.now().toISOString(),
      bytes_sha256: sha256,
      storage_key: storageKey,
      body: bytes,
      metadata: { task_id: task.task_id, document_type: "company_registry" }
    };
  },
  async normalize(raw) {
    return normalizeCompaniesHouseDocument(raw);
  }
};

export const companiesHouseAdapter = createRateLimitedSourceAdapter(companiesHouseAdapterBase);

export function createCompaniesHouseAdapterContext(): AdapterContext {
  return { userAgent: loadEnv().SEC_USER_AGENT, now: () => new Date() };
}

export async function lookupCompaniesHouseCompanies(input: CompaniesHouseSearchInput, ctx: AdapterContext = createCompaniesHouseAdapterContext()): Promise<{ raw: RawDocument<Uint8Array>; candidates: EntitySourceCandidate[] }> {
  const task = await firstTask(companiesHouseAdapter.plan(input, ctx));
  const raw = await companiesHouseAdapter.fetch(task, ctx);
  return { raw, candidates: extractCompaniesHouseCandidates(raw) };
}

export function buildCompaniesHouseSearchUrl(input: CompaniesHouseSearchInput): string {
  const query = input.query.trim();
  if (query.length === 0) throw new Error("Companies House query must not be empty");
  const url = new URL("https://api.company-information.service.gov.uk/search/companies");
  url.searchParams.set("q", query);
  url.searchParams.set("items_per_page", String(clampLimit(input.limit)));
  return url.toString();
}

export function extractCompaniesHouseCandidates(raw: RawDocument<Uint8Array>): EntitySourceCandidate[] {
  const items = parseCompaniesHousePayload(raw.body);
  return items.map((item) => createEntitySourceCandidate({
    source_adapter_id: "companies-house",
    source_url: raw.url,
    external_id: item.company_number,
    name: item.title,
    jurisdiction_code: "gb",
    company_number: item.company_number,
    ...(item.company_status === undefined ? {} : { current_status: item.company_status }),
    ...(item.company_type === undefined ? {} : { company_type: item.company_type }),
    ...(item.date_of_creation === undefined ? {} : { incorporation_date: item.date_of_creation }),
    ...(item.address_snippet === undefined ? {} : { registered_address: item.address_snippet }),
    previous_names: [],
    alternative_names: [],
    identifiers: {
      companies_house_number: item.company_number,
      company_number: item.company_number,
      jurisdiction_code: "gb"
    },
    confidence: 0.82,
    provenance_note: item.links_self === undefined ? "Companies House company search result" : `Companies House company search result: https://find-and-update.company-information.service.gov.uk${item.links_self}`
  }));
}

function normalizeCompaniesHouseDocument(raw: RawDocument<Uint8Array>): NormalizedDocument {
  const candidates = extractCompaniesHouseCandidates(raw);
  return normalizeTextDocument({
    raw,
    documentType: "company_registry",
    parserVersion: "companies-house-json-v1",
    text: candidates.map(formatEntitySourceCandidateText).join("\n\n"),
    extraMetadata: { candidate_count: candidates.length }
  });
}

function formatEntitySourceCandidateText(candidate: EntitySourceCandidate): string {
  return [
    `name: ${candidate.name}`,
    `external_id: ${candidate.external_id}`,
    `jurisdiction: ${candidate.jurisdiction_code}`,
    candidate.company_number === undefined ? undefined : `company_number: ${candidate.company_number}`,
    candidate.current_status === undefined ? undefined : `status: ${candidate.current_status}`,
    candidate.company_type === undefined ? undefined : `company_type: ${candidate.company_type}`,
    candidate.incorporation_date === undefined ? undefined : `incorporation_date: ${candidate.incorporation_date}`,
    candidate.registered_address === undefined ? undefined : `registered_address: ${candidate.registered_address}`,
    `provenance: ${candidate.provenance_note}`
  ].filter((line): line is string => line !== undefined).join("\n");
}

function parseCompaniesHousePayload(bytes: Uint8Array): CompaniesHouseSearchItem[] {
  const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  const root = requireRecord(parsed, "Companies House response");
  const items = root["items"];
  if (!Array.isArray(items)) throw new Error("Companies House items must be an array");
  return items.map((item, index) => parseSearchItem(item, index));
}

function parseSearchItem(value: unknown, index: number): CompaniesHouseSearchItem {
  const item = requireRecord(value, `Companies House items[${index}]`);
  const links = isRecord(item["links"]) ? item["links"] : {};
  const companyStatus = optionalString(item["company_status"]);
  const companyType = optionalString(item["company_type"]);
  const dateOfCreation = optionalString(item["date_of_creation"]);
  const addressSnippet = optionalString(item["address_snippet"]);
  const linksSelf = optionalString(links["self"]);
  return {
    title: requireString(item["title"], "Companies House item.title"),
    company_number: requireString(item["company_number"], "Companies House item.company_number"),
    ...(companyStatus === undefined ? {} : { company_status: companyStatus }),
    ...(companyType === undefined ? {} : { company_type: companyType }),
    ...(dateOfCreation === undefined ? {} : { date_of_creation: dateOfCreation }),
    ...(addressSnippet === undefined ? {} : { address_snippet: addressSnippet }),
    ...(linksSelf === undefined ? {} : { links_self: linksSelf })
  };
}

async function firstTask(tasks: AsyncIterable<FetchTask>): Promise<FetchTask> {
  for await (const task of tasks) return task;
  throw new Error("Companies House adapter produced no fetch task");
}

function stableQueryId(input: CompaniesHouseSearchInput): string {
  return createHash("sha256").update(`${input.query}|${String(input.limit ?? "")}`).digest("hex").slice(0, 16);
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error(`Unsupported Companies House limit: ${limit}`);
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
