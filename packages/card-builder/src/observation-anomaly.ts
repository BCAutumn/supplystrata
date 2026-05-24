import type { DbClient, RiskMetricRecord } from "@supplystrata/db/read";
import { getLatestRiskViewByScope, listRiskMetricsForView } from "@supplystrata/db/read";
import type { CompanyObservation, ComponentObservation, ObservationAnomalySummary } from "@supplystrata/render";
import type { CardObservationRow } from "./db-rows.js";

export async function companyObservationFromRowWithAnomaly(client: DbClient, row: CardObservationRow): Promise<CompanyObservation> {
  return {
    ...observationBaseFromRow(row),
    anomaly: await loadObservationAnomaly(client, row.observation_id)
  };
}

export async function componentObservationFromRowWithAnomaly(client: DbClient, row: CardObservationRow): Promise<ComponentObservation> {
  return {
    ...observationBaseFromRow(row),
    anomaly: await loadObservationAnomaly(client, row.observation_id)
  };
}

async function loadObservationAnomaly(client: DbClient, observationId: string): Promise<ObservationAnomalySummary | null> {
  const riskView = await getLatestRiskViewByScope(client, { scope_kind: "observation", scope_id: observationId });
  if (riskView === undefined) return null;
  const metrics = await listRiskMetricsForView(client, riskView.risk_view_id);
  const metric = metrics.find((item) => item.metric_kind === "observation_anomaly" && item.subject_id === observationId);
  if (metric === undefined) return null;
  return anomalySummaryFromMetric(riskView, metric);
}

function anomalySummaryFromMetric(
  riskView: { risk_view_id: string; model_version: string; generated_at: string },
  metric: RiskMetricRecord
): ObservationAnomalySummary | null {
  const isAnomaly = booleanAttr(metric.attrs, "is_anomaly");
  const severity = severityAttr(metric.attrs, "severity");
  const direction = directionAttr(metric.attrs, "direction");
  const changePercent = numberAttr(metric.attrs, "change_percent");
  const thresholdPercent = numberAttr(metric.attrs, "threshold_percent");
  const baselineMethod = stringAttr(metric.attrs, "baseline_method");
  const baselineValue = stringAttr(metric.attrs, "baseline_value");
  const zLikeScore = numberAttr(metric.attrs, "z_like_score");
  const zThreshold = numberAttr(metric.attrs, "z_threshold");
  const method = stringAttr(metric.attrs, "method");
  if (isAnomaly === undefined || severity === undefined || direction === undefined || changePercent === undefined || thresholdPercent === undefined) {
    return null;
  }
  return {
    risk_view_id: riskView.risk_view_id,
    model_version: riskView.model_version,
    generated_at: riskView.generated_at,
    metric_id: metric.metric_id,
    is_anomaly: isAnomaly,
    severity,
    direction,
    change_percent: changePercent,
    threshold_percent: thresholdPercent,
    ...(baselineMethod === undefined ? {} : { baseline_method: baselineMethod }),
    ...(baselineValue === undefined ? {} : { baseline_value: baselineValue }),
    ...(zLikeScore === undefined ? {} : { z_like_score: zLikeScore }),
    ...(zThreshold === undefined ? {} : { z_threshold: zThreshold }),
    method: method ?? "observation-anomaly.baseline-change-percent.v1"
  };
}

function observationBaseFromRow(row: CardObservationRow): Omit<CompanyObservation, "anomaly"> {
  return {
    observation_id: row.observation_id,
    observation_type: row.observation_type,
    source_adapter_id: row.source_adapter_id,
    source_item_id: row.source_item_id,
    doc_id: row.doc_id,
    scope_kind: row.scope_kind,
    scope_id: row.scope_id,
    geography_kind: row.geography_kind,
    geography_id: row.geography_id,
    component_id: row.component_id,
    metric_name: row.metric_name,
    metric_value: row.metric_value,
    metric_unit: row.metric_unit,
    time_window_start: row.time_window_start === null ? null : row.time_window_start.toISOString(),
    time_window_end: row.time_window_end === null ? null : row.time_window_end.toISOString(),
    baseline_value: row.baseline_value,
    change_value: row.change_value,
    change_percent: row.change_percent,
    confidence: row.confidence,
    provenance: row.provenance,
    attrs: row.attrs,
    created_at: row.created_at.toISOString()
  };
}

function stringAttr(attrs: Record<string, unknown>, key: string): string | undefined {
  const value = attrs[key];
  return typeof value === "string" ? value : undefined;
}

function numberAttr(attrs: Record<string, unknown>, key: string): number | undefined {
  const value = attrs[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanAttr(attrs: Record<string, unknown>, key: string): boolean | undefined {
  const value = attrs[key];
  return typeof value === "boolean" ? value : undefined;
}

function severityAttr(attrs: Record<string, unknown>, key: string): ObservationAnomalySummary["severity"] | undefined {
  const value = stringAttr(attrs, key);
  if (value === "none" || value === "moderate" || value === "high" || value === "critical") return value;
  return undefined;
}

function directionAttr(attrs: Record<string, unknown>, key: string): ObservationAnomalySummary["direction"] | undefined {
  const value = stringAttr(attrs, key);
  if (value === "increase" || value === "decrease" || value === "flat") return value;
  return undefined;
}
