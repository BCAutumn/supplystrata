import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { type FetchTask, type NormalizedDocument, type RawDocument } from "@supplystrata/core";
import { createEntitySourceCandidate, type EntitySourceCandidate } from "@supplystrata/entity-source";
import {
  createAdapterContext,
  createRateLimitedSourceAdapter,
  fetchBytesWithTimeout,
  persistRawDocumentSnapshot,
  type AdapterContext,
  type CreateAdapterContextInput,
  type SourceAdapter
} from "@supplystrata/source-adapter-runtime";
import { normalizeTextDocument } from "@supplystrata/source-normalizers";

export interface GleifLeiSearchInput {
  query: string;
  limit?: number;
}

interface GleifLeiRecord {
  id: string;
  lei: string;
  legalName: string;
  otherNames: string[];
  jurisdiction?: string;
  entityStatus?: string;
  entityCategory?: string;
  creationDate?: string;
  legalAddress?: string;
  headquartersAddress?: string;
  registeredAt?: string;
  registeredAs?: string;
  registrationStatus?: string;
  nextRenewalDate?: string;
  corroborationLevel?: string;
  bicCodes: string[];
  ocid?: string;
  spglobalIds: string[];
  selfUrl?: string;
}

const gleifLeiAdapterBase: SourceAdapter<GleifLeiSearchInput, Uint8Array> = {
  id: "gleif",
  tier: "P0",
  description: "GLEIF LEI records API for global legal entity identifiers",
  tos_url: "https://www.gleif.org/en/lei-data/lei-data-terms-of-use",
  rate_limit: { requests: 5, per_seconds: 1 },
  async *plan(input) {
    yield {
      task_id: `gleif-lei-search-${stableQueryId(input)}`,
      url: buildGleifLeiSearchUrl(input),
      expected_format: "json",
      hint: { document_type: "company_registry" }
    };
  },
  async fetch(task, ctx) {
    const bytes = await fetchBytesWithTimeout(task.url, {
      userAgent: ctx.userAgent,
      timeoutMs: 12_000,
      sourceLabel: "GLEIF",
      headers: { Accept: "application/vnd.api+json" }
    });
    return persistRawDocumentSnapshot({
      ctx,
      sourceAdapterId: "gleif",
      url: task.url,
      body: bytes,
      metadata: { task_id: task.task_id, document_type: "company_registry" },
      storageKeyForSha256: (sha256) => `entity-resolution/gleif/${sha256}.json`
    });
  },
  async normalize(raw) {
    return normalizeGleifLeiDocument(raw);
  }
};

export const gleifLeiAdapter = createRateLimitedSourceAdapter(gleifLeiAdapterBase);

export function createGleifLeiAdapterContext(input: CreateAdapterContextInput): AdapterContext {
  return createAdapterContext(input);
}

export async function lookupGleifLeiRecords(
  input: GleifLeiSearchInput,
  ctx: AdapterContext
): Promise<{ raw: RawDocument<Uint8Array>; candidates: EntitySourceCandidate[] }> {
  const task = await firstTask(gleifLeiAdapter.plan(input, ctx));
  const raw = await gleifLeiAdapter.fetch(task, ctx);
  return { raw, candidates: extractGleifLeiCandidates(raw) };
}

export function buildGleifLeiSearchUrl(input: GleifLeiSearchInput): string {
  const query = input.query.trim();
  if (query.length === 0) throw new Error("GLEIF LEI query must not be empty");
  const url = new URL("https://api.gleif.org/api/v1/lei-records");
  url.searchParams.set("filter[entity.legalName]", query);
  url.searchParams.set("page[size]", String(clampLimit(input.limit)));
  return url.toString();
}

