import type pg from "pg";
import { createId, type LeadType } from "@supplystrata/core";
import type { DbClient, DbTxClient } from "./client.js";

export type LeadStatus = "open" | "in_review" | "promoted" | "rejected" | "closed";

export interface LeadObservationRow extends pg.QueryResultRow {
  lead_id: string;
  lead_type: LeadType;
  source_adapter_id: string;
  doc_id: string | null;
  scope_kind: string;
  scope_id: string;
  title: string;
  summary: string;
  cite_text: string | null;
  source_url: string | null;
  status: LeadStatus;
  review_id: string | null;
  attrs: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface NewLeadObservationInput {
  lead_id?: string;
  lead_type: LeadType;
  source_adapter_id: string;
  doc_id?: string;
  scope_kind: string;
  scope_id: string;
  title: string;
  summary: string;
  cite_text?: string;
  source_url?: string;
  status?: LeadStatus;
  review_id?: string;
  attrs?: Record<string, unknown>;
}

interface UpsertLeadRow extends pg.QueryResultRow {
  lead_id: string;
  inserted: boolean;
}

interface LeadStatusUpdateRow extends pg.QueryResultRow {
  lead_id: string;
  status: LeadStatus;
}

export interface UpsertLeadObservationResult {
  lead_id: string;
  inserted: boolean;
}

export async function insertLeadObservation(client: DbTxClient, input: NewLeadObservationInput): Promise<{ lead_id: string }> {
  const leadId = input.lead_id ?? createId("LEAD");
  await client.query(
    `INSERT INTO lead_observations (
       lead_id, lead_type, source_adapter_id, doc_id, scope_kind, scope_id, title, summary,
       cite_text, source_url, status, review_id, attrs
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    leadParams(leadId, input)
  );
  return { lead_id: leadId };
}

export async function upsertLeadObservation(client: DbTxClient, input: NewLeadObservationInput): Promise<UpsertLeadObservationResult> {
  const leadId = input.lead_id ?? createId("LEAD");
  const result = await client.query<UpsertLeadRow>(
    `INSERT INTO lead_observations (
       lead_id, lead_type, source_adapter_id, doc_id, scope_kind, scope_id, title, summary,
       cite_text, source_url, status, review_id, attrs
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (lead_id) DO UPDATE SET
       lead_type = CASE WHEN lead_observations.status IN ('promoted','rejected','closed') THEN lead_observations.lead_type ELSE EXCLUDED.lead_type END,
       source_adapter_id = CASE
         WHEN lead_observations.status IN ('promoted','rejected','closed') THEN lead_observations.source_adapter_id
         ELSE EXCLUDED.source_adapter_id
       END,
       doc_id = CASE WHEN lead_observations.status IN ('promoted','rejected','closed') THEN lead_observations.doc_id ELSE EXCLUDED.doc_id END,
       scope_kind = CASE WHEN lead_observations.status IN ('promoted','rejected','closed') THEN lead_observations.scope_kind ELSE EXCLUDED.scope_kind END,
       scope_id = CASE WHEN lead_observations.status IN ('promoted','rejected','closed') THEN lead_observations.scope_id ELSE EXCLUDED.scope_id END,
       title = CASE WHEN lead_observations.status IN ('promoted','rejected','closed') THEN lead_observations.title ELSE EXCLUDED.title END,
       summary = CASE WHEN lead_observations.status IN ('promoted','rejected','closed') THEN lead_observations.summary ELSE EXCLUDED.summary END,
       cite_text = CASE WHEN lead_observations.status IN ('promoted','rejected','closed') THEN lead_observations.cite_text ELSE EXCLUDED.cite_text END,
       source_url = CASE WHEN lead_observations.status IN ('promoted','rejected','closed') THEN lead_observations.source_url ELSE EXCLUDED.source_url END,
       status = CASE
         WHEN lead_observations.status IN ('promoted','rejected','closed') THEN lead_observations.status
         WHEN lead_observations.status = 'in_review' AND EXCLUDED.status = 'open' THEN lead_observations.status
         ELSE EXCLUDED.status
       END,
       review_id = CASE WHEN lead_observations.status IN ('promoted','rejected','closed') THEN lead_observations.review_id ELSE EXCLUDED.review_id END,
       attrs = CASE WHEN lead_observations.status IN ('promoted','rejected','closed') THEN lead_observations.attrs ELSE EXCLUDED.attrs END,
       updated_at = now()
     RETURNING lead_id, (xmax = 0) AS inserted`,
    leadParams(leadId, input)
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Lead observation upsert did not return a row: ${leadId}`);
  return { lead_id: row.lead_id, inserted: row.inserted };
}

export async function listLeadObservationsByScope(
  client: DbClient,
  input: { scope_kind: string; scope_id: string; status?: LeadStatus; limit?: number }
): Promise<LeadObservationRow[]> {
  const limit = input.limit ?? 50;
  const params: unknown[] = [input.scope_kind, input.scope_id];
  const predicates = ["scope_kind = $1", "scope_id = $2"];
  if (input.status !== undefined) {
    params.push(input.status);
    predicates.push(`status = $${params.length}`);
  }
  params.push(limit);
  const result = await client.query<LeadObservationRow>(
    `SELECT lead_id, lead_type, source_adapter_id, doc_id, scope_kind, scope_id, title, summary,
            cite_text, source_url, status, review_id, attrs, created_at, updated_at
     FROM lead_observations
     WHERE ${predicates.join(" AND ")}
     ORDER BY
       CASE WHEN status = 'open' THEN 0 WHEN status = 'in_review' THEN 1 ELSE 2 END,
       created_at DESC,
       lead_id
     LIMIT $${params.length}`,
    params
  );
  return result.rows;
}

export async function getLeadObservation(client: DbClient, leadId: string): Promise<LeadObservationRow | undefined> {
  const result = await client.query<LeadObservationRow>(
    `SELECT lead_id, lead_type, source_adapter_id, doc_id, scope_kind, scope_id, title, summary,
            cite_text, source_url, status, review_id, attrs, created_at, updated_at
     FROM lead_observations
     WHERE lead_id = $1`,
    [leadId]
  );
  return result.rows[0];
}

export async function markLeadObservationInReview(
  client: DbTxClient,
  input: { leadId: string; attrsPatch?: Record<string, unknown> }
): Promise<{ lead_id: string; status: LeadStatus } | undefined> {
  const result = await client.query<LeadStatusUpdateRow>(
    `UPDATE lead_observations
     SET status = CASE WHEN status = 'open' THEN 'in_review' ELSE status END,
         attrs = attrs || $2::jsonb,
         updated_at = now()
     WHERE lead_id = $1
       AND status IN ('open','in_review')
     RETURNING lead_id, status`,
    [input.leadId, JSON.stringify(input.attrsPatch ?? {})]
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return { lead_id: row.lead_id, status: row.status };
}

export async function markLeadObservationPromoted(
  client: DbTxClient,
  input: { leadId: string; reviewId: string; attrsPatch?: Record<string, unknown> }
): Promise<{ lead_id: string; status: LeadStatus } | undefined> {
  const result = await client.query<LeadStatusUpdateRow>(
    `UPDATE lead_observations
     SET status = 'promoted',
         review_id = $2,
         attrs = attrs || $3::jsonb,
         updated_at = now()
     WHERE lead_id = $1
       AND status IN ('open','in_review')
     RETURNING lead_id, status`,
    [input.leadId, input.reviewId, JSON.stringify(input.attrsPatch ?? {})]
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return { lead_id: row.lead_id, status: row.status };
}

function leadParams(leadId: string, input: NewLeadObservationInput): readonly unknown[] {
  return [
    leadId,
    input.lead_type,
    input.source_adapter_id,
    input.doc_id ?? null,
    input.scope_kind,
    input.scope_id,
    input.title,
    input.summary,
    input.cite_text ?? null,
    input.source_url ?? null,
    input.status ?? "open",
    input.review_id ?? null,
    input.attrs ?? {}
  ];
}
