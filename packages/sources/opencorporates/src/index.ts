import { createHash } from "node:crypto";
import { loadEnv, requireEnvValue } from "@supplystrata/config";
import { createId, type FetchTask, type NormalizedDocument, type RawDocument } from "@supplystrata/core";
import { createEntitySourceCandidate, type EntitySourceCandidate } from "@supplystrata/entity-source";
import {
  createFsSnapshotStore,
  createRateLimitedSourceAdapter,
  fetchBytesWithTimeout,
  requireSnapshotStore,
  type AdapterContext,
  type SourceAdapter
} from "@supplystrata/source-adapter-runtime";
import { normalizeTextDocument } from "@supplystrata/source-normalizers";

export interface OpenCorporatesSearchInput {
  query: string;
  jurisdictionCode?: string;
  limit?: number;
}

interface OpenCorporatesCompanyWrapper {
  company: OpenCorporatesCompany;
}

interface OpenCorporatesCompany {
  name: string;
  company_number: string;
  jurisdiction_code: string;
  current_status?: string;
  company_type?: string;
  incorporation_date?: string;
  registered_address?: string;
  opencorporates_url?: string;
  previous_names: string[];
  alternative_names: string[];
}

const openCorporatesAdapterBase: SourceAdapter<OpenCorporatesSearchInput, Uint8Array> = {
  id: "opencorporates",
  tier: "P0",
  description: "OpenCorporates public company registry API for entity resolution",
  tos_url: "https://opencorporates.com/info/licence",
  rate_limit: { requests: 1, per_seconds: 2 },
  async *plan(input) {
    yield {
      task_id: `opencorporates-search-${stableQueryId(input)}`,
      url: buildOpenCorporatesSearchUrl(input),
      expected_format: "json",
      hint: { document_type: "company_registry" }
    };
  },
  async fetch(task, ctx) {
    const token = requireEnvValue(loadEnv().OPEN_CORPORATES_API_TOKEN, "OPEN_CORPORATES_API_TOKEN");
    const bytes = await fetchBytesWithTimeout(task.url, {
      userAgent: ctx.userAgent,
      timeoutMs: 12_000,
      sourceLabel: "OpenCorporates",
      headers: {
        Accept: "application/json",
        "X-API-TOKEN": token
      }
    });
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const storageKey = `entity-resolution/opencorporates/${sha256}.json`;
    await requireSnapshotStore(ctx, "opencorporates").put(storageKey, bytes);
    return {
      doc_id: createId("DOC"),
      source_adapter_id: "opencorporates",
      url: task.url,
      fetched_at: ctx.now().toISOString(),
      bytes_sha256: sha256,
      storage_key: storageKey,
      body: bytes,
      metadata: { task_id: task.task_id, document_type: "company_registry" }
    };
  },
  async normalize(raw) {
    return normalizeOpenCorporatesDocument(raw);
  }
};

export const openCorporatesAdapter = createRateLimitedSourceAdapter(openCorporatesAdapterBase);

export function createOpenCorporatesAdapterContext(): AdapterContext {
  const env = loadEnv();
  return { userAgent: env.SEC_USER_AGENT, now: () => new Date(), snapshotStore: createFsSnapshotStore(env.OBJECT_STORE_FS_BASE) };
}

export async function lookupOpenCorporatesCompanies(
  input: OpenCorporatesSearchInput,
  ctx: AdapterContext = createOpenCorporatesAdapterContext()
): Promise<{ raw: RawDocument<Uint8Array>; candidates: EntitySourceCandidate[] }> {
  const task = await firstTask(openCorporatesAdapter.plan(input, ctx));
  const raw = await openCorporatesAdapter.fetch(task, ctx);
  return { raw, candidates: extractOpenCorporatesCandidates(raw) };
}

export function buildOpenCorporatesSearchUrl(input: OpenCorporatesSearchInput): string {
  const query = input.query.trim();
  if (query.length === 0) throw new Error("OpenCorporates query must not be empty");
  const url = new URL("https://api.opencorporates.com/v0.4/companies/search");
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", String(clampLimit(input.limit)));
  if (input.jurisdictionCode !== undefined && input.jurisdictionCode.trim().length > 0) {
    url.searchParams.set("jurisdiction_code", input.jurisdictionCode.trim().toLowerCase());
  }
  return url.toString();
}