export function extractGleifLeiCandidates(raw: RawDocument<Uint8Array>): EntitySourceCandidate[] {
  return parseGleifPayload(raw.body).map((record) =>
    createEntitySourceCandidate({
      source_adapter_id: "gleif",
      source_url: raw.url,
      external_id: record.lei,
      name: record.legalName,
      ...(record.jurisdiction === undefined ? {} : { jurisdiction_code: record.jurisdiction }),
      ...(record.registeredAs === undefined ? {} : { company_number: record.registeredAs }),
      ...(record.entityStatus === undefined ? {} : { current_status: record.entityStatus }),
      ...(record.entityCategory === undefined ? {} : { company_type: record.entityCategory }),
      ...(record.creationDate === undefined ? {} : { incorporation_date: dateOnly(record.creationDate) }),
      ...(record.legalAddress === undefined ? {} : { registered_address: record.legalAddress }),
      previous_names: [],
      alternative_names: record.otherNames,
      identifiers: {
        lei: record.lei,
        gleif_lei: record.lei,
        ...(record.registeredAt === undefined ? {} : { registration_authority_id: record.registeredAt }),
        ...(record.registeredAs === undefined ? {} : { registration_authority_entity_id: record.registeredAs }),
        ...(record.ocid === undefined ? {} : { open_corporates_id: record.ocid }),
        ...(record.bicCodes[0] === undefined ? {} : { bic: record.bicCodes[0] }),
        ...(record.spglobalIds[0] === undefined ? {} : { spglobal_id: record.spglobalIds[0] }),
        ...(record.jurisdiction === undefined ? {} : { jurisdiction_code: record.jurisdiction }),
        ...(record.registeredAs === undefined ? {} : { company_number: record.registeredAs })
      },
      confidence: 0.86,
      provenance_note: [
        `GLEIF LEI record ${record.lei}`,
        record.selfUrl === undefined ? undefined : record.selfUrl,
        record.registrationStatus === undefined ? undefined : `registration=${record.registrationStatus}`,
        record.corroborationLevel === undefined ? undefined : `corroboration=${record.corroborationLevel}`,
        record.nextRenewalDate === undefined ? undefined : `next_renewal=${dateOnly(record.nextRenewalDate)}`
      ]
        .filter((item): item is string => item !== undefined)
        .join("; ")
    })
  );
}

function normalizeGleifLeiDocument(raw: RawDocument<Uint8Array>): NormalizedDocument {
  const candidates = extractGleifLeiCandidates(raw);
  return normalizeTextDocument({
    raw,
    documentType: "company_registry",
    parserVersion: "gleif-lei-json-v1",
    text: candidates.map(formatEntitySourceCandidateText).join("\n\n"),
    extraMetadata: { candidate_count: candidates.length }
  });
}

