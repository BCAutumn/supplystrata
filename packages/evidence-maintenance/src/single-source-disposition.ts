import type pg from "pg";
import { upsertUnknownItem, type DbClient } from "@supplystrata/db";

export interface ProposedSingleSourceDispositionUnknown {
  unknown_id: string;
  scope_kind: "edge";
  scope_id: string;
  question: string;
  why_unknown: string;
  blocking_data_sources: string[];
  proxies: string[];
  created_by: string;
}

export interface MaterializeSingleSourceDispositionUnknownsInput {
  proposed_unknowns: readonly ProposedSingleSourceDispositionUnknown[];
  generated_by?: string;
  require_existing_edges?: boolean;
}

export interface MaterializeSingleSourceDispositionUnknownsSummary {
  proposed_unknowns: number;
  unique_unknowns: number;
  edges_checked: number;
  unknowns_inserted: number;
  unknowns_updated: number;
  skipped_missing_edges: number;
  skipped_unknown_ids: string[];
  generated_by: string;
}

interface ExistingEdgeRow extends pg.QueryResultRow {
  edge_id: string;
}

export function parseOfficialDisclosureReadinessProposedUnknowns(text: string): ProposedSingleSourceDispositionUnknown[] {
  const parsed: unknown = JSON.parse(text);
  return extractOfficialDisclosureReadinessProposedUnknowns(parsed);
}

export function extractOfficialDisclosureReadinessProposedUnknowns(value: unknown): ProposedSingleSourceDispositionUnknown[] {
  if (!isRecord(value)) throw new Error("official-disclosure-readiness payload must be an object");
  const queue = value["corroboration_queue"];
  if (!Array.isArray(queue)) throw new Error("official-disclosure-readiness payload must include corroboration_queue[]");
  const proposed: ProposedSingleSourceDispositionUnknown[] = [];
  for (const item of queue) {
    if (!isRecord(item)) throw new Error("corroboration_queue item must be an object");
    const proposedUnknown = item["proposed_unknown"];
    if (proposedUnknown === null || proposedUnknown === undefined) continue;
    proposed.push(parseProposedUnknown(proposedUnknown));
  }
  return dedupeProposedUnknowns(proposed);
}

export async function materializeSingleSourceDispositionUnknowns(
  client: DbClient,
  input: MaterializeSingleSourceDispositionUnknownsInput
): Promise<MaterializeSingleSourceDispositionUnknownsSummary> {
  const generatedBy = input.generated_by ?? "evidence-maintenance.single-source-disposition.v1";
  const uniqueUnknowns = dedupeProposedUnknowns(input.proposed_unknowns);
  const edgeIds = uniqueSorted(uniqueUnknowns.map((unknown) => unknown.scope_id));
  const existingEdgeIds = input.require_existing_edges === false ? new Set(edgeIds) : await listExistingCurrentEdgeIds(client, edgeIds);
  let inserted = 0;
  let updated = 0;
  const skippedUnknownIds: string[] = [];

  for (const unknown of uniqueUnknowns) {
    if (!existingEdgeIds.has(unknown.scope_id)) {
      skippedUnknownIds.push(unknown.unknown_id);
      continue;
    }
    const result = await upsertUnknownItem(client, {
      unknown_id: unknown.unknown_id,
      scope_kind: unknown.scope_kind,
      scope_id: unknown.scope_id,
      question: unknown.question,
      why_unknown: unknown.why_unknown,
      blocking_data_sources: unknown.blocking_data_sources,
      proxies: unknown.proxies,
      created_by: generatedBy
    });
    if (result.inserted) {
      inserted += 1;
    } else {
      updated += 1;
    }
  }

  return {
    proposed_unknowns: input.proposed_unknowns.length,
    unique_unknowns: uniqueUnknowns.length,
    edges_checked: edgeIds.length,
    unknowns_inserted: inserted,
    unknowns_updated: updated,
    skipped_missing_edges: skippedUnknownIds.length,
    skipped_unknown_ids: skippedUnknownIds.sort(),
    generated_by: generatedBy
  };
}

async function listExistingCurrentEdgeIds(client: DbClient, edgeIds: readonly string[]): Promise<ReadonlySet<string>> {
  if (edgeIds.length === 0) return new Set();
  const result = await client.query<ExistingEdgeRow>(
    `SELECT edge_id
     FROM edges
     WHERE edge_id = ANY($1::text[])
       AND validity = 'current'
     ORDER BY edge_id`,
    [edgeIds]
  );
  return new Set(result.rows.map((row) => row.edge_id));
}

function parseProposedUnknown(value: unknown): ProposedSingleSourceDispositionUnknown {
  if (!isRecord(value)) throw new Error("proposed_unknown must be an object");
  const scopeKind = stringField(value, "scope_kind");
  if (scopeKind !== "edge") throw new Error(`proposed_unknown.scope_kind must be edge, received: ${scopeKind}`);
  const unknown: ProposedSingleSourceDispositionUnknown = {
    unknown_id: stringField(value, "unknown_id"),
    scope_kind: "edge",
    scope_id: stringField(value, "scope_id"),
    question: stringField(value, "question"),
    why_unknown: stringField(value, "why_unknown"),
    blocking_data_sources: stringArrayField(value, "blocking_data_sources"),
    proxies: stringArrayField(value, "proxies"),
    created_by: stringField(value, "created_by")
  };
  if (!unknown.unknown_id.startsWith("UNK-")) throw new Error(`proposed_unknown.unknown_id must start with UNK-: ${unknown.unknown_id}`);
  if (!unknown.scope_id.startsWith("EDGE-")) throw new Error(`proposed_unknown.scope_id must reference an edge id: ${unknown.scope_id}`);
  return unknown;
}

function dedupeProposedUnknowns(values: readonly ProposedSingleSourceDispositionUnknown[]): ProposedSingleSourceDispositionUnknown[] {
  const byId = new Map<string, ProposedSingleSourceDispositionUnknown>();
  for (const value of values) byId.set(value.unknown_id, cloneProposedUnknown(value));
  return [...byId.values()].sort((left, right) => left.unknown_id.localeCompare(right.unknown_id));
}

function cloneProposedUnknown(value: ProposedSingleSourceDispositionUnknown): ProposedSingleSourceDispositionUnknown {
  return {
    ...value,
    blocking_data_sources: [...value.blocking_data_sources],
    proxies: [...value.proxies]
  };
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`Expected non-empty string field: ${key}`);
  return value;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(`Expected string array field: ${key}`);
  return value.map((item) => item.trim()).filter((item) => item.length > 0);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
