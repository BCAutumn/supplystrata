import type pg from "pg";
import { createId } from "@supplystrata/core";
import { recordSemanticChange } from "./changes.js";
import type { DbClient } from "./client.js";

export type UnknownItemStatus = "open" | "resolved";

export interface UnknownItemDetailRow extends pg.QueryResultRow {
  unknown_id: string;
  scope_kind: string;
  scope_id: string;
  question: string;
  why_unknown: string;
  blocking_data_sources: string[];
  proxies: string[];
  status: UnknownItemStatus;
  created_by: string;
  created_at: Date;
  resolved_at: Date | null;
  resolved_evidence_ids: string[] | null;
}

export interface NewUnknownItemInput {
  unknown_id?: string;
  scope_kind: string;
  scope_id: string;
  question: string;
  why_unknown: string;
  blocking_data_sources?: readonly string[];
  proxies?: readonly string[];
  created_by: string;
}

interface UnknownIdRow extends pg.QueryResultRow {
  unknown_id: string;
}

export async function upsertUnknownItem(client: DbClient, input: NewUnknownItemInput): Promise<{ unknown_id: string; inserted: boolean }> {
  const unknownId = input.unknown_id ?? createId("UNK");
  const existing = await client.query<UnknownIdRow>("SELECT unknown_id FROM unknown_items WHERE unknown_id = $1", [unknownId]);
  await client.query(
    `INSERT INTO unknown_items (
       unknown_id, scope_kind, scope_id, question, why_unknown, blocking_data_sources, proxies, status, created_by
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8)
     ON CONFLICT (unknown_id) DO UPDATE SET
       scope_kind = EXCLUDED.scope_kind,
       scope_id = EXCLUDED.scope_id,
       question = EXCLUDED.question,
       why_unknown = EXCLUDED.why_unknown,
       blocking_data_sources = EXCLUDED.blocking_data_sources,
       proxies = EXCLUDED.proxies,
       status = CASE WHEN unknown_items.status = 'resolved' THEN unknown_items.status ELSE 'open' END`,
    [
      unknownId,
      input.scope_kind,
      input.scope_id,
      input.question,
      input.why_unknown,
      [...(input.blocking_data_sources ?? [])],
      [...(input.proxies ?? [])],
      input.created_by
    ]
  );
  const inserted = existing.rows[0] === undefined;
  await recordSemanticChange(client, {
    scope_kind: "unknown",
    scope_id: unknownId,
    change_type: inserted ? "UNKNOWN_ADDED" : "UNKNOWN_UPDATED",
    after: {
      scope_kind: input.scope_kind,
      scope_id: input.scope_id,
      question: input.question
    },
    caused_by: input.created_by
  });
  return { unknown_id: unknownId, inserted };
}

export async function resolveUnknownItem(
  client: DbClient,
  input: { unknown_id: string; resolved_evidence_ids: readonly string[]; reviewer: string }
): Promise<{ unknown_id: string }> {
  if (input.resolved_evidence_ids.length === 0) throw new Error("resolved_evidence_ids must contain at least one evidence id");
  const result = await client.query<UnknownIdRow>(
    `UPDATE unknown_items
     SET status = 'resolved',
         resolved_at = now(),
         resolved_evidence_ids = $2
     WHERE unknown_id = $1 AND status <> 'resolved'
     RETURNING unknown_id`,
    [input.unknown_id, [...input.resolved_evidence_ids]]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Unknown item not found or already resolved: ${input.unknown_id}`);
  await recordSemanticChange(client, {
    scope_kind: "unknown",
    scope_id: row.unknown_id,
    change_type: "UNKNOWN_RESOLVED",
    after: {
      resolved_evidence_ids: [...input.resolved_evidence_ids]
    },
    evidence_ids: input.resolved_evidence_ids,
    caused_by: input.reviewer
  });
  return { unknown_id: row.unknown_id };
}
