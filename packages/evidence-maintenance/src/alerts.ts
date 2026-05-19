import type pg from "pg";
import { createHash } from "node:crypto";
import type { AlertKind, RiskMetricKind } from "@supplystrata/core";
import type { AlertSeverity, DbClient, UpsertAlertCandidateInput } from "@supplystrata/db";
import { upsertAlertCandidate } from "@supplystrata/db";

interface ObservationAnomalyChangeRow extends pg.QueryResultRow {
  change_id: string;
  detected_at: Date;
  observation_id: string;
  after: Record<string, unknown>;
}

interface SourceFailureEventRow extends pg.QueryResultRow {
  event_id: string;
  detected_at: Date;
  source_adapter_id: string;
  after: Record<string, unknown>;
}

interface ComponentRiskMetricAlertRow extends pg.QueryResultRow {
  risk_view_id: string;
  generated_at: Date;
  model_version: string;
  metric_id: string;
  metric_kind: RiskMetricKind;
  subject_kind: string;
  subject_id: string;
  component_id: string;
  value: string | null;
  confidence: number;
  attrs: Record<string, unknown>;
}

export interface RefreshAlertCandidatesInput {
  since?: string;
  limit?: number;
  generated_by?: string;
}

export interface AlertCandidateRefreshSummary {
  scanned: number;
  upserted: number;
  inserted: number;
  updated: number;
  observation_anomaly_alerts: number;
  source_failure_alerts: number;
  component_risk_alerts: number;
  generated_by: string;
  since: string;
}

const DEFAULT_ALERT_LOOKBACK_DAYS = 7;

