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

export interface WikidataSearchInput {
  kind?: "search";
  query: string;
  language?: string;
  limit?: number;
}

export interface WikidataEntityDataInput {
  kind: "entity-data";
  qid: string;
  language?: string;
}

export type WikidataAdapterInput = WikidataSearchInput | WikidataEntityDataInput;

export interface WikidataEntityDataProfile {
  qid: string;
  label: string;
  description?: string;
  aliases: string[];
  official_websites: string[];
  identifiers: {
    wikidata_qid: string;
    lei?: string;
    isin?: string;
    cik?: string;
    ticker?: string;
  };
  industry_qids: string[];
  country_qids: string[];
}

interface WikidataSearchRecord {
  qid: string;
  itemUrl: string;
  label: string;
  description?: string;
  officialWebsite?: string;
  lei?: string;
  isin?: string;
  cik?: string;
  ticker?: string;
  countryLabels: string[];
  industryLabels: string[];
}

interface WikidataSparqlBinding {
  type: string;
  value: string;
}

type WikidataSparqlRow = Record<string, WikidataSparqlBinding>;

const WIKIDATA_SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const WIKIDATA_ENTITY_DATA_BASE = "https://www.wikidata.org/wiki/Special:EntityData";

const wikidataAdapterBase: SourceAdapter<WikidataAdapterInput, Uint8Array> = {
  id: "wikidata",
  tier: "P1",
  description: "Wikidata SPARQL and EntityData APIs for collaborative identity hints",
  tos_url: "https://www.wikidata.org/wiki/Wikidata:Data_access",
  rate_limit: { requests: 1, per_seconds: 1 },
  async *plan(input) {
    const normalized = normalizeAdapterInput(input);
    yield {
      task_id: `wikidata-${normalized.kind}-${stableInputId(normalized)}`,
      url: normalized.kind === "entity-data" ? buildWikidataEntityDataUrl(normalized.qid) : buildWikidataSparqlSearchUrl(normalized),
      expected_format: "json",
      params:
        normalized.kind === "entity-data"
          ? { wikidata_request_kind: "entity-data", qid: normalized.qid, language: normalized.language }
          : {
              wikidata_request_kind: "search",
              query: normalized.query,
              language: normalized.language,
              limit: normalized.limit,
              sparql_sha256: sparqlSha256(normalized)
            },
      hint: { document_type: "company_registry" }
    };
  },
  async fetch(task, ctx) {
    const requestKind = task.params?.["wikidata_request_kind"];
    const bytes = await fetchBytesWithTimeout(task.url, {
      userAgent: ctx.userAgent,
      timeoutMs: 12_000,
      sourceLabel: "Wikidata",
      attempts: 2,
      retryDelayMs: 500,
      headers: requestKind === "entity-data" ? { Accept: "application/json" } : { Accept: "application/sparql-results+json" }
    });
    return persistRawDocumentSnapshot({
      ctx,
      sourceAdapterId: "wikidata",
      url: task.url,
      body: bytes,
      metadata: {
        task_id: task.task_id,
        document_type: "company_registry",
        wikidata_request_kind: requestKind,
        query: task.params?.["query"],
        qid: task.params?.["qid"],
        language: task.params?.["language"],
        sparql_sha256: task.params?.["sparql_sha256"]
      },
      storageKeyForSha256: (sha256) => `entity-resolution/wikidata/${sha256}.json`
    });
  },
  async normalize(raw) {
    return normalizeWikidataDocument(raw);
  }
};

export const wikidataAdapter = createRateLimitedSourceAdapter(wikidataAdapterBase);

export function createWikidataAdapterContext(input: CreateAdapterContextInput): AdapterContext {
  return createRuntimeAdapterContext(input);
}

export async function lookupWikidataEntities(
  input: WikidataSearchInput,
  ctx: AdapterContext
): Promise<{ raw: RawDocument<Uint8Array>; candidates: EntitySourceCandidate[] }> {
  const task = await firstTask(wikidataAdapter.plan(input, ctx));
  const raw = await wikidataAdapter.fetch(task, ctx);
  return { raw, candidates: extractWikidataCandidates(raw, input.limit) };
}

export async function lookupWikidataEntityDataProfile(
  input: WikidataEntityDataInput,
  ctx: AdapterContext
): Promise<{ raw: RawDocument<Uint8Array>; profile: WikidataEntityDataProfile }> {
  const task = await firstTask(wikidataAdapter.plan(input, ctx));
  const raw = await wikidataAdapter.fetch(task, ctx);
  return { raw, profile: extractWikidataEntityDataProfile(raw, input.language) };
}

