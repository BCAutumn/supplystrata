import type pg from "pg";
import type { AlertKind } from "@supplystrata/core";
import type { DbClient, DbTxClient } from "./client.js";
import { recordSemanticChange } from "./changes.js";

export type AlertSeverity = "low" | "medium" | "high" | "critical";
export type AlertStatus = "open" | "acknowledged" | "resolved" | "suppressed";

interface AlertCandidateRow extends pg.QueryResultRow {
  alert_id: string;
  alert_kind: AlertKind;
  severity: AlertSeverity;
  status: AlertStatus;
  scope_kind: string;
  scope_id: string;
  title: string;
  summary: string;
  dedupe_key: string;
  observation_id: string | null;
  risk_view_id: string | null;
  risk_metric_id: string | null;
  change_id: string | null;
  source_event_id: string | null;
  source_adapter_id: string | null;
  detected_at: Date | string;
  provenance: Record<string, unknown>;
  attrs: Record<string, unknown>;
}

export interface AlertCandidateRecord {
  alert_id: string;
  alert_kind: AlertKind;
  severity: AlertSeverity;
  status: AlertStatus;
  scope_kind: string;
  scope_id: string;
  title: string;
  summary: string;
  dedupe_key: string;
  observation_id?: string;
  risk_view_id?: string;
  risk_metric_id?: string;
  change_id?: string;
  source_event_id?: string;
  source_adapter_id?: string;
  detected_at: string;
  provenance: Record<string, unknown>;
  attrs: Record<string, unknown>;
}

export interface UpsertAlertCandidateInput {
  alert_id: string;
  alert_kind: AlertKind;
  severity: AlertSeverity;
  scope_kind: string;
  scope_id: string;
  title: string;
  summary: string;
  dedupe_key: string;
  detected_at: string;
  observation_id?: string;
  risk_view_id?: string;
  risk_metric_id?: string;
  change_id?: string;
  source_event_id?: string;
  source_adapter_id?: string;
  provenance?: Record<string, unknown>;
  attrs?: Record<string, unknown>;
}

interface AlertUpsertRow extends pg.QueryResultRow {
  alert_id: string;
  inserted: boolean;
}

export interface UpsertAlertCandidateResult {
  alert_id: string;
  inserted: boolean;
}

export interface UpdateAlertCandidateStatusInput {
  alert_id: string;
  status: AlertStatus;
  reviewer: string;
  reason?: string;
}

export interface UpdateAlertCandidateStatusResult {
  alert: AlertCandidateRecord;
  changed: boolean;
  change_id?: string;
}

export async function upsertAlertCandidate(client: DbTxClient, input: UpsertAlertCandidateInput): Promise<UpsertAlertCandidateResult> {
  const result = await client.query<AlertUpsertRow>(
    `INSERT INTO alert_candidates (
       alert_id, alert_kind, severity, scope_kind, scope_id, title, summary, dedupe_key,
       observation_id, risk_view_id, risk_metric_id, change_id, source_event_id, source_adapter_id,
       detected_at, provenance, attrs
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb)
     ON CONFLICT (dedupe_key) DO UPDATE SET
       severity = EXCLUDED.severity,
       title = EXCLUDED.title,
       summary = EXCLUDED.summary,
       observation_id = COALESCE(EXCLUDED.observation_id, alert_candidates.observation_id),
       risk_view_id = COALESCE(EXCLUDED.risk_view_id, alert_candidates.risk_view_id),
       risk_metric_id = COALESCE(EXCLUDED.risk_metric_id, alert_candidates.risk_metric_id),
       change_id = COALESCE(EXCLUDED.change_id, alert_candidates.change_id),
       source_event_id = COALESCE(EXCLUDED.source_event_id, alert_candidates.source_event_id),
       source_adapter_id = COALESCE(EXCLUDED.source_adapter_id, alert_candidates.source_adapter_id),
       detected_at = GREATEST(alert_candidates.detected_at, EXCLUDED.detected_at),
       provenance = alert_candidates.provenance || EXCLUDED.provenance,
       attrs = alert_candidates.attrs || EXCLUDED.attrs,
       updated_at = now()
     RETURNING alert_id, (xmax = 0) AS inserted`,
    [
      input.alert_id,
      input.alert_kind,
      input.severity,
      input.scope_kind,
      input.scope_id,
      input.title,
      input.summary,
      input.dedupe_key,
      input.observation_id ?? null,
      input.risk_view_id ?? null,
      input.risk_metric_id ?? null,
      input.change_id ?? null,
      input.source_event_id ?? null,
      input.source_adapter_id ?? null,
      input.detected_at,
      JSON.stringify(input.provenance ?? {}),
      JSON.stringify(input.attrs ?? {})
    ]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Alert candidate upsert did not return a row: ${input.alert_id}`);
  return { alert_id: row.alert_id, inserted: row.inserted };
}

export async function listAlertCandidates(client: DbClient, input: { status?: AlertStatus; limit?: number } = {}): Promise<AlertCandidateRecord[]> {
  const params: unknown[] = [];
  const predicates: string[] = [];
  if (input.status !== undefined) {
    params.push(input.status);
    predicates.push(`status = $${params.length}`);
  }
  params.push(input.limit ?? 50);
  const result = await client.query<AlertCandidateRow>(
    `SELECT alert_id, alert_kind, severity, status, scope_kind, scope_id, title, summary, dedupe_key,
            observation_id, risk_view_id, risk_metric_id, change_id, source_event_id, source_adapter_id,
            detected_at, provenance, attrs
     FROM alert_candidates
     ${predicates.length === 0 ? "" : `WHERE ${predicates.join(" AND ")}`}
     ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
              detected_at DESC,
              alert_id
     LIMIT $${params.length}`,
    params
  );
  return result.rows.map(alertCandidateRowToRecord);
}

// 状态变更需要和审计记录在同一个事务里完成；否则 FOR UPDATE 的锁会在自动提交后立即释放。
export async function updateAlertCandidateStatus(client: DbTxClient, input: UpdateAlertCandidateStatusInput): Promise<UpdateAlertCandidateStatusResult> {
  const current = await getAlertCandidateForUpdate(client, input.alert_id);
  if (current === undefined) throw new Error(`Alert candidate not found: ${input.alert_id}`);

  if (current.status === input.status) {
    return { alert: alertCandidateRowToRecord(current), changed: false };
  }

  const result = await client.query<AlertCandidateRow>(
    `UPDATE alert_candidates
     SET status = $2,
         attrs = attrs || jsonb_build_object(
           'last_status_change',
           jsonb_build_object(
             'status', $2::text,
             'reviewer', $3::text,
             'reason', $4::text,
             'changed_at', now()
           )
         ),
         updated_at = now()
     WHERE alert_id = $1
     RETURNING alert_id, alert_kind, severity, status, scope_kind, scope_id, title, summary, dedupe_key,
               observation_id, risk_view_id, risk_metric_id, change_id, source_event_id, source_adapter_id,
               detected_at, provenance, attrs`,
    [input.alert_id, input.status, input.reviewer, input.reason ?? null]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Alert candidate status update did not return a row: ${input.alert_id}`);

  const change = await recordSemanticChange(client, {
    scope_kind: "alert",
    scope_id: input.alert_id,
    change_type: "ALERT_STATUS_CHANGED",
    before: { status: current.status },
    after: statusChangeAfter(row, input),
    caused_by: input.reviewer
  });

  return { alert: alertCandidateRowToRecord(row), changed: true, change_id: change.change_id };
}