export async function refreshAlertCandidates(client: DbClient, input: RefreshAlertCandidatesInput = {}): Promise<AlertCandidateRefreshSummary> {
  const since = input.since ?? new Date(Date.now() - DEFAULT_ALERT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const limit = input.limit ?? 1000;
  if (!Number.isInteger(limit) || limit <= 0) throw new Error(`Alert refresh limit must be a positive integer: ${limit}`);
  const generatedBy = input.generated_by ?? "evidence-maintenance.alert-rules.v1";
  const [observationAlerts, sourceAlerts, componentAlerts] = await Promise.all([
    observationAnomalyAlertDrafts(client, { since, limit, generatedBy }),
    sourceFailureAlertDrafts(client, { since, limit, generatedBy }),
    componentRiskAlertDrafts(client, { since, limit, generatedBy })
  ]);
  const drafts = [...observationAlerts, ...sourceAlerts, ...componentAlerts];
  let inserted = 0;
  let updated = 0;
  for (const draft of drafts) {
    const result = await upsertAlertCandidate(client, draft);
    if (result.inserted) {
      inserted += 1;
    } else {
      updated += 1;
    }
  }
  return {
    scanned: drafts.length,
    upserted: drafts.length,
    inserted,
    updated,
    observation_anomaly_alerts: observationAlerts.length,
    source_failure_alerts: sourceAlerts.length,
    component_risk_alerts: componentAlerts.length,
    generated_by: generatedBy,
    since
  };
}

async function observationAnomalyAlertDrafts(
  client: DbClient,
  input: { since: string; limit: number; generatedBy: string }
): Promise<UpsertAlertCandidateInput[]> {
  const result = await client.query<ObservationAnomalyChangeRow>(
    `SELECT change_id, detected_at, scope_id AS observation_id, after
     FROM change_records
     WHERE change_type = 'OBSERVATION_ANOMALY'
       AND detected_at >= $1::timestamptz
     ORDER BY detected_at DESC, change_id
     LIMIT $2`,
    [input.since, input.limit]
  );
  return result.rows.map((row) => {
    const riskViewId = stringField(row.after, "risk_view_id") ?? "";
    const severity = alertSeverityFromAnomaly(stringField(row.after, "severity"));
    const metricName = stringField(row.after, "metric_name") ?? "observation metric";
    const dedupeKey = `observation_anomaly:${row.observation_id}:${riskViewId}`;
    return {
      alert_id: deterministicAlertId(dedupeKey),
      alert_kind: "observation_anomaly",
      severity,
      scope_kind: "observation",
      scope_id: row.observation_id,
      title: `Observation anomaly: ${metricName}`,
      summary: `Observation ${row.observation_id} breached its anomaly rule and needs review.`,
      dedupe_key: dedupeKey,
      observation_id: row.observation_id,
      ...(riskViewId.length === 0 ? {} : { risk_view_id: riskViewId }),
      change_id: row.change_id,
      detected_at: row.detected_at.toISOString(),
      provenance: { rule: "alert-rules.observation-anomaly.v1", generated_by: input.generatedBy },
      attrs: { source_change_type: "OBSERVATION_ANOMALY", anomaly: row.after }
    };
  });
}

async function sourceFailureAlertDrafts(client: DbClient, input: { since: string; limit: number; generatedBy: string }): Promise<UpsertAlertCandidateInput[]> {
  const result = await client.query<SourceFailureEventRow>(
    `SELECT event_id, detected_at, source_adapter_id, after
     FROM source_change_events
     WHERE event_type = 'SOURCE_FAILED'
       AND detected_at >= $1::timestamptz
     ORDER BY detected_at DESC, event_id
     LIMIT $2`,
    [input.since, input.limit]
  );
  return result.rows.map((row) => {
    const dedupeKey = `source_failure:${row.event_id}`;
    return {
      alert_id: deterministicAlertId(dedupeKey),
      alert_kind: "source_failure",
      severity: sourceFailureSeverity(row.after),
      scope_kind: "source",
      scope_id: row.source_adapter_id,
      title: `Source failed: ${row.source_adapter_id}`,
      summary: `Source monitor recorded a failure for ${row.source_adapter_id}.`,
      dedupe_key: dedupeKey,
      source_event_id: row.event_id,
      source_adapter_id: row.source_adapter_id,
      detected_at: row.detected_at.toISOString(),
      provenance: { rule: "alert-rules.source-failure.v1", generated_by: input.generatedBy },
      attrs: { source_event_after: row.after }
    };
  });
}

async function componentRiskAlertDrafts(client: DbClient, input: { since: string; limit: number; generatedBy: string }): Promise<UpsertAlertCandidateInput[]> {
  const result = await client.query<ComponentRiskMetricAlertRow>(
    `SELECT rv.risk_view_id, rv.generated_at, rv.model_version,
            rm.metric_id, rm.metric_kind, rm.subject_kind, rm.subject_id, rm.component_id,
            rm.value::text, rm.confidence, rm.attrs
     FROM risk_views rv
     JOIN risk_metrics rm ON rm.risk_view_id = rv.risk_view_id
     WHERE rv.generated_at >= $1::timestamptz
       AND rm.component_id IS NOT NULL
       AND (
         (rm.metric_kind = 'single_source_exposure' AND rm.value >= 1)
         OR (rm.metric_kind = 'supplier_concentration_hhi' AND rm.value >= 0.25)
         OR (rm.metric_kind = 'node_knockout_reach' AND rm.value >= 1)
         OR (rm.metric_kind = 'node_knockout_weighted_impact' AND rm.value >= 0.25)
       )
     ORDER BY rv.generated_at DESC, rm.metric_kind, rm.metric_id
     LIMIT $2`,
    [input.since, input.limit]
  );
  return result.rows.map((row) => {
    const value = numericString(row.value);
    const severity = componentRiskSeverity(row.metric_kind, value);
    const dedupeKey = `component_risk:${row.metric_id}`;
    return {
      alert_id: deterministicAlertId(dedupeKey),
      alert_kind: "component_risk",
      severity,
      scope_kind: "component",
      scope_id: row.component_id,
      title: `Component risk: ${row.metric_kind}`,
      summary: `Component ${row.component_id} has ${row.metric_kind}=${row.value ?? "unknown"} in ${row.risk_view_id}.`,
      dedupe_key: dedupeKey,
      risk_view_id: row.risk_view_id,
      risk_metric_id: row.metric_id,
      detected_at: row.generated_at.toISOString(),
      provenance: { rule: "alert-rules.component-risk.v1", generated_by: input.generatedBy, model_version: row.model_version },
      attrs: {
        metric_kind: row.metric_kind,
        subject_kind: row.subject_kind,
        subject_id: row.subject_id,
        value: row.value,
        confidence: row.confidence,
        metric_attrs: row.attrs
      }
    };
  });
}

function componentRiskSeverity(metricKind: RiskMetricKind, value: number | undefined): AlertSeverity {
  if (metricKind === "single_source_exposure") return "high";
  if (metricKind === "supplier_concentration_hhi") return value !== undefined && value >= 0.5 ? "high" : "medium";
  if (metricKind === "node_knockout_reach") return value !== undefined && value >= 3 ? "high" : "medium";
  if (metricKind === "node_knockout_weighted_impact") return value !== undefined && value >= 1 ? "high" : "medium";
  return "low";
}

function alertSeverityFromAnomaly(value: string | undefined): AlertSeverity {
  if (value === "critical") return "critical";
  if (value === "high") return "high";
  if (value === "moderate") return "medium";
  return "low";
}

function sourceFailureSeverity(attrs: Record<string, unknown>): AlertSeverity {
  const failureCount = numberField(attrs, "failure_count");
  return failureCount !== undefined && failureCount >= 3 ? "high" : "medium";
}

function deterministicAlertId(dedupeKey: string): string {
  return `ALT-${createHash("sha256").update(dedupeKey).digest("hex").slice(0, 24).toUpperCase()}`;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function numericString(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
