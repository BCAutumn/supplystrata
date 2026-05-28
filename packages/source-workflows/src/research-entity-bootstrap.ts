import type { Env } from "@supplystrata/config";
import { tryResolveEntityId } from "@supplystrata/db/read";
import type { DatabaseStore } from "@supplystrata/db/write";
import { ensureSecListedCompanyEntity } from "@supplystrata/entity-import";
import { lookupSecCompanyDirectory, normalizeCompanyDirectoryQuery, type SecCompanyDirectoryRecord } from "@supplystrata/sources-sec-edgar";
import { sourceWorkflowAdapterContextInput } from "./adapter-context.js";

export type ResearchCompanyEntityBootstrapStatus = "already_resolved" | "bootstrapped" | "unresolved" | "ambiguous" | "source_unreachable";

export interface ResearchCompanyEntityBootstrapInput {
  query: string;
  env: Env;
  now: string;
  reviewer?: string;
}

export interface ResearchCompanyEntityBootstrapResult {
  status: ResearchCompanyEntityBootstrapStatus;
  query: string;
  normalized_query: string;
  entity_id?: string;
  source_adapter_id?: "sec-edgar";
  source_url?: string;
  candidate_count?: number;
  reason?: string;
}

export async function ensureResearchCompanyEntity(
  store: DatabaseStore,
  input: ResearchCompanyEntityBootstrapInput
): Promise<ResearchCompanyEntityBootstrapResult> {
  const query = input.query.trim();
  const normalizedQuery = normalizeCompanyDirectoryQuery(query);
  const existing = await tryResolveEntityId(store.read, query);
  if (existing !== undefined) return { status: "already_resolved", query, normalized_query: normalizedQuery, entity_id: existing };

  let candidates: SecCompanyDirectoryRecord[];
  let sourceUrl: string;
  try {
    const lookup = await lookupSecCompanyDirectory(
      { query: normalizedQuery, limit: 5 },
      { userAgent: sourceWorkflowAdapterContextInput(input.env, { now: input.now }).userAgent }
    );
    candidates = lookup.candidates;
    sourceUrl = lookup.source_url;
  } catch (error) {
    return {
      status: "source_unreachable",
      query,
      normalized_query: normalizedQuery,
      source_adapter_id: "sec-edgar",
      reason: errorMessage(error)
    };
  }

  if (candidates.length === 0) {
    return {
      status: "unresolved",
      query,
      normalized_query: normalizedQuery,
      source_adapter_id: "sec-edgar",
      source_url: sourceUrl,
      candidate_count: 0,
      reason: "SEC listed company directory did not return an exact enough company candidate."
    };
  }
  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      query,
      normalized_query: normalizedQuery,
      source_adapter_id: "sec-edgar",
      source_url: sourceUrl,
      candidate_count: candidates.length,
      reason: "SEC listed company directory returned multiple candidates; automatic bootstrap requires a unique ticker or company match."
    };
  }

  const candidate = candidates[0];
  if (candidate === undefined) {
    return {
      status: "unresolved",
      query,
      normalized_query: normalizedQuery,
      source_adapter_id: "sec-edgar",
      source_url: sourceUrl,
      candidate_count: 0,
      reason: "SEC listed company directory returned no usable candidate."
    };
  }

  const imported = await store.transaction((client) => ensureSecListedCompanyEntity(client, candidate, input.reviewer ?? "research-entity-bootstrap"));
  if (imported.status === "blocked") {
    return {
      status: "unresolved",
      query,
      normalized_query: normalizedQuery,
      source_adapter_id: "sec-edgar",
      source_url: sourceUrl,
      candidate_count: 1,
      reason: imported.reason
    };
  }
  return {
    status: "bootstrapped",
    query,
    normalized_query: normalizedQuery,
    entity_id: imported.entity_id,
    source_adapter_id: "sec-edgar",
    source_url: sourceUrl,
    candidate_count: 1
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