function formatEntitySourceCandidateText(candidate: EntitySourceCandidate): string {
  return [
    `name: ${candidate.name}`,
    `lei: ${candidate.external_id}`,
    `jurisdiction: ${candidate.jurisdiction_code ?? "unknown"}`,
    candidate.company_number === undefined ? undefined : `registration_authority_entity_id: ${candidate.company_number}`,
    candidate.current_status === undefined ? undefined : `entity_status: ${candidate.current_status}`,
    candidate.company_type === undefined ? undefined : `entity_category: ${candidate.company_type}`,
    candidate.incorporation_date === undefined ? undefined : `creation_date: ${candidate.incorporation_date}`,
    candidate.registered_address === undefined ? undefined : `legal_address: ${candidate.registered_address}`,
    candidate.alternative_names.length === 0 ? undefined : `other_names: ${candidate.alternative_names.join("; ")}`,
    `provenance: ${candidate.provenance_note}`
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function parseGleifPayload(bytes: Uint8Array): GleifLeiRecord[] {
  const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  const root = requireRecord(parsed, "GLEIF response");
  const data = root["data"];
  if (!Array.isArray(data)) throw new Error("GLEIF response data must be an array");
  return data.map((item, index) => parseGleifLeiRecord(item, index));
}

function parseGleifLeiRecord(value: unknown, index: number): GleifLeiRecord {
  const record = requireRecord(value, `GLEIF data[${index}]`);
  const attributes = requireRecord(record["attributes"], `GLEIF data[${index}].attributes`);
  const entity = requireRecord(attributes["entity"], `GLEIF data[${index}].attributes.entity`);
  const registration = requireRecord(attributes["registration"], `GLEIF data[${index}].attributes.registration`);
  const legalName = requireRecord(entity["legalName"], `GLEIF data[${index}].entity.legalName`);
  const registeredAt = optionalRecord(entity["registeredAt"]);
  const links = optionalRecord(record["links"]);
  const lei = requireString(attributes["lei"], `GLEIF data[${index}].attributes.lei`);
  const jurisdiction = optionalString(entity["jurisdiction"]);
  const entityStatus = optionalString(entity["status"]);
  const entityCategory = optionalString(entity["category"]);
  const creationDate = optionalString(entity["creationDate"]);
  const legalAddress = formatGleifAddress(optionalRecord(entity["legalAddress"]));
  const headquartersAddress = formatGleifAddress(optionalRecord(entity["headquartersAddress"]));
  const registeredAtId = optionalString(registeredAt?.["id"]);
  const registeredAs = optionalString(entity["registeredAs"]);
  const registrationStatus = optionalString(registration["status"]);
  const nextRenewalDate = optionalString(registration["nextRenewalDate"]);
  const corroborationLevel = optionalString(registration["corroborationLevel"]);
  const ocid = optionalString(attributes["ocid"]);
  const selfUrl = optionalString(links?.["self"]);
  return {
    id: requireString(record["id"], `GLEIF data[${index}].id`),
    lei,
    legalName: requireString(legalName["name"], `GLEIF data[${index}].entity.legalName.name`),
    otherNames: [...nameList(entity["otherNames"]), ...nameList(entity["transliteratedOtherNames"])],
    ...(jurisdiction === undefined ? {} : { jurisdiction }),
    ...(entityStatus === undefined ? {} : { entityStatus }),
    ...(entityCategory === undefined ? {} : { entityCategory }),
    ...(creationDate === undefined ? {} : { creationDate }),
    ...(legalAddress === undefined ? {} : { legalAddress }),
    ...(headquartersAddress === undefined ? {} : { headquartersAddress }),
    ...(registeredAtId === undefined ? {} : { registeredAt: registeredAtId }),
    ...(registeredAs === undefined ? {} : { registeredAs }),
    ...(registrationStatus === undefined ? {} : { registrationStatus }),
    ...(nextRenewalDate === undefined ? {} : { nextRenewalDate }),
    ...(corroborationLevel === undefined ? {} : { corroborationLevel }),
    bicCodes: stringArray(attributes["bic"]),
    ...(ocid === undefined ? {} : { ocid }),
    spglobalIds: stringArray(attributes["spglobal"]),
    ...(selfUrl === undefined ? {} : { selfUrl })
  };
}

function formatGleifAddress(address: Record<string, unknown> | undefined): string | undefined {
  if (address === undefined) return undefined;
  const lines = stringArray(address["addressLines"]);
  const city = optionalString(address["city"]);
  const region = optionalString(address["region"]);
  const postalCode = optionalString(address["postalCode"]);
  const country = optionalString(address["country"]);
  return [lines.join(", "), city, region, postalCode, country].filter((item): item is string => item !== undefined && item.length > 0).join(", ");
}

function nameList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = optionalRecord(item);
    if (record === undefined) return [];
    const name = optionalString(record["name"]);
    return name === undefined ? [] : [name];
  });
}

async function firstTask(tasks: AsyncIterable<FetchTask>): Promise<FetchTask> {
  for await (const task of tasks) return task;
  throw new Error("GLEIF LEI adapter produced no fetch task");
}

function stableQueryId(input: GleifLeiSearchInput): string {
  return createHash("sha256")
    .update(`${input.query}|${String(input.limit ?? "")}`)
    .digest("hex")
    .slice(0, 16);
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error(`Unsupported GLEIF LEI limit: ${limit}`);
  return limit;
}

function dateOnly(value: string): string {
  return value.includes("T") ? value.slice(0, value.indexOf("T")) : value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
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

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text = optionalString(item);
    return text === undefined ? [] : [text];
  });
}
