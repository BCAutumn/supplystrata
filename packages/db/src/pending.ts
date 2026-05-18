import type pg from "pg";
import { createId } from "@supplystrata/core";
import type { DbClient } from "./client.js";

interface PendingEntityUpsertRow extends pg.QueryResultRow {
  pending_id: string;
  inserted: boolean;
}

export async function recordPendingEntity(
  client: DbClient,
  input: { surface: string; context: Record<string, unknown> }
): Promise<{ pending_id: string; is_new: boolean }> {
  const pendingId = createId("PND");
  const result = await client.query<PendingEntityUpsertRow>(
    `INSERT INTO pending_entities (pending_id, surface, context, status)
     VALUES ($1,$2,$3,'pending')
     ON CONFLICT ((lower(surface))) WHERE status = 'pending'
     DO UPDATE SET
       occurrence_count = pending_entities.occurrence_count + 1,
       context = pending_entities.context || EXCLUDED.context
     RETURNING pending_id, (xmax = 0) AS inserted`,
    [pendingId, input.surface, input.context]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Failed to upsert pending entity: ${input.surface}`);
  return { pending_id: row.pending_id, is_new: row.inserted };
}

export type PendingEntityStatusFilter = "pending" | "resolved" | "all";

export interface PendingEntityRow extends pg.QueryResultRow {
  pending_id: string;
  surface: string;
  context: Record<string, unknown>;
  first_seen_at: Date;
  occurrence_count: number;
  status: "pending" | "resolved" | "rejected";
  resolved_entity_id: string | null;
  reviewer: string | null;
  reviewed_at: Date | null;
}

export async function listPendingEntities(client: DbClient, input: { status: PendingEntityStatusFilter; limit: number }): Promise<PendingEntityRow[]> {
  const result = await client.query<PendingEntityRow>(
    `SELECT pending_id, surface, context, first_seen_at, occurrence_count, status, resolved_entity_id, reviewer, reviewed_at
     FROM pending_entities
     WHERE ($1 = 'all' OR status = $1)
     ORDER BY
       CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
       occurrence_count DESC,
       first_seen_at ASC
     LIMIT $2`,
    [input.status, input.limit]
  );
  return result.rows;
}

export async function getPendingEntity(client: DbClient, pendingId: string): Promise<PendingEntityRow | undefined> {
  const result = await client.query<PendingEntityRow>(
    `SELECT pending_id, surface, context, first_seen_at, occurrence_count, status, resolved_entity_id, reviewer, reviewed_at
     FROM pending_entities
     WHERE pending_id = $1`,
    [pendingId]
  );
  return result.rows[0];
}
