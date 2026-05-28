import type { Env } from "@supplystrata/config";
import { tryResolveEntityId } from "@supplystrata/db/read";
import type { DatabaseStore } from "@supplystrata/db/write";
import { ensureEntitySourceCandidateEntity, ensureSecListedCompanyEntity } from "@supplystrata/entity-import";
import type { EntitySourceAdapterId, EntitySourceCandidate, EntitySourceLookupResult } from "@supplystrata/entity-source";
import { disambiguate_entity, type DisambiguateEntityCandidate, type DisambiguateEntityInput, type LlmHelperOptions } from "@supplystrata/llm-helpers";
import { lookupSecCompanyDirectory, type SecCompanyDirectoryLookupResult, type SecCompanyDirectoryRecord } from "@supplystrata/sources-sec-edgar";
import { sourceWorkflowAdapterContextInput } from "./adapter-context.js";
import { buildEntityResolutionLookupQueries } from "./entity-resolution-backlog.js";
import { lookupEntitySourceCandidates, type EntityLookupInput, type EntityLookupSummary } from "./entity-sources.js";

export type ResearchCompanyEntityBootstrapStatus = "resolved" | "unresolved" | "ambiguous" | "unreachable";

type UniversalIdentitySource = Extract<EntitySourceAdapterId, "gleif" | "openfigi" | "wikidata">;
type ResearchBootstrapSourceAdapterId = EntitySourceAdapterId | "sec-edgar";

export interface ResearchCompanyEntityBootstrapInput {
  query: string;
  env: Env;
  now: string;
  reviewer?: string;
  llm?: LlmHelperOptions;
}

export interface ResearchCompanyEntityBootstrapResult {
  status: ResearchCompanyEntityBootstrapStatus;
  query: string;
  normalized_query: string;
  entity_id?: string;
  source_adapter_id?: ResearchBootstrapSourceAdapterId;
  source_adapter_ids?: ResearchBootstrapSourceAdapterId[];
  source_url?: string;
  candidate_count?: number;
  disambiguation_status?: DisambiguateEntityCandidate["status"];
  reason?: string;
}

export interface ResearchCompanyEntityBootstrapRuntime {
  lookupEntityCandidates?: (
    input: EntityLookupInput,
    runtime: { adapterContextInput: ReturnType<typeof sourceWorkflowAdapterContextInput> }
  ) => Promise<EntityLookupSummary>;
  lookupSecCompanyDirectory?: (input: { query: string; limit: number }, runtime: { userAgent: string }) => Promise<SecCompanyDirectoryLookupResult>;
  disambiguateEntity?: (input: DisambiguateEntityInput, options?: LlmHelperOptions) => Promise<DisambiguateEntityCandidate>;
}

interface CandidateHit {
  query: string;
  candidate: EntitySourceCandidate;
}

interface UniversalLookupSummary {
  hits: CandidateHit[];
  results: EntitySourceLookupResult[];
}

const UNIVERSAL_IDENTITY_SOURCES: readonly UniversalIdentitySource[] = ["gleif", "openfigi", "wikidata"];