export function extractOpenCorporatesCandidates(raw: RawDocument<Uint8Array>): EntitySourceCandidate[] {
  const payload = parseOpenCorporatesPayload(raw.body);
  return payload.map(({ company }) =>
    createEntitySourceCandidate({
      source_adapter_id: "opencorporates",
      source_url: raw.url,
      external_id: `${company.jurisdiction_code}/${company.company_number}`,
      name: company.name,
      jurisdiction_code: company.jurisdiction_code,
      company_number: company.company_number,
      ...(company.current_status === undefined ? {} : { current_status: company.current_status }),
      ...(company.company_type === undefined ? {} : { company_type: company.company_type }),
      ...(company.incorporation_date === undefined ? {} : { incorporation_date: company.incorporation_date }),
      ...(company.registered_address === undefined ? {} : { registered_address: company.registered_address }),
      previous_names: company.previous_names,
      alternative_names: company.alternative_names,
      identifiers: {
        open_corporates_id: `${company.jurisdiction_code}/${company.company_number}`,
        company_number: company.company_number,
        jurisdiction_code: company.jurisdiction_code
      },
      confidence: 0.74,
      provenance_note:
        company.opencorporates_url === undefined
          ? "OpenCorporates company search result"
          : `OpenCorporates company search result: ${company.opencorporates_url}`
    })
  );
}

function normalizeOpenCorporatesDocument(raw: RawDocument<Uint8Array>): NormalizedDocument {
  const candidates = extractOpenCorporatesCandidates(raw);
  return normalizeTextDocument({
    raw,
    documentType: "company_registry",
    parserVersion: "opencorporates-json-v1",
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
    candidate.previous_names.length === 0 ? undefined : `previous_names: ${candidate.previous_names.join("; ")}`,
    candidate.alternative_names.length === 0 ? undefined : `alternative_names: ${candidate.alternative_names.join("; ")}`,
    `provenance: ${candidate.provenance_note}`
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function parseOpenCorporatesPayload(bytes: Uint8Array): OpenCorporatesCompanyWrapper[] {
  const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  const root = requireRecord(parsed, "OpenCorporates response");
  const results = requireRecord(root["results"], "OpenCorporates results");
  const companies = results["companies"];
  if (!Array.isArray(companies)) throw new Error("OpenCorporates results.companies must be an array");
  return companies.map((item, index) => parseCompanyWrapper(item, index));
}

function parseCompanyWrapper(value: unknown, index: number): OpenCorporatesCompanyWrapper {
  const wrapper = requireRecord(value, `OpenCorporates companies[${index}]`);
  const company = requireRecord(wrapper["company"], `OpenCorporates companies[${index}].company`);
  const currentStatus = optionalString(company["current_status"]);
  const companyType = optionalString(company["company_type"]);
  const incorporationDate = optionalString(company["incorporation_date"]);
  const registeredAddress = optionalString(company["registered_address"]);
  const opencorporatesUrl = optionalString(company["opencorporates_url"]);
  return {
    company: {
      name: requireString(company["name"], "OpenCorporates company.name"),
      company_number: requireString(company["company_number"], "OpenCorporates company.company_number"),
      jurisdiction_code: requireString(company["jurisdiction_code"], "OpenCorporates company.jurisdiction_code"),
      ...(currentStatus === undefined ? {} : { current_status: currentStatus }),
      ...(companyType === undefined ? {} : { company_type: companyType }),
      ...(incorporationDate === undefined ? {} : { incorporation_date: incorporationDate }),
      ...(registeredAddress === undefined ? {} : { registered_address: registeredAddress }),
      ...(opencorporatesUrl === undefined ? {} : { opencorporates_url: opencorporatesUrl }),
      previous_names: parseNameList(company["previous_names"]),
      alternative_names: parseNameList(company["alternative_names"])
    }
  };
}

function parseNameList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      names.push(item);
      continue;
    }
    if (isRecord(item)) {
      const companyName = optionalString(item["company_name"]) ?? optionalString(item["name"]);
      if (companyName !== undefined) names.push(companyName);
    }
  }
  return names;
}

async function firstTask(tasks: AsyncIterable<FetchTask>): Promise<FetchTask> {
  for await (const task of tasks) return task;
  throw new Error("OpenCorporates adapter produced no fetch task");
}

function stableQueryId(input: OpenCorporatesSearchInput): string {
  return createHash("sha256")
    .update(`${input.query}|${input.jurisdictionCode ?? ""}|${String(input.limit ?? "")}`)
    .digest("hex")
    .slice(0, 16);
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error(`Unsupported OpenCorporates limit: ${limit}`);
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