export function buildWikidataSparqlSearchUrl(input: WikidataSearchInput): string {
  const url = new URL(WIKIDATA_SPARQL_ENDPOINT);
  url.searchParams.set("query", buildWikidataCompanySearchSparql(input));
  url.searchParams.set("format", "json");
  return url.toString();
}

export function buildWikidataCompanySearchSparql(input: WikidataSearchInput): string {
  const normalized = normalizeSearchInput(input);
  return [
    "SELECT ?item ?itemLabel ?itemDescription ?officialWebsite ?lei ?isin ?cik ?ticker ?countryLabel ?industryLabel WHERE {",
    "  SERVICE wikibase:mwapi {",
    '    bd:serviceParam wikibase:endpoint "www.wikidata.org";',
    '                    wikibase:api "EntitySearch";',
    `                    mwapi:search ${sparqlStringLiteral(normalized.query)};`,
    `                    mwapi:language ${sparqlStringLiteral(normalized.language)}.`,
    "    ?item wikibase:apiOutputItem mwapi:item.",
    "  }",
    "  OPTIONAL { ?item wdt:P856 ?officialWebsite. }",
    "  OPTIONAL { ?item wdt:P1278 ?lei. }",
    "  OPTIONAL { ?item wdt:P946 ?isin. }",
    "  OPTIONAL { ?item wdt:P5531 ?cik. }",
    "  OPTIONAL { ?item wdt:P249 ?ticker. }",
    "  OPTIONAL { ?item wdt:P17 ?country. }",
    "  OPTIONAL { ?item wdt:P452 ?industry. }",
    `  SERVICE wikibase:label { bd:serviceParam wikibase:language ${sparqlStringLiteral(`${normalized.language},en`)}. }`,
    "}",
    `LIMIT ${normalized.limit}`
  ].join("\n");
}

export function buildWikidataEntityDataUrl(qid: string): string {
  return `${WIKIDATA_ENTITY_DATA_BASE}/${normalizeQid(qid)}.json`;
}

export function extractWikidataCandidates(raw: RawDocument<Uint8Array>, limit?: number): EntitySourceCandidate[] {
  return parseWikidataSparqlPayload(raw.body)
    .slice(0, clampLimit(limit))
    .map((record) =>
      createEntitySourceCandidate({
        source_adapter_id: "wikidata",
        source_url: raw.url,
        external_id: record.qid,
        name: record.label,
        ...(record.industryLabels[0] === undefined ? {} : { company_type: record.industryLabels[0] }),
        previous_names: [],
        alternative_names: alternativeNames(record),
        identifiers: {
          wikidata_qid: record.qid,
          ...(record.lei === undefined ? {} : { lei: record.lei, gleif_lei: record.lei }),
          ...(record.isin === undefined ? {} : { isin: record.isin }),
          ...(record.cik === undefined ? {} : { cik: record.cik }),
          ...(record.ticker === undefined ? {} : { ticker: record.ticker }),
          ...(record.officialWebsite === undefined ? {} : { official_website: record.officialWebsite })
        },
        confidence: 0.52,
        provenance_note: [
          `Wikidata collaborative entity ${record.qid}`,
          record.itemUrl,
          record.description === undefined ? undefined : `description=${record.description}`,
          record.lei === undefined ? undefined : `lei=${record.lei}`,
          record.cik === undefined ? undefined : `cik=${record.cik}`,
          record.isin === undefined ? undefined : `isin=${record.isin}`
        ]
          .filter((item): item is string => item !== undefined)
          .join("; ")
      })
    );
}