export async function ensureResearchCompanyEntity(
  store: DatabaseStore,
  input: ResearchCompanyEntityBootstrapInput,
  runtime: ResearchCompanyEntityBootstrapRuntime = {}
): Promise<ResearchCompanyEntityBootstrapResult> {
  const query = input.query.trim();
  const normalizedQuery = normalizeResearchEntityQuery(query);
  const existing = await resolveExistingEntity(store, query, normalizedQuery);
  if (existing !== undefined) return { status: "resolved", query, normalized_query: normalizedQuery, entity_id: existing };

  const lookup = await lookupUniversalIdentityCandidates(input, normalizedQuery, runtime);
  const sourceAdapterIds = uniqueSourceAdapterIds(lookup.results);
  const sourceUrl = firstSourceUrl(lookup.results);
  const candidates = dedupeCandidateHits(lookup.hits);

  if (lookup.results.length > 0 && lookup.results.every((result) => result.error_message !== undefined && result.candidates.length === 0)) {
    return {
      status: "unreachable",
      query,
      normalized_query: normalizedQuery,
      source_adapter_ids: sourceAdapterIds,
      candidate_count: 0,
      reason: lookup.results.map((result) => `${result.source_adapter_id}: ${result.error_message ?? "unknown error"}`).join("; ")
    };
  }

  if (candidates.length === 0) {
    const secBranch = await tryResolveSecListedCompanyBranch(store, input, normalizedQuery, sourceAdapterIds, runtime);
    if (secBranch !== undefined) return secBranch;
    return {
      status: "unresolved",
      query,
      normalized_query: normalizedQuery,
      source_adapter_ids: sourceAdapterIds,
      ...(sourceUrl === undefined ? {} : { source_url: sourceUrl }),
      candidate_count: 0,
      reason: "Universal identity bootstrap found no GLEIF/OpenFIGI/Wikidata candidates for the company query."
    };
  }

  const authoritativeCandidates = candidates.filter((hit) => isAuthoritativeBootstrapCandidate(hit.candidate));
  if (authoritativeCandidates.length !== 1) {
    if (authoritativeCandidates.length === 0) {
      const secBranch = await tryResolveSecListedCompanyBranch(store, input, normalizedQuery, sourceAdapterIds, runtime);
      if (secBranch !== undefined) return secBranch;
    }
    const disambiguation = await disambiguateCandidates(query, candidates, input.llm, runtime);
    return {
      status: "ambiguous",
      query,
      normalized_query: normalizedQuery,
      source_adapter_ids: sourceAdapterIds,
      ...(sourceUrl === undefined ? {} : { source_url: sourceUrl }),
      candidate_count: candidates.length,
      disambiguation_status: disambiguation.status,
      reason:
        authoritativeCandidates.length === 0
          ? "Identity sources returned candidates, but none were authoritative enough for automatic entity bootstrap."
          : "GLEIF returned multiple authoritative candidates; automatic bootstrap requires exactly one authoritative identity candidate."
    };
  }

  const selected = authoritativeCandidates[0];
  if (selected === undefined) {
    return {
      status: "ambiguous",
      query,
      normalized_query: normalizedQuery,
      source_adapter_ids: sourceAdapterIds,
      ...(sourceUrl === undefined ? {} : { source_url: sourceUrl }),
      candidate_count: candidates.length,
      reason: "Universal identity bootstrap could not select a usable authoritative candidate."
    };
  }

  const imported = await store.transaction((client) =>
    ensureEntitySourceCandidateEntity(client, {
      surface: query,
      candidate: selected.candidate,
      reviewer: input.reviewer ?? "research-entity-bootstrap"
    })
  );
  if (imported.status === "blocked") {
    return {
      status: "ambiguous",
      query,
      normalized_query: normalizedQuery,
      source_adapter_id: selected.candidate.source_adapter_id,
      source_adapter_ids: sourceAdapterIds,
      source_url: selected.candidate.source_url,
      candidate_count: candidates.length,
      reason: imported.reason
    };
  }

  return {
    status: "resolved",
    query,
    normalized_query: normalizedQuery,
    entity_id: imported.entity_id,
    source_adapter_id: selected.candidate.source_adapter_id,
    source_adapter_ids: sourceAdapterIds,
    source_url: selected.candidate.source_url,
    candidate_count: candidates.length
  };
}

export function normalizeResearchEntityQuery(query: string): string {
  const cleaned = query.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!cleaned.toUpperCase().startsWith("ENT-")) return cleaned;
  return cleaned.slice(4).replace(/-/g, " ").trim();
}

export function buildUniversalIdentityLookupQueries(surface: string): string[] {
  return buildEntityResolutionLookupQueries(normalizeResearchEntityQuery(surface));
}

async function tryResolveSecListedCompanyBranch(
  store: DatabaseStore,
  input: ResearchCompanyEntityBootstrapInput,
  normalizedQuery: string,
  sourceAdapterIds: readonly ResearchBootstrapSourceAdapterId[],
  runtime: ResearchCompanyEntityBootstrapRuntime
): Promise<ResearchCompanyEntityBootstrapResult | undefined> {
  if (!looksLikeUsListedTickerOrSecEntity(normalizedQuery)) return undefined;
  const lookup = runtime.lookupSecCompanyDirectory ?? lookupSecCompanyDirectory;
  let secLookup: SecCompanyDirectoryLookupResult;
  try {
    secLookup = await lookup({ query: normalizedQuery, limit: 5 }, { userAgent: sourceWorkflowAdapterContextInput(input.env, { now: input.now }).userAgent });
  } catch (error) {
    return {
      status: "unreachable",
      query: input.query.trim(),
      normalized_query: normalizedQuery,
      source_adapter_ids: appendSourceAdapterId(sourceAdapterIds, "sec-edgar"),
      candidate_count: 0,
      reason: errorMessage(error)
    };
  }

  if (secLookup.candidates.length === 0) return undefined;
  if (secLookup.candidates.length > 1) {
    return {
      status: "ambiguous",
      query: input.query.trim(),
      normalized_query: normalizedQuery,
      source_adapter_id: "sec-edgar",
      source_adapter_ids: appendSourceAdapterId(sourceAdapterIds, "sec-edgar"),
      source_url: secLookup.source_url,
      candidate_count: secLookup.candidates.length,
      reason: "SEC listed company directory returned multiple US branch candidates; automatic bootstrap requires a unique ticker or company match."
    };
  }

  const candidate = secLookup.candidates[0];
  if (candidate === undefined) return undefined;
  return importSecListedCompanyCandidate(store, input, normalizedQuery, sourceAdapterIds, candidate);
}

