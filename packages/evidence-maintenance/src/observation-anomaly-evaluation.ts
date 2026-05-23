import { createHash } from "node:crypto";
import type { RiskMetricKind } from "@supplystrata/core";
import type { RiskMetricRecord } from "@supplystrata/db/read";
import type { ObservationAnomalyRow } from "./db-rows.js";

export const OBSERVATION_ANOMALY_MODEL_VERSION = "observation-anomaly-baseline.v2";

const MAD_EPSILON = 1e-9;

type StableJsonArray = readonly StableJsonValue[];
type StableJsonObject = { readonly [key: string]: StableJsonValue };
type StableJsonValue = null | string | number | boolean | StableJsonArray | StableJsonObject;

export interface ObservationChangeEvaluation {
  metric_value: number;
  change_percent: number;
  abs_change_percent: number;
  baseline_value: number;
  baseline_method: "explicit_baseline" | "trailing_median_mad";
  method: "observation-anomaly.baseline-change-percent.v1" | "observation-anomaly.trailing-median-mad.v1";
  mad?: number;
  z_like_score?: number;
  baseline_observation_ids: string[];
  direction: "increase" | "decrease" | "flat";
  severity: "none" | "moderate" | "high" | "critical";
  is_anomaly: boolean;
}

export function evaluateExplicitBaselineChange(row: ObservationAnomalyRow, thresholdPercent: number): ObservationChangeEvaluation | undefined {
  const baselineValue = parseFiniteNumber(row.baseline_value);
  if (baselineValue === undefined) return undefined;
  const changePercent = row.change_percent ?? computedChangePercent(row);
  if (changePercent === undefined) return undefined;
  const absChangePercent = Math.abs(changePercent);
  const isAnomaly = absChangePercent >= thresholdPercent;
  return {
    metric_value: roundSix(absChangePercent),
    change_percent: roundSix(changePercent),
    abs_change_percent: roundSix(absChangePercent),
    baseline_value: roundSix(baselineValue),
    baseline_method: "explicit_baseline",
    method: "observation-anomaly.baseline-change-percent.v1",
    baseline_observation_ids: [],
    direction: changePercent > 0 ? "increase" : changePercent < 0 ? "decrease" : "flat",
    severity: anomalySeverity(absChangePercent, thresholdPercent),
    is_anomaly: isAnomaly
  };
}

export function evaluateTrailingMedianMadChange(
  row: ObservationAnomalyRow,
  history: readonly ObservationAnomalyRow[],
  input: { thresholdPercent: number; zThreshold: number; minHistoryPoints: number }
): ObservationChangeEvaluation | undefined {
  const currentValue = parseFiniteNumber(row.metric_value);
  if (currentValue === undefined) return undefined;
  const historyPoints = history
    .map((item) => ({ observation_id: item.observation_id, value: parseFiniteNumber(item.metric_value) }))
    .filter((item): item is { observation_id: string; value: number } => item.value !== undefined);
  if (historyPoints.length < input.minHistoryPoints) return undefined;

  const values = historyPoints.map((item) => item.value);
  const baselineValue = median(values);
  const mad = median(values.map((value) => Math.abs(value - baselineValue)));
  const zLikeScore = (currentValue - baselineValue) / Math.max(mad, MAD_EPSILON);
  const changePercent = baselineValue === 0 ? 0 : ((currentValue - baselineValue) / Math.abs(baselineValue)) * 100;
  const absZLikeScore = Math.abs(zLikeScore);
  const absChangePercent = Math.abs(changePercent);
  const isAnomaly = absZLikeScore >= input.zThreshold;
  return {
    metric_value: roundSix(absZLikeScore),
    change_percent: roundSix(changePercent),
    abs_change_percent: roundSix(absChangePercent),
    baseline_value: roundSix(baselineValue),
    baseline_method: "trailing_median_mad",
    method: "observation-anomaly.trailing-median-mad.v1",
    mad: roundSix(mad),
    z_like_score: roundSix(zLikeScore),
    baseline_observation_ids: historyPoints.map((item) => item.observation_id),
    direction: currentValue > baselineValue ? "increase" : currentValue < baselineValue ? "decrease" : "flat",
    severity: anomalySeverity(absZLikeScore, input.zThreshold),
    is_anomaly: isAnomaly
  };
}

