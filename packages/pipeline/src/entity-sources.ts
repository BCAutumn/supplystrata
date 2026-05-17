import type pg from "pg";
import type { EntitySourceLookupResult } from "@supplystrata/entity-source";
import { buildEntitySourceReviewCandidate } from "@supplystrata/review-candidates";
import { enqueueReviewCandidates } from "@supplystrata/review-store";
import { lookupCompaniesHouseCompanies, type CompaniesHouseSearchInput } from "@supplystrata/sources-companies-house";
import { lookupOpenCorporatesCompanies, type OpenCorporatesSearchInput } from "@supplystrata/sources-opencorporates";

export type EntityLookupSource = "all" | "opencorporates" | "companies-house";

export interface EntityLookupInput {
  query: string;
  source: EntityLookupSource;
  jurisdictionCode?: string;
  limit: number;
}

export interface EntityLookupSummary {
  query: string;
  results: EntitySourceLookupResult[];
}

export interface EntityReviewEnqueueSummary {
  query: string;
  candidates: number;
  inserted: number;
  skipped: number;
  errors: { source_adapter_id: string; message: string }[];
}

export async function lookupEntitySourceCandidates(input: EntityLookupInput): Promise<EntityLookupSummary> {
  const query = input.query.trim();
  if (query.length === 0) throw new Error("Entity lookup query must not be empty");
  const sources = input.source === "all" ? (["opencorporates", "companies-house"] as const) : ([input.source] as const);
  const results: EntitySourceLookupResult[] = [];

  for (const source of sources) {
    if (source === "opencorporates") {
      results.push(
        await lookupOpenCorporatesSource({
          query,
          limit: input.limit,
          ...(input.jurisdictionCode === undefined ? {} : { jurisdictionCode: input.jurisdictionCode })
        })
      );
    }
    if (source === "companies-house") {
      results.push(await lookupCompaniesHouseSource({ query, limit: input.limit }));
    }
  }

  return { query, results };
}

export async function enqueueEntitySourceReviewCandidates(pool: pg.Pool, input: EntityLookupInput): Promise<EntityReviewEnqueueSummary> {
  const lookup = await lookupEntitySourceCandidates(input);
  const errors = lookup.results
    .filter((result): result is EntitySourceLookupResult & { error_message: string } => result.error_message !== undefined)
    .map((result) => ({ source_adapter_id: result.source_adapter_id, message: result.error_message }));
  const candidates = lookup.results.flatMap((result) =>
    result.candidates.map((candidate) => buildEntitySourceReviewCandidate({ surface: lookup.query, candidate }))
  );
  const result = await enqueueReviewCandidates(pool, candidates);
  return {
    query: lookup.query,
    candidates: candidates.length,
    inserted: result.inserted,
    skipped: result.skipped,
    errors
  };
}

async function lookupOpenCorporatesSource(input: OpenCorporatesSearchInput): Promise<EntitySourceLookupResult> {
  try {
    const result = await lookupOpenCorporatesCompanies(input);
    return {
      source_adapter_id: "opencorporates",
      source_url: result.raw.url,
      candidates: result.candidates
    };
  } catch (error) {
    return {
      source_adapter_id: "opencorporates",
      candidates: [],
      error_message: errorMessage(error)
    };
  }
}

async function lookupCompaniesHouseSource(input: CompaniesHouseSearchInput): Promise<EntitySourceLookupResult> {
  try {
    const result = await lookupCompaniesHouseCompanies(input);
    return {
      source_adapter_id: "companies-house",
      source_url: result.raw.url,
      candidates: result.candidates
    };
  } catch (error) {
    return {
      source_adapter_id: "companies-house",
      candidates: [],
      error_message: errorMessage(error)
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