export function extractWikidataEntityDataProfile(raw: RawDocument<Uint8Array>, language = "en"): WikidataEntityDataProfile {
  const parsed = JSON.parse(Buffer.from(raw.body).toString("utf8")) as unknown;
  const root = requireRecord(parsed, "Wikidata EntityData response");
  const entities = requireRecord(root["entities"], "Wikidata EntityData entities");
  const firstEntity = firstRecordEntry(entities, "Wikidata EntityData entities");
  const qid = normalizeQid(firstEntity.key);
  const entity = firstEntity.value;
  const label = localizedValue(requireRecord(entity["labels"], "Wikidata labels"), language) ?? qid;
  const description = localizedValue(optionalRecord(entity["descriptions"]) ?? {}, language);
  const aliases = localizedList(optionalRecord(entity["aliases"]) ?? {}, language);
  const claims = requireRecord(entity["claims"], "Wikidata claims");
  const lei = firstString(claimStringValues(claims, "P1278"));
  const isin = firstString(claimStringValues(claims, "P946"));
  const cik = firstString(claimStringValues(claims, "P5531"));
  const ticker = firstString(claimStringValues(claims, "P249"));
  return {
    qid,
    label,
    ...(description === undefined ? {} : { description }),
    aliases,
    official_websites: claimStringValues(claims, "P856"),
    identifiers: {
      wikidata_qid: qid,
      ...(lei === undefined ? {} : { lei }),
      ...(isin === undefined ? {} : { isin }),
      ...(cik === undefined ? {} : { cik }),
      ...(ticker === undefined ? {} : { ticker })
    },
    industry_qids: claimEntityIds(claims, "P452"),
    country_qids: claimEntityIds(claims, "P17")
  };
}

function normalizeWikidataDocument(raw: RawDocument<Uint8Array>): NormalizedDocument {
  const requestKind = raw.metadata["wikidata_request_kind"] === "entity-data" ? "entity-data" : "search";
  const text =
    requestKind === "entity-data"
      ? formatWikidataEntityDataProfileText(extractWikidataEntityDataProfile(raw))
      : extractWikidataCandidates(raw).map(formatEntitySourceCandidateText).join("\n\n");
  return normalizeTextDocument({
    raw,
    documentType: "company_registry",
    parserVersion: requestKind === "entity-data" ? "wikidata-entitydata-json-v1" : "wikidata-sparql-json-v1",
    text,
    extraMetadata: { wikidata_request_kind: requestKind }
  });
}