export function observationAnomalyMetric(input: {
  riskViewId: string;
  row: ObservationAnomalyRow;
  evaluation: ObservationChangeEvaluation;
  thresholdPercent: number;
  zThreshold: number;
}): Omit<RiskMetricRecord, "risk_view_id"> {
  return {
    metric_id: deterministicRiskMetricId(input.riskViewId, "observation_anomaly", "observation", input.row.observation_id),
    metric_kind: "observation_anomaly",
    subject_kind: "observation",
    subject_id: input.row.observation_id,
    ...(input.row.component_id === null ? {} : { component_id: input.row.component_id }),
    value: input.evaluation.metric_value.toFixed(6),
    confidence: input.row.confidence,
    provenance: {
      model_version: OBSERVATION_ANOMALY_MODEL_VERSION,
      method: input.evaluation.method,
      observation_id: input.row.observation_id,
      observation_type: input.row.observation_type,
      source_adapter_id: input.row.source_adapter_id,
      source_item_id: input.row.source_item_id,
      doc_id: input.row.doc_id,
      baseline_observation_ids: input.evaluation.baseline_observation_ids
    },
    attrs: {
      is_anomaly: input.evaluation.is_anomaly,
      direction: input.evaluation.direction,
      severity: input.evaluation.severity,
      baseline_method: input.evaluation.baseline_method,
      threshold_percent: input.thresholdPercent,
      z_threshold: input.zThreshold,
      change_percent: input.evaluation.change_percent,
      baseline_value: input.evaluation.baseline_value.toString(),
      mad: input.evaluation.mad ?? null,
      z_like_score: input.evaluation.z_like_score ?? null,
      history_count: input.evaluation.baseline_observation_ids.length,
      baseline_observation_ids: input.evaluation.baseline_observation_ids,
      metric_value: input.row.metric_value,
      metric_unit: input.row.metric_unit,
      method: input.evaluation.method,
      limitation:
        input.evaluation.baseline_method === "explicit_baseline"
          ? "Uses the observation's explicit baseline/change fields."
          : "Uses comparable prior observations in the same scope/geography/component/metric/unit series; sparse or non-comparable history is not evaluated."
    }
  };
}

export function observationAnomalyInputsFingerprint(input: {
  row: ObservationAnomalyRow;
  evaluation: ObservationChangeEvaluation;
  thresholdPercent: number;
  zThreshold: number;
  historyPeriods: number;
  minHistoryPoints: number;
}): string {
  return createHash("sha256")
    .update(
      stableJson({
        model_version: OBSERVATION_ANOMALY_MODEL_VERSION,
        threshold_percent: input.thresholdPercent,
        z_threshold: input.zThreshold,
        history_periods: input.historyPeriods,
        min_history_points: input.minHistoryPoints,
        observation: {
          observation_id: input.row.observation_id,
          observation_type: input.row.observation_type,
          source_adapter_id: input.row.source_adapter_id,
          source_item_id: input.row.source_item_id,
          doc_id: input.row.doc_id,
          scope_kind: input.row.scope_kind,
          scope_id: input.row.scope_id,
          geography_kind: input.row.geography_kind,
          geography_id: input.row.geography_id,
          component_id: input.row.component_id,
          metric_name: input.row.metric_name,
          metric_value: input.row.metric_value,
          metric_unit: input.row.metric_unit,
          time_window_start: dateOrNull(input.row.time_window_start),
          time_window_end: dateOrNull(input.row.time_window_end),
          baseline_value: input.row.baseline_value,
          change_value: input.row.change_value,
          change_percent: input.row.change_percent,
          confidence: input.row.confidence
        },
        evaluation: {
          metric_value: input.evaluation.metric_value,
          change_percent: input.evaluation.change_percent,
          abs_change_percent: input.evaluation.abs_change_percent,
          baseline_value: input.evaluation.baseline_value,
          baseline_method: input.evaluation.baseline_method,
          mad: input.evaluation.mad ?? null,
          z_like_score: input.evaluation.z_like_score ?? null,
          baseline_observation_ids: input.evaluation.baseline_observation_ids,
          is_anomaly: input.evaluation.is_anomaly,
          direction: input.evaluation.direction,
          severity: input.evaluation.severity
        }
      })
    )
    .digest("hex");
}

export function deterministicRiskViewId(observationId: string, fingerprint: string): string {
  return `RSK-OBS-${digestForId(`${observationId}:${fingerprint}`, 24)}`;
}

function computedChangePercent(row: ObservationAnomalyRow): number | undefined {
  const metricValue = parseFiniteNumber(row.metric_value);
  const baselineValue = parseFiniteNumber(row.baseline_value);
  if (metricValue === undefined || baselineValue === undefined || baselineValue === 0) return undefined;
  return ((metricValue - baselineValue) / Math.abs(baselineValue)) * 100;
}

function anomalySeverity(value: number, threshold: number): ObservationChangeEvaluation["severity"] {
  // 阈值只决定是否异常；severity 用阈值倍数表达变化幅度，避免伪装成全局风险分数。
  if (value < threshold) return "none";
  if (value >= threshold * 3) return "critical";
  if (value >= threshold * 2) return "high";
  return "moderate";
}

function deterministicRiskMetricId(riskViewId: string, metricKind: RiskMetricKind, subjectKind: string, subjectId: string): string {
  return `RKM-${digestForId(`${riskViewId}:${metricKind}:${subjectKind}:${subjectId}`, 24)}`;
}

function digestForId(value: string, length: number): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length).toUpperCase();
}

function parseFiniteNumber(value: string | null): number | undefined {
  if (value === null || value.trim().length === 0) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function roundSix(value: number): number {
  return Number(value.toFixed(6));
}

function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("Cannot compute median for an empty series");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const middleValue = sorted[middle];
  if (middleValue === undefined) throw new Error("Median index must exist for a non-empty series");
  if (sorted.length % 2 === 1) return middleValue;
  const previousValue = sorted[middle - 1];
  if (previousValue === undefined) throw new Error("Median previous index must exist for an even-length series");
  return (previousValue + middleValue) / 2;
}

function dateOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function stableJson(value: StableJsonValue): string {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (isStableJsonArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key] ?? null)}`)
    .join(",")}}`;
}

function isStableJsonArray(value: StableJsonValue): value is StableJsonArray {
  return Array.isArray(value);
}
