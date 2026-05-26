import type { DatabaseStore } from "@supplystrata/db/write";
import type { CreateAdapterContextInput } from "@supplystrata/source-adapter-runtime";
import { enqueueEntitySourceReviewCandidates, type EntityLookupSource, type EntityReviewEnqueueSummary } from "./entity-sources.js";

export interface EntityResolutionBacklogReviewInput {
  queries: readonly string[];
  source: EntityLookupSource;
  limitPerQuery: number;
}

export interface EntityResolutionBacklogReviewItem {
  query: string;
  candidates: number;
  inserted: number;
  skipped: number;
  errors: { source_adapter_id: string; message: string }[];
}

export interface EntityResolutionBacklogReviewSummary {
  source: EntityLookupSource;
  limit_per_query: number;
  requested_queries: number;
  processed_queries: number;
  candidates: number;
  inserted: number;
  skipped: number;
  errors: number;
  items: EntityResolutionBacklogReviewItem[];
}

export interface EntityResolutionBacklogRuntime {
  adapterContextInput: CreateAdapterContextInput;
}

export async function enqueueEntityResolutionBacklogReviewCandidates(
  store: DatabaseStore,
  input: EntityResolutionBacklogReviewInput,
  runtime: EntityResolutionBacklogRuntime
): Promise<EntityResolutionBacklogReviewSummary> {
  const queries = normalizeEntityResolutionQueries(input.queries);
  if (!Number.isInteger(input.limitPerQuery) || input.limitPerQuery <= 0) {
    throw new Error(`Entity resolution backlog candidate limit must be a positive integer: ${input.limitPerQuery}`);
  }

  const items: EntityResolutionBacklogReviewItem[] = [];
  for (const query of queries) {
    const result = await enqueueEntitySourceReviewCandidates(
      store,
      {
        query,
        source: input.source,
        limit: input.limitPerQuery
      },
      runtime
    );
    items.push(entityReviewEnqueueResultToBacklogItem(result));
  }

  return summarizeEntityResolutionBacklogReview({
    source: input.source,
    limit_per_query: input.limitPerQuery,
    requested_queries: input.queries.length,
    items
  });
}

export function normalizeEntityResolutionQueries(queries: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const query of queries) {
    const cleaned = query.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (cleaned.length === 0) continue;
    const key = cleaned.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function entityReviewEnqueueResultToBacklogItem(result: EntityReviewEnqueueSummary): EntityResolutionBacklogReviewItem {
  return {
    query: result.query,
    candidates: result.candidates,
    inserted: result.inserted,
    skipped: result.skipped,
    errors: result.errors
  };
}

function summarizeEntityResolutionBacklogReview(input: {
  source: EntityLookupSource;
  limit_per_query: number;
  requested_queries: number;
  items: EntityResolutionBacklogReviewItem[];
}): EntityResolutionBacklogReviewSummary {
  return {
    source: input.source,
    limit_per_query: input.limit_per_query,
    requested_queries: input.requested_queries,
    processed_queries: input.items.length,
    candidates: input.items.reduce((sum, item) => sum + item.candidates, 0),
    inserted: input.items.reduce((sum, item) => sum + item.inserted, 0),
    skipped: input.items.reduce((sum, item) => sum + item.skipped, 0),
    errors: input.items.reduce((sum, item) => sum + item.errors.length, 0),
    items: input.items
  };
}
