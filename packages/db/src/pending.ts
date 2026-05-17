import type pg from "pg";
import { createId } from "@supplystrata/core";
import type { DbClient } from "./client.js";

export async function recordPendingEntity(
  client: DbClient,
  input: { surface: string; context: Record<string, unknown> }
): Promise<{ pending_id: string; is_new: boolean }> {
  const existing = await client.query<{ pending_id: string } & pg.QueryResultRow>(
    `SELECT pending_id
     FROM pending_entities
     WHERE lower(surface) = lower($1) AND status = 'pending'
     ORDER BY first_seen_at
     LIMIT 1`,
    [input.surface]
  );
  const current = existing.rows[0];
  if (current !== undefined) {
    await client.query("UPDATE pending_entities SET occurrence_count = occurrence_count + 1, context = $2 WHERE pending_id = $1", [
      current.pending_id,
      input.context
    ]);
    return { pending_id: current.pending_id, is_new: false };
  }

  const pendingId = createId("PND");
  await client.query(
    `INSERT INTO pending_entities (pending_id, surface, context, status)
     VALUES ($1,$2,$3,'pending')`,
    [pendingId, input.surface, input.context]
  );
  return { pending_id: pendingId, is_new: true };
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
