import type pg from "pg";
import { createId, type LeadType, type ObservationType } from "@supplystrata/core";
import type { DbClient } from "./client.js";

export interface ObservationRow extends pg.QueryResultRow {
  observation_id: string;
  observation_type: ObservationType;
  source_adapter_id: string;
  source_item_id: string | null;
  doc_id: string | null;
  scope_kind: string;
  scope_id: string;
  geography_kind: string | null;
  geography_id: string | null;
  component_id: string | null;
  metric_name: string;
  metric_value: string | null;
  metric_unit: string | null;
  time_window_start: Date | null;
  time_window_end: Date | null;
  baseline_value: string | null;
  change_value: string | null;
  change_percent: number | null;
  confidence: number;
  provenance: Record<string, unknown>;
  attrs: Record<string, unknown>;
  created_at: Date;
}

export interface NewObservationInput {
  observation_id?: string;
  observation_type: ObservationType;
  source_adapter_id: string;
  source_item_id?: string;
  doc_id?: string;
  scope_kind: string;
  scope_id: string;
  geography_kind?: string;
  geography_id?: string;
  component_id?: string;
  metric_name: string;
  metric_value?: string;
  metric_unit?: string;
  time_window_start?: string;
  time_window_end?: string;
  baseline_value?: string;
  change_value?: string;
  change_percent?: number;
  confidence: number;
  provenance?: Record<string, unknown>;
  attrs?: Record<string, unknown>;
}

interface UpsertObservationRow extends pg.QueryResultRow {
  observation_id: string;
  inserted: boolean;
}

export interface UpsertObservationResult {
  observation_id: string;
  inserted: boolean;
}