function formatEntitySourceCandidateText(candidate: EntitySourceCandidate): string {
  return [
    `name: ${candidate.name}`,
    `qid: ${candidate.external_id}`,
    candidate.company_type === undefined ? undefined : `industry: ${candidate.company_type}`,
    candidate.identifiers["official_website"] === undefined ? undefined : `official_website: ${candidate.identifiers["official_website"]}`,
    candidate.identifiers["lei"] === undefined ? undefined : `lei: ${candidate.identifiers["lei"]}`,
    candidate.identifiers["isin"] === undefined ? undefined : `isin: ${candidate.identifiers["isin"]}`,
    candidate.identifiers["cik"] === undefined ? undefined : `cik: ${candidate.identifiers["cik"]}`,
    candidate.identifiers["ticker"] === undefined ? undefined : `ticker: ${candidate.identifiers["ticker"]}`,
    candidate.alternative_names.length === 0 ? undefined : `alternative_names: ${candidate.alternative_names.join("; ")}`,
    `provenance: ${candidate.provenance_note}`
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function formatWikidataEntityDataProfileText(profile: WikidataEntityDataProfile): string {
  return [
    `name: ${profile.label}`,
    `qid: ${profile.qid}`,
    profile.description === undefined ? undefined : `description: ${profile.description}`,
    profile.aliases.length === 0 ? undefined : `aliases: ${profile.aliases.join("; ")}`,
    profile.official_websites.length === 0 ? undefined : `official_websites: ${profile.official_websites.join("; ")}`,
    profile.identifiers.lei === undefined ? undefined : `lei: ${profile.identifiers.lei}`,
    profile.identifiers.isin === undefined ? undefined : `isin: ${profile.identifiers.isin}`,
    profile.identifiers.cik === undefined ? undefined : `cik: ${profile.identifiers.cik}`,
    profile.identifiers.ticker === undefined ? undefined : `ticker: ${profile.identifiers.ticker}`,
    profile.industry_qids.length === 0 ? undefined : `industry_qids: ${profile.industry_qids.join("; ")}`,
    profile.country_qids.length === 0 ? undefined : `country_qids: ${profile.country_qids.join("; ")}`
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function parseWikidataSparqlPayload(bytes: Uint8Array): WikidataSearchRecord[] {
  const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  const root = requireRecord(parsed, "Wikidata SPARQL response");
  const results = requireRecord(root["results"], "Wikidata SPARQL results");
  const bindings = results["bindings"];
  if (!Array.isArray(bindings)) throw new Error("Wikidata SPARQL results.bindings must be an array");
  return groupSearchRows(bindings.map((item, index) => parseSparqlRow(item, index)));
}

function parseSparqlRow(value: unknown, index: number): WikidataSearchRecord {
  const row = requireSparqlRow(value, `Wikidata SPARQL bindings[${index}]`);
  const itemUrl = requireBindingValue(row, "item", `Wikidata SPARQL bindings[${index}].item`);
  const qid = qidFromEntityUrl(itemUrl, `Wikidata SPARQL bindings[${index}].item`);
  const label = requireBindingValue(row, "itemLabel", `Wikidata SPARQL bindings[${index}].itemLabel`);
  const description = optionalBindingValue(row, "itemDescription");
  const officialWebsite = optionalBindingValue(row, "officialWebsite");
  const lei = optionalBindingValue(row, "lei");
  const isin = optionalBindingValue(row, "isin");
  const cik = optionalBindingValue(row, "cik");
  const ticker = optionalBindingValue(row, "ticker");
  return {
    qid,
    itemUrl,
    label,
    ...(description === undefined ? {} : { description }),
    ...(officialWebsite === undefined ? {} : { officialWebsite }),
    ...(lei === undefined ? {} : { lei }),
    ...(isin === undefined ? {} : { isin }),
    ...(cik === undefined ? {} : { cik }),
    ...(ticker === undefined ? {} : { ticker }),
    countryLabels: optionalBindingList(row, "countryLabel"),
    industryLabels: optionalBindingList(row, "industryLabel")
  };
}

function groupSearchRows(rows: WikidataSearchRecord[]): WikidataSearchRecord[] {
  const byQid = new Map<string, WikidataSearchRecord>();
  for (const row of rows) {
    const existing = byQid.get(row.qid);
    if (existing === undefined) {
      byQid.set(row.qid, row);
      continue;
    }
    byQid.set(row.qid, {
      ...existing,
      ...firstOptionalFields(existing, row),
      countryLabels: uniqueStrings([...existing.countryLabels, ...row.countryLabels]),
      industryLabels: uniqueStrings([...existing.industryLabels, ...row.industryLabels])
    });
  }
  return [...byQid.values()];
}

function firstOptionalFields(existing: WikidataSearchRecord, incoming: WikidataSearchRecord): Partial<WikidataSearchRecord> {
  return {
    ...(existing.description === undefined && incoming.description !== undefined ? { description: incoming.description } : {}),
    ...(existing.officialWebsite === undefined && incoming.officialWebsite !== undefined ? { officialWebsite: incoming.officialWebsite } : {}),
    ...(existing.lei === undefined && incoming.lei !== undefined ? { lei: incoming.lei } : {}),
    ...(existing.isin === undefined && incoming.isin !== undefined ? { isin: incoming.isin } : {}),
    ...(existing.cik === undefined && incoming.cik !== undefined ? { cik: incoming.cik } : {}),
    ...(existing.ticker === undefined && incoming.ticker !== undefined ? { ticker: incoming.ticker } : {})
  };
}

function alternativeNames(record: WikidataSearchRecord): string[] {
  return uniqueStrings(
    [record.description, record.officialWebsite, ...record.countryLabels, ...record.industryLabels].filter((value): value is string => value !== undefined)
  );
}

function claimStringValues(claims: Record<string, unknown>, propertyId: string): string[] {
  const claimList = claims[propertyId];
  if (!Array.isArray(claimList)) return [];
  return uniqueStrings(
    claimList.flatMap((claim) => {
      const value = claimDataValue(claim);
      return typeof value === "string" && value.trim().length > 0 ? [value.trim()] : [];
    })
  );
}

function claimEntityIds(claims: Record<string, unknown>, propertyId: string): string[] {
  const claimList = claims[propertyId];
  if (!Array.isArray(claimList)) return [];
  return uniqueStrings(
    claimList.flatMap((claim) => {
      const value = optionalRecord(claimDataValue(claim));
      const entityType = value === undefined ? undefined : optionalString(value["entity-type"]);
      const numericId = value === undefined ? undefined : optionalNumber(value["numeric-id"]);
      return entityType === "item" && numericId !== undefined ? [`Q${numericId}`] : [];
    })
  );
}

async function firstTask(tasks: AsyncIterable<FetchTask>): Promise<FetchTask> {
  for await (const task of tasks) return task;
  throw new Error("Wikidata adapter produced no fetch task");
}

function normalizeAdapterInput(input: WikidataAdapterInput): Required<WikidataSearchInput> | Required<WikidataEntityDataInput> {
  if (input.kind === "entity-data") {
    return {
      kind: "entity-data",
      qid: normalizeQid(input.qid),
      language: normalizeLanguage(input.language)
    };
  }
  return normalizeSearchInput(input);
}

function normalizeSearchInput(input: WikidataSearchInput): Required<WikidataSearchInput> {
  const query = input.query.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (query.length === 0) throw new Error("Wikidata query must not be empty");
  return {
    kind: "search",
    query,
    language: normalizeLanguage(input.language),
    limit: clampLimit(input.limit)
  };
}

function stableInputId(input: Required<WikidataSearchInput> | Required<WikidataEntityDataInput>): string {
  const stable =
    input.kind === "entity-data" ? `${input.kind}|${input.qid}|${input.language}` : `${input.kind}|${input.query}|${input.language}|${input.limit}`;
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

function sparqlSha256(input: WikidataSearchInput): string {
  return createHash("sha256").update(buildWikidataCompanySearchSparql(input)).digest("hex");
}

function sparqlStringLiteral(value: string): string {
  return JSON.stringify(value);
}

function requireSparqlRow(value: unknown, label: string): WikidataSparqlRow {
  const row = requireRecord(value, label);
  const result: WikidataSparqlRow = {};
  for (const [key, item] of Object.entries(row)) {
    if (!isSparqlBinding(item)) throw new Error(`${label}.${key} must be a SPARQL binding`);
    result[key] = item;
  }
  return result;
}

function isSparqlBinding(value: unknown): value is WikidataSparqlBinding {
  const binding = optionalRecord(value);
  return binding !== undefined && typeof binding["type"] === "string" && typeof binding["value"] === "string";
}

function requireBindingValue(row: WikidataSparqlRow, key: string, label: string): string {
  const value = optionalBindingValue(row, key);
  if (value === undefined) throw new Error(`${label} must be present`);
  return value;
}

function optionalBindingValue(row: WikidataSparqlRow, key: string): string | undefined {
  const value = row[key]?.value.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function optionalBindingList(row: WikidataSparqlRow, key: string): string[] {
  const value = optionalBindingValue(row, key);
  return value === undefined ? [] : [value];
}

function qidFromEntityUrl(value: string, label: string): string {
  const lastSlash = value.lastIndexOf("/");
  const qid = lastSlash < 0 ? value : value.slice(lastSlash + 1);
  return normalizeQidWithLabel(qid, label);
}

function normalizeQid(value: string): string {
  return normalizeQidWithLabel(value, "Wikidata QID");
}

function normalizeQidWithLabel(value: string, label: string): string {
  const qid = value.trim().toUpperCase();
  if (!/^Q[1-9][0-9]*$/.test(qid)) throw new Error(`${label} must be a Wikidata QID`);
  return qid;
}

function localizedValue(records: Record<string, unknown>, language: string): string | undefined {
  const preferred = optionalRecord(records[language]) ?? optionalRecord(records["en"]);
  return preferred === undefined ? undefined : optionalString(preferred["value"]);
}

function localizedList(records: Record<string, unknown>, language: string): string[] {
  const preferred = records[language] ?? records["en"];
  if (!Array.isArray(preferred)) return [];
  return uniqueStrings(
    preferred.flatMap((item) => {
      const record = optionalRecord(item);
      const value = record === undefined ? undefined : optionalString(record["value"]);
      return value === undefined ? [] : [value];
    })
  );
}

function claimDataValue(claim: unknown): unknown {
  const claimRecord = optionalRecord(claim);
  const mainsnak = claimRecord === undefined ? undefined : optionalRecord(claimRecord["mainsnak"]);
  const datavalue = mainsnak === undefined ? undefined : optionalRecord(mainsnak["datavalue"]);
  return datavalue?.["value"];
}

function firstRecordEntry(records: Record<string, unknown>, label: string): { key: string; value: Record<string, unknown> } {
  const entries = Object.entries(records);
  const first = entries[0];
  if (first === undefined) throw new Error(`${label} must include at least one entity`);
  return { key: first[0], value: requireRecord(first[1], `${label}.${first[0]}`) };
}

function firstString(values: string[]): string | undefined {
  return values[0];
}

function normalizeLanguage(value: string | undefined): string {
  const language = value?.trim().toLowerCase() ?? "en";
  if (!/^[a-z]{2,3}(-[a-z0-9]+)?$/.test(language)) throw new Error(`Unsupported Wikidata language: ${language}`);
  return language;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error(`Unsupported Wikidata limit: ${limit}`);
  return limit;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = value.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (cleaned.length === 0) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
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

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}