async function importSecListedCompanyCandidate(
  store: DatabaseStore,
  input: ResearchCompanyEntityBootstrapInput,
  normalizedQuery: string,
  sourceAdapterIds: readonly ResearchBootstrapSourceAdapterId[],
  candidate: SecCompanyDirectoryRecord
): Promise<ResearchCompanyEntityBootstrapResult> {
  const imported = await store.transaction((client) => ensureSecListedCompanyEntity(client, candidate, input.reviewer ?? "research-entity-bootstrap"));
  if (imported.status === "blocked") {
    return {
      status: "ambiguous",
      query: input.query.trim(),
      normalized_query: normalizedQuery,
      source_adapter_id: "sec-edgar",
      source_adapter_ids: appendSourceAdapterId(sourceAdapterIds, "sec-edgar"),
      source_url: candidate.source_url,
      candidate_count: 1,
      reason: imported.reason
    };
  }
  return {
    status: "resolved",
    query: input.query.trim(),
    normalized_query: normalizedQuery,
    entity_id: imported.entity_id,
    source_adapter_id: "sec-edgar",
    source_adapter_ids: appendSourceAdapterId(sourceAdapterIds, "sec-edgar"),
    source_url: candidate.source_url,
    candidate_count: 1
  };
}

async function resolveExistingEntity(store: DatabaseStore, query: string, normalizedQuery: string): Promise<string | undefined> {
  const existing = await tryResolveEntityId(store.read, query);
  if (existing !== undefined) return existing;
  if (normalizedQuery === query) return undefined;
  return tryResolveEntityId(store.read, normalizedQuery);
}

async function lookupUniversalIdentityCandidates(
  input: ResearchCompanyEntityBootstrapInput,
  normalizedQuery: string,
  runtime: ResearchCompanyEntityBootstrapRuntime
): Promise<UniversalLookupSummary> {
  const adapterContextInput = sourceWorkflowAdapterContextInput(input.env, { now: input.now });
  const lookup = runtime.lookupEntityCandidates ?? lookupEntitySourceCandidates;
  const queries = buildUniversalIdentityLookupQueries(normalizedQuery);
  const summaries = await Promise.all(
    queries.flatMap((lookupQuery) =>
      UNIVERSAL_IDENTITY_SOURCES.map((source) =>
        lookup(
          {
            query: lookupQuery,
            source,
            limit: 5,
            reviewSurface: input.query
          },
          { adapterContextInput }
        )
      )
    )
  );
  const results = summaries.flatMap((summary) => summary.results);
  const hits = summaries.flatMap((summary) => summary.results.flatMap((result) => result.candidates.map((candidate) => ({ query: summary.query, candidate }))));
  return { hits, results };
}

function isAuthoritativeBootstrapCandidate(candidate: EntitySourceCandidate): boolean {
  return candidate.source_adapter_id === "gleif" && typeof candidate.identifiers.lei === "string" && candidate.identifiers.lei.trim().length > 0;
}

async function disambiguateCandidates(
  surface: string,
  candidates: readonly CandidateHit[],
  options: LlmHelperOptions | undefined,
  runtime: ResearchCompanyEntityBootstrapRuntime
): Promise<DisambiguateEntityCandidate> {
  const disambiguate = runtime.disambiguateEntity ?? disambiguate_entity;
  return disambiguate(
    {
      surface,
      candidates: candidates.map((hit) => ({
        entity_id: candidateDisambiguationId(hit.candidate),
        label: hit.candidate.name,
        confidence: hit.candidate.confidence,
        reason: `${hit.candidate.source_adapter_id}: ${hit.candidate.provenance_note}`
      }))
    },
    options
  );
}

function dedupeCandidateHits(hits: readonly CandidateHit[]): CandidateHit[] {
  const seen = new Set<string>();
  const result: CandidateHit[] = [];
  for (const hit of hits) {
    const key = candidateDisambiguationId(hit.candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(hit);
  }
  return result;
}

function candidateDisambiguationId(candidate: EntitySourceCandidate): string {
  return `${candidate.source_adapter_id}:${candidate.external_id}`;
}

function uniqueSourceAdapterIds(results: readonly EntitySourceLookupResult[]): ResearchBootstrapSourceAdapterId[] {
  const seen = new Set<ResearchBootstrapSourceAdapterId>();
  const ids: ResearchBootstrapSourceAdapterId[] = [];
  for (const result of results) {
    if (seen.has(result.source_adapter_id)) continue;
    seen.add(result.source_adapter_id);
    ids.push(result.source_adapter_id);
  }
  return ids;
}

function firstSourceUrl(results: readonly EntitySourceLookupResult[]): string | undefined {
  return results.find((result) => result.source_url !== undefined)?.source_url;
}

function appendSourceAdapterId(
  sourceAdapterIds: readonly ResearchBootstrapSourceAdapterId[],
  sourceAdapterId: ResearchBootstrapSourceAdapterId
): ResearchBootstrapSourceAdapterId[] {
  return sourceAdapterIds.includes(sourceAdapterId) ? [...sourceAdapterIds] : [...sourceAdapterIds, sourceAdapterId];
}

function looksLikeUsListedTickerOrSecEntity(query: string): boolean {
  return /^[A-Za-z][A-Za-z0-9.-]{0,9}(:US)?$/.test(query) || /^ENT-[A-Za-z0-9-]+$/.test(query);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
