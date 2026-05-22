import { createHash } from "node:crypto";
import { upsertUnknownItem, type DbClient, type DbTxClient } from "@supplystrata/db";
import type { ExistingEdgeRow, OfficialSignalDispositionChangeRow } from "./db-rows.js";

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

export interface MaterializeOfficialSignalDispositionUnknownsInput {
  review_ids?: readonly string[];
  edge_ids?: readonly string[];
  limit?: number;
  generated_by?: string;
  require_existing_edges?: boolean;
}

export interface MaterializeOfficialSignalDispositionUnknownsSummary {
  scanned_dispositions: number;
  eligible_dispositions: number;
  unique_unknowns: number;
  edges_checked: number;
  unknowns_inserted: number;
  unknowns_updated: number;
  skipped_non_unknown_decision: number;
  skipped_missing_edges: number;
  skipped_unknown_ids: string[];
  generated_by: string;
}

type OfficialSignalDispositionDecision =
  | "supports_existing_edge"
  | "needs_more_evidence"
  | "not_relevant"
  | "record_single_source_unknown"
  | "create_counterparty_source_target";

interface OfficialSignalDispositionPayload {
  review_id: string;
  edge_id: string;
  decision: OfficialSignalDispositionDecision;
  reason: string;
  source_adapter_id: string;
  doc_id: string | null;
  signal_title: string;
  evidence_id: string | null;
  unknown_id: string | null;
  check_target_id: string | null;
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
  client: DbTxClient,
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

export async function materializeOfficialSignalDispositionUnknowns(
  client: DbTxClient,
  input: MaterializeOfficialSignalDispositionUnknownsInput = {}
): Promise<MaterializeOfficialSignalDispositionUnknownsSummary> {
  // review-store 只记录人工结论；unknown 的持久化必须留在 evidence-maintenance，
  // 这样可以统一复用 edge current 检查和 unknown semantic change 审计。
  const generatedBy = input.generated_by ?? "evidence-maintenance.official-signal-disposition.v1";
  const changes = await listOfficialSignalDispositionChanges(client, input);
  const proposedUnknowns: ProposedSingleSourceDispositionUnknown[] = [];
  let skippedNonUnknownDecision = 0;

  for (const change of changes) {
    const disposition = parseOfficialSignalDispositionPayload(change);
    if (disposition.decision !== "record_single_source_unknown") {
      skippedNonUnknownDecision += 1;
      continue;
    }
    proposedUnknowns.push(officialSignalDispositionUnknown(disposition, generatedBy));
  }

  const materializationInput: MaterializeSingleSourceDispositionUnknownsInput = {
    proposed_unknowns: proposedUnknowns,
    generated_by: generatedBy
  };
  if (input.require_existing_edges !== undefined) materializationInput.require_existing_edges = input.require_existing_edges;
  const materialized = await materializeSingleSourceDispositionUnknowns(client, materializationInput);

  return {
    scanned_dispositions: changes.length,
    eligible_dispositions: proposedUnknowns.length,
    unique_unknowns: materialized.unique_unknowns,
    edges_checked: materialized.edges_checked,
    unknowns_inserted: materialized.unknowns_inserted,
    unknowns_updated: materialized.unknowns_updated,
    skipped_non_unknown_decision: skippedNonUnknownDecision,
    skipped_missing_edges: materialized.skipped_missing_edges,
    skipped_unknown_ids: materialized.skipped_unknown_ids,
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

async function listOfficialSignalDispositionChanges(
  client: DbClient,
  input: MaterializeOfficialSignalDispositionUnknownsInput
): Promise<OfficialSignalDispositionChangeRow[]> {
  const reviewIds = uniqueSorted(input.review_ids ?? []);
  const edgeIds = uniqueSorted(input.edge_ids ?? []);
  const limit = positiveLimit(input.limit ?? 1000);
  const params: unknown[] = [];
  const filters = ["change_type = 'OFFICIAL_DISCLOSURE_SIGNAL_DISPOSITION_RECORDED'", "scope_kind = 'review'"];

  if (reviewIds.length > 0) {
    params.push(reviewIds);
    filters.push(`scope_id = ANY($${params.length}::text[])`);
  }

  if (edgeIds.length > 0) {
    params.push(edgeIds);
    filters.push(`after->>'edge_id' = ANY($${params.length}::text[])`);
  }

  params.push(limit);
  const result = await client.query<OfficialSignalDispositionChangeRow>(
    `SELECT change_id, scope_id AS review_id, after, detected_at
     FROM change_records
     WHERE ${filters.join("\n       AND ")}
     ORDER BY detected_at DESC, change_id DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows;
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

function parseOfficialSignalDispositionPayload(change: OfficialSignalDispositionChangeRow): OfficialSignalDispositionPayload {
  const after = change.after;
  if (after === null) throw new Error(`Official signal disposition change is missing payload: ${change.change_id}`);
  const policy = recordField(after, "fact_write_policy", change.change_id);
  if (policy["automatic_fact_mutation_allowed"] !== false || policy["allowed_edge_mutation"] !== "none" || policy["requires_human_review"] !== true)
    throw new Error(`Official signal disposition cannot authorize fact mutation: ${change.change_id}`);
  return {
    review_id: stringField(after, "review_id"),
    edge_id: stringField(after, "edge_id"),
    decision: officialSignalDispositionDecision(stringField(after, "decision"), change.change_id),
    reason: stringField(after, "reason"),
    source_adapter_id: stringField(after, "source_adapter_id"),
    doc_id: nullableStringField(after, "doc_id"),
    signal_title: stringField(after, "signal_title"),
    evidence_id: nullableStringField(after, "evidence_id"),
    unknown_id: nullableStringField(after, "unknown_id"),
    check_target_id: nullableStringField(after, "check_target_id")
  };
}

function officialSignalDispositionUnknown(disposition: OfficialSignalDispositionPayload, generatedBy: string): ProposedSingleSourceDispositionUnknown {
  const providedUnknownProxy = disposition.unknown_id === null ? [] : [`provided_unknown:${disposition.unknown_id}`];
  const docProxy = disposition.doc_id === null ? [] : [`doc:${disposition.doc_id}`];
  const evidenceProxy = disposition.evidence_id === null ? [] : [`evidence:${disposition.evidence_id}`];
  const checkTargetProxy = disposition.check_target_id === null ? [] : [`check_target:${disposition.check_target_id}`];
  return {
    unknown_id: deterministicOfficialSignalDispositionUnknownId(disposition),
    scope_kind: "edge",
    scope_id: disposition.edge_id,
    question: `Does edge ${disposition.edge_id} have independent official corroboration after review ${disposition.review_id}?`,
    why_unknown: `Official disclosure signal review ${disposition.review_id} recorded a single-source unknown for "${disposition.signal_title}": ${disposition.reason}`,
    blocking_data_sources: uniqueSorted([disposition.source_adapter_id, "independent official counterparty disclosure"]),
    proxies: uniqueSorted([`review:${disposition.review_id}`, ...docProxy, ...evidenceProxy, ...checkTargetProxy, ...providedUnknownProxy]),
    created_by: generatedBy
  };
}

function deterministicOfficialSignalDispositionUnknownId(disposition: OfficialSignalDispositionPayload): string {
  const digest = createHash("sha256").update(`${disposition.review_id}\0${disposition.edge_id}`).digest("hex").slice(0, 16).toUpperCase();
  return `UNK-OFFICIAL-SIGNAL-DISPOSITION-${digest}`;
}

function officialSignalDispositionDecision(value: string, changeId: string): OfficialSignalDispositionDecision {
  if (
    value === "supports_existing_edge" ||
    value === "needs_more_evidence" ||
    value === "not_relevant" ||
    value === "record_single_source_unknown" ||
    value === "create_counterparty_source_target"
  )
    return value;
  throw new Error(`Unsupported official signal disposition decision for ${changeId}: ${value}`);
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

function recordField(record: Record<string, unknown>, key: string, context: string): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) throw new Error(`Expected object field ${key} in ${context}`);
  return value;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`Expected non-empty string field: ${key}`);
  return value;
}

function nullableStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`Expected nullable string field: ${key}`);
  return value;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(`Expected string array field: ${key}`);
  return value.map((item) => item.trim()).filter((item) => item.length > 0);
}

function positiveLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`limit must be a positive integer: ${value}`);
  return value;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
