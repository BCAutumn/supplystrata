import type { DbClient, ObservationRow, RiskMetricRecord } from "@supplystrata/db";
import { getLatestRiskViewByScope, listRiskMetricsForView } from "@supplystrata/db";
import type { CompanyObservation, ComponentObservation, ObservationAnomalySummary } from "@supplystrata/render";

export async function companyObservationFromRowWithAnomaly(client: DbClient, row: ObservationRow): Promise<CompanyObservation> {
  return {
    ...observationBaseFromRow(row),
    anomaly: await loadObservationAnomaly(client, row.observation_id)
  };
}

export async function componentObservationFromRowWithAnomaly(client: DbClient, row: ObservationRow): Promise<ComponentObservation> {
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

function observationBaseFromRow(row: ObservationRow): Omit<CompanyObservation, "anomaly"> {
  return {
    ...row,
    time_window_start: row.time_window_start === null ? null : row.time_window_start.toISOString(),
    time_window_end: row.time_window_end === null ? null : row.time_window_end.toISOString(),
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
