import type pg from "pg";
import type { RiskMetricKind } from "@supplystrata/core";
import type { DbClient } from "./client.js";

interface RiskViewRow extends pg.QueryResultRow {
  risk_view_id: string;
  scope_kind: string;
  scope_id: string;
  generated_at: Date | string;
  model_version: string;
  inputs_fingerprint: string;
  summary: Record<string, unknown>;
  attrs: Record<string, unknown>;
}

interface RiskMetricRow extends pg.QueryResultRow {
  metric_id: string;
  risk_view_id: string;
  metric_kind: RiskMetricKind;
  subject_kind: string;
  subject_id: string;
  component_id: string | null;
  value: string | null;
  confidence: number;
  provenance: Record<string, unknown>;
  attrs: Record<string, unknown>;
}

export interface RiskViewRecord {
  risk_view_id: string;
  scope_kind: string;
  scope_id: string;
  generated_at: string;
  model_version: string;
  inputs_fingerprint: string;
  summary: Record<string, unknown>;
  attrs: Record<string, unknown>;
}

export interface RiskMetricRecord {
  metric_id: string;
  risk_view_id: string;
  metric_kind: RiskMetricKind;
  subject_kind: string;
  subject_id: string;
  component_id?: string;
  value?: string;
  confidence: number;
  provenance: Record<string, unknown>;
  attrs: Record<string, unknown>;
}

export interface ReplaceRiskViewInput {
  risk_view_id: string;
  scope_kind: string;
  scope_id: string;
  generated_at: string;
  model_version: string;
  inputs_fingerprint: string;
  summary: Record<string, unknown>;
  attrs?: Record<string, unknown>;
  metrics: readonly Omit<RiskMetricRecord, "risk_view_id">[];
}

export async function replaceRiskView(client: DbClient, input: ReplaceRiskViewInput): Promise<{ risk_view_id: string; metrics: number }> {
  const result = await client.query<{ risk_view_id: string } & pg.QueryResultRow>(
    `INSERT INTO risk_views (
       risk_view_id, scope_kind, scope_id, generated_at, model_version, inputs_fingerprint, summary, attrs
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
     ON CONFLICT (risk_view_id)
     DO UPDATE SET
       generated_at = EXCLUDED.generated_at,
       model_version = EXCLUDED.model_version,
       inputs_fingerprint = EXCLUDED.inputs_fingerprint,
       summary = EXCLUDED.summary,
       attrs = risk_views.attrs || EXCLUDED.attrs,
       updated_at = now()
     RETURNING risk_view_id`,
    [
      input.risk_view_id,
      input.scope_kind,
      input.scope_id,
      input.generated_at,
      input.model_version,
      input.inputs_fingerprint,
      JSON.stringify(input.summary),
      JSON.stringify(input.attrs ?? {})
    ]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Failed to upsert risk view ${input.risk_view_id}`);

  await client.query("DELETE FROM risk_metrics WHERE risk_view_id = $1", [row.risk_view_id]);
  for (const metric of input.metrics) {
    await client.query(
      `INSERT INTO risk_metrics (
         metric_id, risk_view_id, metric_kind, subject_kind, subject_id, component_id,
         value, confidence, provenance, attrs
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)`,
      [
        metric.metric_id,
        row.risk_view_id,
        metric.metric_kind,
        metric.subject_kind,
        metric.subject_id,
        metric.component_id ?? null,
        metric.value ?? null,
        metric.confidence,
        JSON.stringify(metric.provenance),
        JSON.stringify(metric.attrs)
      ]
    );
  }
  return { risk_view_id: row.risk_view_id, metrics: input.metrics.length };
}

export async function getLatestRiskViewByScope(client: DbClient, input: { scope_kind: string; scope_id: string }): Promise<RiskViewRecord | undefined> {
  const result = await client.query<RiskViewRow>(
    `SELECT risk_view_id, scope_kind, scope_id, generated_at, model_version, inputs_fingerprint, summary, attrs
     FROM risk_views
     WHERE scope_kind = $1 AND scope_id = $2
     ORDER BY generated_at DESC, risk_view_id DESC
     LIMIT 1`,
    [input.scope_kind, input.scope_id]
  );
  const row = result.rows[0];
  return row === undefined ? undefined : riskViewRowToRecord(row);
}

export async function listRiskMetricsForView(client: DbClient, riskViewId: string): Promise<RiskMetricRecord[]> {
  const result = await client.query<RiskMetricRow>(
    `SELECT metric_id, risk_view_id, metric_kind, subject_kind, subject_id, component_id,
            value, confidence, provenance, attrs
     FROM risk_metrics
     WHERE risk_view_id = $1
     ORDER BY metric_kind, subject_kind, subject_id`,
    [riskViewId]
  );
  return result.rows.map(riskMetricRowToRecord);
}

function riskViewRowToRecord(row: RiskViewRow): RiskViewRecord {
  return {
    risk_view_id: row.risk_view_id,
    scope_kind: row.scope_kind,
    scope_id: row.scope_id,
    generated_at: toIsoString(row.generated_at),
    model_version: row.model_version,
    inputs_fingerprint: row.inputs_fingerprint,
    summary: row.summary,
    attrs: row.attrs
  };
}

function riskMetricRowToRecord(row: RiskMetricRow): RiskMetricRecord {
  return {
    metric_id: row.metric_id,
    risk_view_id: row.risk_view_id,
    metric_kind: row.metric_kind,
    subject_kind: row.subject_kind,
    subject_id: row.subject_id,
    ...(row.component_id === null ? {} : { component_id: row.component_id }),
    ...(row.value === null ? {} : { value: row.value }),
    confidence: row.confidence,
    provenance: row.provenance,
    attrs: row.attrs
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