export async function insertObservation(client: DbClient, input: NewObservationInput): Promise<{ observation_id: string }> {
  const observationId = input.observation_id ?? createId("OBS");
  await client.query(
    `INSERT INTO observations (
       observation_id, observation_type, source_adapter_id, source_item_id, doc_id,
       scope_kind, scope_id, geography_kind, geography_id, component_id, metric_name,
       metric_value, metric_unit, time_window_start, time_window_end, baseline_value,
       change_value, change_percent, confidence, provenance, attrs
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
    observationParams(observationId, input)
  );
  return { observation_id: observationId };
}

export async function upsertObservation(client: DbClient, input: NewObservationInput): Promise<UpsertObservationResult> {
  const observationId = input.observation_id ?? createId("OBS");
  const result = await client.query<UpsertObservationRow>(
    `INSERT INTO observations (
       observation_id, observation_type, source_adapter_id, source_item_id, doc_id,
       scope_kind, scope_id, geography_kind, geography_id, component_id, metric_name,
       metric_value, metric_unit, time_window_start, time_window_end, baseline_value,
       change_value, change_percent, confidence, provenance, attrs
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT (observation_id) DO UPDATE SET
       observation_type = EXCLUDED.observation_type,
       source_adapter_id = EXCLUDED.source_adapter_id,
       source_item_id = EXCLUDED.source_item_id,
       doc_id = EXCLUDED.doc_id,
       scope_kind = EXCLUDED.scope_kind,
       scope_id = EXCLUDED.scope_id,
       geography_kind = EXCLUDED.geography_kind,
       geography_id = EXCLUDED.geography_id,
       component_id = EXCLUDED.component_id,
       metric_name = EXCLUDED.metric_name,
       metric_value = EXCLUDED.metric_value,
       metric_unit = EXCLUDED.metric_unit,
       time_window_start = EXCLUDED.time_window_start,
       time_window_end = EXCLUDED.time_window_end,
       baseline_value = EXCLUDED.baseline_value,
       change_value = EXCLUDED.change_value,
       change_percent = EXCLUDED.change_percent,
       confidence = EXCLUDED.confidence,
       provenance = observations.provenance || EXCLUDED.provenance,
       attrs = observations.attrs || EXCLUDED.attrs
     RETURNING observation_id, (xmax = 0) AS inserted`,
    observationParams(observationId, input)
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Observation upsert did not return a row: ${observationId}`);
  return { observation_id: row.observation_id, inserted: row.inserted };
}

export async function listObservationsByScope(
  client: DbClient,
  input: { scope_kind: string; scope_id: string; observation_type?: ObservationType; limit?: number }
): Promise<ObservationRow[]> {
  const limit = input.limit ?? 50;
  const params: unknown[] = [input.scope_kind, input.scope_id];
  const predicates = ["scope_kind = $1", "scope_id = $2"];
  if (input.observation_type !== undefined) {
    params.push(input.observation_type);
    predicates.push(`observation_type = $${params.length}`);
  }
  params.push(limit);
  const result = await client.query<ObservationRow>(
    `SELECT observation_id, observation_type, source_adapter_id, source_item_id, doc_id,
            scope_kind, scope_id, geography_kind, geography_id, component_id, metric_name,
            metric_value::text, metric_unit, time_window_start, time_window_end, baseline_value::text,
            change_value::text, change_percent, confidence, provenance, attrs, created_at
     FROM observations
     WHERE ${predicates.join(" AND ")}
     ORDER BY time_window_end DESC NULLS LAST, created_at DESC, observation_id
     LIMIT $${params.length}`,
    params
  );
  return result.rows;
}

export async function getObservation(client: DbClient, observationId: string): Promise<ObservationRow | undefined> {
  const result = await client.query<ObservationRow>(
    `SELECT observation_id, observation_type, source_adapter_id, source_item_id, doc_id,
            scope_kind, scope_id, geography_kind, geography_id, component_id, metric_name,
            metric_value::text, metric_unit, time_window_start, time_window_end, baseline_value::text,
            change_value::text, change_percent, confidence, provenance, attrs, created_at
     FROM observations
     WHERE observation_id = $1`,
    [observationId]
  );
  return result.rows[0];
}

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

export interface UpsertLeadObservationResult {
  lead_id: string;
  inserted: boolean;
}

export async function insertLeadObservation(client: DbClient, input: NewLeadObservationInput): Promise<{ lead_id: string }> {
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

export async function upsertLeadObservation(client: DbClient, input: NewLeadObservationInput): Promise<UpsertLeadObservationResult> {
  const leadId = input.lead_id ?? createId("LEAD");
  const result = await client.query<UpsertLeadRow>(
    `INSERT INTO lead_observations (
       lead_id, lead_type, source_adapter_id, doc_id, scope_kind, scope_id, title, summary,
       cite_text, source_url, status, review_id, attrs
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (lead_id) DO UPDATE SET
       lead_type = EXCLUDED.lead_type,
       source_adapter_id = EXCLUDED.source_adapter_id,
       doc_id = EXCLUDED.doc_id,
       scope_kind = EXCLUDED.scope_kind,
       scope_id = EXCLUDED.scope_id,
       title = EXCLUDED.title,
       summary = EXCLUDED.summary,
       cite_text = EXCLUDED.cite_text,
       source_url = EXCLUDED.source_url,
       status = EXCLUDED.status,
       review_id = EXCLUDED.review_id,
       attrs = EXCLUDED.attrs,
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

function observationParams(observationId: string, input: NewObservationInput): readonly unknown[] {
  return [
    observationId,
    input.observation_type,
    input.source_adapter_id,
    input.source_item_id ?? null,
    input.doc_id ?? null,
    input.scope_kind,
    input.scope_id,
    input.geography_kind ?? null,
    input.geography_id ?? null,
    input.component_id ?? null,
    input.metric_name,
    input.metric_value ?? null,
    input.metric_unit ?? null,
    input.time_window_start ?? null,
    input.time_window_end ?? null,
    input.baseline_value ?? null,
    input.change_value ?? null,
    input.change_percent ?? null,
    input.confidence,
    input.provenance ?? {},
    input.attrs ?? {}
  ];
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
