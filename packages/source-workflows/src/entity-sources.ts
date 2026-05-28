import type { DatabaseStore } from "@supplystrata/db/write";
import type { EntitySourceLookupResult } from "@supplystrata/entity-source";
import { buildEntitySourceReviewCandidate } from "@supplystrata/review-candidates";
import { enqueueReviewCandidatesTransactionally } from "@supplystrata/review-store";
import type { CreateAdapterContextInput } from "@supplystrata/source-adapter-runtime";
import { createGleifLeiAdapterContext, lookupGleifLeiRecords, type GleifLeiSearchInput } from "@supplystrata/sources-gleif";
import { createOpenFigiAdapterContext, lookupOpenFigiInstruments, type OpenFigiSearchInput } from "@supplystrata/sources-openfigi";
import { createCompaniesHouseAdapterContext, lookupCompaniesHouseCompanies, type CompaniesHouseSearchInput } from "@supplystrata/sources-companies-house";
import { createOpenCorporatesAdapterContext, lookupOpenCorporatesCompanies, type OpenCorporatesSearchInput } from "@supplystrata/sources-opencorporates";

export type EntityLookupSource = "all" | "gleif" | "openfigi" | "opencorporates" | "companies-house";

export interface EntityLookupInput {
  query: string;
  source: EntityLookupSource;
  jurisdictionCode?: string;
  limit: number;
  reviewSurface?: string;
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

export interface EntityLookupRuntime {
  adapterContextInput: CreateAdapterContextInput;
}

export async function lookupEntitySourceCandidates(input: EntityLookupInput, runtime: EntityLookupRuntime): Promise<EntityLookupSummary> {
  const query = input.query.trim();
  if (query.length === 0) throw new Error("Entity lookup query must not be empty");
  const sources: Exclude<EntityLookupSource, "all">[] = input.source === "all" ? ["gleif", "openfigi", "opencorporates", "companies-house"] : [input.source];
  const results: EntitySourceLookupResult[] = [];

  for (const source of sources) {
    if (source === "gleif") {
      results.push(await lookupGleifSource({ query, limit: input.limit }, runtime));
    }
    if (source === "openfigi") {
      results.push(await lookupOpenFigiSource({ query, limit: input.limit }, runtime));
    }
    if (source === "opencorporates") {
      results.push(
        await lookupOpenCorporatesSource(
          {
            query,
            limit: input.limit,
            ...(input.jurisdictionCode === undefined ? {} : { jurisdictionCode: input.jurisdictionCode })
          },
          runtime
        )
      );
    }
    if (source === "companies-house") {
      results.push(await lookupCompaniesHouseSource({ query, limit: input.limit }, runtime));
    }
  }

  return { query, results };
}

export async function enqueueEntitySourceReviewCandidates(
  store: DatabaseStore,
  input: EntityLookupInput,
  runtime: EntityLookupRuntime
): Promise<EntityReviewEnqueueSummary> {
  const lookup = await lookupEntitySourceCandidates(input, runtime);
  const errors = lookup.results
    .filter((result): result is EntitySourceLookupResult & { error_message: string } => result.error_message !== undefined)
    .map((result) => ({ source_adapter_id: result.source_adapter_id, message: result.error_message }));
  const candidates = lookup.results.flatMap((result) =>
    result.candidates.map((candidate) => buildEntitySourceReviewCandidate({ surface: input.reviewSurface ?? lookup.query, candidate }))
  );
  const result = await enqueueReviewCandidatesTransactionally(store, candidates);
  return {
    query: lookup.query,
    candidates: candidates.length,
    inserted: result.inserted,
    skipped: result.skipped,
    errors
  };
}

async function lookupGleifSource(input: GleifLeiSearchInput, runtime: EntityLookupRuntime): Promise<EntitySourceLookupResult> {
  try {
    const result = await lookupGleifLeiRecords(input, createGleifLeiAdapterContext(runtime.adapterContextInput));
    return {
      source_adapter_id: "gleif",
      source_url: result.raw.url,
      candidates: result.candidates
    };
  } catch (error) {
    return {
      source_adapter_id: "gleif",
      candidates: [],
      error_message: errorMessage(error)
    };
  }
}

async function lookupOpenFigiSource(input: OpenFigiSearchInput, runtime: EntityLookupRuntime): Promise<EntitySourceLookupResult> {
  try {
    const result = await lookupOpenFigiInstruments(input, createOpenFigiAdapterContext(runtime.adapterContextInput));
    return {
      source_adapter_id: "openfigi",
      source_url: result.raw.url,
      candidates: result.candidates
    };
  } catch (error) {
    return {
      source_adapter_id: "openfigi",
      candidates: [],
      error_message: errorMessage(error)
    };
  }
}

async function lookupOpenCorporatesSource(input: OpenCorporatesSearchInput, runtime: EntityLookupRuntime): Promise<EntitySourceLookupResult> {
  try {
    const result = await lookupOpenCorporatesCompanies(input, createOpenCorporatesAdapterContext(runtime.adapterContextInput));
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

async function lookupCompaniesHouseSource(input: CompaniesHouseSearchInput, runtime: EntityLookupRuntime): Promise<EntitySourceLookupResult> {
  try {
    const result = await lookupCompaniesHouseCompanies(input, createCompaniesHouseAdapterContext(runtime.adapterContextInput));
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