const selectAlertCandidateFields = `SELECT alert_id, alert_kind, severity, status, scope_kind, scope_id, title, summary, dedupe_key,
       observation_id, risk_view_id, risk_metric_id, change_id, source_event_id, source_adapter_id,
       detected_at, provenance, attrs`;

async function getAlertCandidateForUpdate(client: DbClient, alertId: string): Promise<AlertCandidateRow | undefined> {
  const result = await client.query<AlertCandidateRow>(
    `${selectAlertCandidateFields}
     FROM alert_candidates
     WHERE alert_id = $1
     FOR UPDATE`,
    [alertId]
  );
  return result.rows[0];
}

function statusChangeAfter(row: AlertCandidateRow, input: UpdateAlertCandidateStatusInput): Record<string, unknown> {
  return {
    status: row.status,
    reviewer: input.reviewer,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    alert_kind: row.alert_kind,
    severity: row.severity,
    scope_kind: row.scope_kind,
    scope_id: row.scope_id,
    ...(row.observation_id === null ? {} : { observation_id: row.observation_id }),
    ...(row.risk_view_id === null ? {} : { risk_view_id: row.risk_view_id }),
    ...(row.risk_metric_id === null ? {} : { risk_metric_id: row.risk_metric_id }),
    ...(row.source_event_id === null ? {} : { source_event_id: row.source_event_id }),
    ...(row.source_adapter_id === null ? {} : { source_adapter_id: row.source_adapter_id })
  };
}

function alertCandidateRowToRecord(row: AlertCandidateRow): AlertCandidateRecord {
  return {
    alert_id: row.alert_id,
    alert_kind: row.alert_kind,
    severity: row.severity,
    status: row.status,
    scope_kind: row.scope_kind,
    scope_id: row.scope_id,
    title: row.title,
    summary: row.summary,
    dedupe_key: row.dedupe_key,
    ...(row.observation_id === null ? {} : { observation_id: row.observation_id }),
    ...(row.risk_view_id === null ? {} : { risk_view_id: row.risk_view_id }),
    ...(row.risk_metric_id === null ? {} : { risk_metric_id: row.risk_metric_id }),
    ...(row.change_id === null ? {} : { change_id: row.change_id }),
    ...(row.source_event_id === null ? {} : { source_event_id: row.source_event_id }),
    ...(row.source_adapter_id === null ? {} : { source_adapter_id: row.source_adapter_id }),
    detected_at: row.detected_at instanceof Date ? row.detected_at.toISOString() : row.detected_at,
    provenance: row.provenance,
    attrs: row.attrs
  };
}
