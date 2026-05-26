import type pg from "pg";
import { recordSemanticChange, type DbClient, type DbTxClient } from "@supplystrata/db/write";
import { reviewOnlyFactWritePolicy, type ReviewOnlyFactWritePolicy } from "@supplystrata/review-candidates";

export type EdgeCorroborationDispositionDecision =
  | "supports_existing_edge"
  | "needs_more_evidence"
  | "not_relevant"
  | "record_single_source_unknown"
  | "create_counterparty_source_target";

export interface EdgeCorroborationDispositionInput {
  edgeId: string;
  decision: EdgeCorroborationDispositionDecision;
  reviewer: string;
  reason: string;
  evidenceId?: string;
  unknownId?: string;
  checkTargetId?: string;
  recordedAt: string;
}

export interface EdgeCorroborationDispositionRecord {
  change_id: string;
  edge_id: string;
  decision: EdgeCorroborationDispositionDecision;
  reviewer: string;
  reason: string;
  evidence_id: string | null;
  unknown_id: string | null;
  check_target_id: string | null;
  recorded_at: string;
  fact_write_policy: ReviewOnlyFactWritePolicy;
}

interface EdgeCorroborationDispositionRow extends pg.QueryResultRow {
  change_id: string;
  edge_id: string;
  after: Record<string, unknown> | null;
  caused_by: string;
  detected_at: Date;
}

export async function recordEdgeCorroborationDisposition(
  client: DbTxClient,
  input: EdgeCorroborationDispositionInput
): Promise<EdgeCorroborationDispositionRecord> {
  if (input.edgeId.trim().length === 0) throw new Error("Edge corroboration disposition requires an edge id");
  if (input.reason.trim().length === 0) throw new Error("Edge corroboration disposition requires a reason");
  const after = {
    edge_id: input.edgeId,
    decision: input.decision,
    reviewer: input.reviewer,
    reason: input.reason,
    evidence_id: input.evidenceId ?? null,
    unknown_id: input.unknownId ?? null,
    check_target_id: input.checkTargetId ?? null,
    fact_write_policy: reviewOnlyFactWritePolicy(),
    recorded_at: input.recordedAt
  };
  const change = await recordSemanticChange(client, {
    scope_kind: "edge",
    scope_id: input.edgeId,
    change_type: "EDGE_CORROBORATION_DISPOSITION_RECORDED",
    after,
    caused_by: input.reviewer
  });
  return edgeCorroborationDispositionRecordFromAfter({
    change_id: change.change_id,
    edge_id: input.edgeId,
    after,
    caused_by: input.reviewer,
    detected_at: new Date(input.recordedAt)
  });
}

export async function listEdgeCorroborationDispositions(
  client: DbClient,
  input: { edgeIds?: readonly string[]; limit?: number } = {}
): Promise<EdgeCorroborationDispositionRecord[]> {
  const params: unknown[] = [];
  const predicates = ["change_type = 'EDGE_CORROBORATION_DISPOSITION_RECORDED'", "scope_kind = 'edge'"];
  if (input.edgeIds !== undefined && input.edgeIds.length > 0) {
    params.push([...new Set(input.edgeIds)]);
    predicates.push(`scope_id = ANY($${params.length}::text[])`);
  }
  params.push(input.limit ?? 200);
  const result = await client.query<EdgeCorroborationDispositionRow>(
    `SELECT change_id, scope_id AS edge_id, after, caused_by, detected_at
     FROM change_records
     WHERE ${predicates.join(" AND ")}
     ORDER BY detected_at DESC, change_id DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows.map(edgeCorroborationDispositionRecordFromAfter);
}

function edgeCorroborationDispositionRecordFromAfter(row: EdgeCorroborationDispositionRow): EdgeCorroborationDispositionRecord {
  const after = recordField(row.after ?? {}, "after", row.change_id);
  return {
    change_id: row.change_id,
    edge_id: stringField(after, "edge_id"),
    decision: edgeCorroborationDispositionDecision(stringField(after, "decision"), row.change_id),
    reviewer: stringField(after, "reviewer"),
    reason: stringField(after, "reason"),
    evidence_id: nullableStringField(after, "evidence_id"),
    unknown_id: nullableStringField(after, "unknown_id"),
    check_target_id: nullableStringField(after, "check_target_id"),
    recorded_at: stringField(after, "recorded_at"),
    fact_write_policy: reviewOnlyFactWritePolicy()
  };
}

function edgeCorroborationDispositionDecision(value: string, changeId: string): EdgeCorroborationDispositionDecision {
  if (
    value === "supports_existing_edge" ||
    value === "needs_more_evidence" ||
    value === "not_relevant" ||
    value === "record_single_source_unknown" ||
    value === "create_counterparty_source_target"
  )
    return value;
  throw new Error(`Unsupported edge corroboration disposition decision for ${changeId}: ${value}`);
}

function recordField(value: Record<string, unknown>, key: string, context: string): Record<string, unknown> {
  if (isRecord(value)) return value;
  throw new Error(`Expected object field ${key} in ${context}`);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
