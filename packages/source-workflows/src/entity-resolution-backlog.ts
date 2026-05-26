import type { DatabaseStore } from "@supplystrata/db/write";
import type { CreateAdapterContextInput } from "@supplystrata/source-adapter-runtime";
import { enqueueEntitySourceReviewCandidates, type EntityLookupSource, type EntityReviewEnqueueSummary } from "./entity-sources.js";

export interface EntityResolutionBacklogReviewInput {
  queries: readonly string[];
  source: EntityLookupSource;
  limitPerQuery: number;
}

export interface EntityResolutionBacklogReviewItem {
  surface: string;
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
  const surfaces = normalizeEntityResolutionQueries(input.queries);
  if (!Number.isInteger(input.limitPerQuery) || input.limitPerQuery <= 0) {
    throw new Error(`Entity resolution backlog candidate limit must be a positive integer: ${input.limitPerQuery}`);
  }

  const items: EntityResolutionBacklogReviewItem[] = [];
  for (const surface of surfaces) {
    for (const query of buildEntityResolutionLookupQueries(surface)) {
      const result = await enqueueEntitySourceReviewCandidates(
        store,
        {
          query,
          reviewSurface: surface,
          source: input.source,
          limit: input.limitPerQuery
        },
        runtime
      );
      items.push(entityReviewEnqueueResultToBacklogItem(surface, result));
    }
  }

  return summarizeEntityResolutionBacklogReview({
    source: input.source,
    limit_per_query: input.limitPerQuery,
    requested_queries: input.queries.length,
    items
  });
}

export function buildEntityResolutionLookupQueries(surface: string): string[] {
  return normalizeEntityResolutionQueries([surface, ...legalSuffixLookupVariants(surface)]);
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

function legalSuffixLookupVariants(surface: string): string[] {
  const cleaned = surface.normalize("NFKC").trim().replace(/\s+/g, " ");
  for (const rule of LEGAL_SUFFIX_LOOKUP_RULES) {
    if (!rule.pattern.test(cleaned)) continue;
    // 更具体的法律后缀规则优先，避免一个 surface 产生多条近似相同的查询噪声。
    return [cleaned.replace(rule.pattern, rule.replacement)];
  }
  return [];
}

const LEGAL_SUFFIX_LOOKUP_RULES: readonly { pattern: RegExp; replacement: string }[] = [
  { pattern: /\bIncorporated$/iu, replacement: "Inc." },
  { pattern: /\bCorporation$/iu, replacement: "Corp." },
  { pattern: /\bCompany Limited$/iu, replacement: "Co., Ltd." },
  { pattern: /\bLimited$/iu, replacement: "Ltd." }
];

function entityReviewEnqueueResultToBacklogItem(surface: string, result: EntityReviewEnqueueSummary): EntityResolutionBacklogReviewItem {
  return {
    surface,
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
