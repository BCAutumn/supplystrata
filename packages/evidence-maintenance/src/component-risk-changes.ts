import type { RiskMetricKind } from "@supplystrata/core";
import type { DbClient, DbTxClient, RiskMetricRecord, RiskViewRecord } from "@supplystrata/db";
import { recordSemanticChange } from "@supplystrata/db";
import type { ComponentRiskChangeRow } from "./db-rows.js";

export interface RecordComponentRiskMetricChangesInput {
  componentId: string;
  previousRiskView: RiskViewRecord | undefined;
  previousMetrics: readonly RiskMetricRecord[];
  riskViewId: string;
  metrics: readonly Omit<RiskMetricRecord, "risk_view_id">[];
  generatedBy: string;
  modelVersion: string;
}

const RISK_CHANGE_RELATIVE_THRESHOLD = 0.25;
const RISK_CHANGE_ABSOLUTE_THRESHOLDS: Partial<Record<RiskMetricKind, number>> = {
  supplier_concentration_hhi: 0.05,
  single_source_exposure: 1,
  path_redundancy: 1,
  node_knockout_reach: 1,
  node_knockout_weighted_impact: 0.25,
  betweenness_centrality: 0.1,
  freshness_adjusted_exposure: 0.25
};

export async function recordComponentRiskMetricChanges(client: DbTxClient, input: RecordComponentRiskMetricChangesInput): Promise<number> {
  if (input.previousRiskView === undefined || input.previousRiskView.risk_view_id === input.riskViewId) return 0;

  const previousByKey = metricsByStableKey(input.previousMetrics);
  const nextByKey = metricsByStableKey(input.metrics);
  let recorded = 0;
  for (const key of uniqueSorted([...previousByKey.keys(), ...nextByKey.keys()])) {
    const previous = previousByKey.get(key);
    const next = nextByKey.get(key);
    const evaluation = evaluateRiskMetricChange(previous, next);
    if (evaluation === undefined) continue;
    const alreadyRecorded = await hasRiskMetricChangeForView(client, { metricKey: key, riskViewId: input.riskViewId });
    if (alreadyRecorded) continue;
    await recordSemanticChange(client, {
      scope_kind: "risk_metric",
      scope_id: key,
      change_type: "RISK_METRIC_CHANGED",
      before: {
        risk_view_id: input.previousRiskView.risk_view_id,
        generated_at: input.previousRiskView.generated_at,
        metric_key: key,
        metric_kind: previous?.metric_kind ?? next?.metric_kind,
        value: previous?.value ?? null,
        confidence: previous?.confidence ?? null
      },
      after: {
        risk_view_id: input.riskViewId,
        component_id: input.componentId,
        model_version: input.modelVersion,
        metric_key: key,
        metric_kind: next?.metric_kind ?? previous?.metric_kind,
        value: next?.value ?? null,
        confidence: next?.confidence ?? null,
        direction: evaluation.direction,
        severity: evaluation.severity,
        absolute_delta: evaluation.absolute_delta,
        relative_delta: evaluation.relative_delta,
        absolute_threshold: evaluation.absolute_threshold,
        relative_threshold: RISK_CHANGE_RELATIVE_THRESHOLD
      },
      caused_by: input.generatedBy
    });
    recorded += 1;
  }
  return recorded;
}

async function hasRiskMetricChangeForView(client: DbClient, input: { metricKey: string; riskViewId: string }): Promise<boolean> {
  const result = await client.query<ComponentRiskChangeRow>(
    `SELECT change_id
     FROM change_records
     WHERE scope_kind = 'risk_metric'
       AND scope_id = $1
       AND change_type = 'RISK_METRIC_CHANGED'
       AND after->>'risk_view_id' = $2
     LIMIT 1`,
    [input.metricKey, input.riskViewId]
  );
  return result.rows[0] !== undefined;
}

interface RiskMetricChangeEvaluation {
  direction: "increased" | "decreased" | "appeared" | "disappeared" | "changed";
  severity: "moderate" | "high" | "critical";
  absolute_delta: number | null;
  relative_delta: number | null;
  absolute_threshold: number | null;
}

type ComparableRiskMetric = Pick<RiskMetricRecord, "metric_kind" | "subject_kind" | "subject_id" | "component_id" | "value" | "confidence">;

function evaluateRiskMetricChange(previous: ComparableRiskMetric | undefined, next: ComparableRiskMetric | undefined): RiskMetricChangeEvaluation | undefined {
  if (previous === undefined && next === undefined) return undefined;
  if (previous === undefined) return next?.value === undefined ? undefined : lifecycleMetricChange("appeared");
  if (next === undefined) return previous.value === undefined ? undefined : lifecycleMetricChange("disappeared");

  const previousValue = parseFiniteNumber(previous.value);
  const nextValue = parseFiniteNumber(next.value);
  if (previousValue === undefined || nextValue === undefined) {
    if ((previous.value ?? null) === (next.value ?? null)) return undefined;
    return lifecycleMetricChange("changed");
  }

  const absoluteDelta = roundSix(nextValue - previousValue);
  const absoluteDeltaMagnitude = Math.abs(absoluteDelta);
  const relativeDelta = previousValue === 0 ? (nextValue === 0 ? 0 : 1) : absoluteDeltaMagnitude / Math.abs(previousValue);
  const absoluteThreshold = RISK_CHANGE_ABSOLUTE_THRESHOLDS[next.metric_kind] ?? null;
  const changedByAbsolute = absoluteThreshold !== null && absoluteDeltaMagnitude >= absoluteThreshold;
  const changedByRelative = relativeDelta >= RISK_CHANGE_RELATIVE_THRESHOLD;
  if (!changedByAbsolute && !changedByRelative) return undefined;
  return {
    direction: absoluteDelta > 0 ? "increased" : absoluteDelta < 0 ? "decreased" : "changed",
    severity: riskChangeSeverity({ absoluteDeltaMagnitude, relativeDelta, absoluteThreshold }),
    absolute_delta: absoluteDelta,
    relative_delta: roundSix(relativeDelta),
    absolute_threshold: absoluteThreshold
  };
}

function lifecycleMetricChange(direction: RiskMetricChangeEvaluation["direction"]): RiskMetricChangeEvaluation {
  return {
    direction,
    severity: direction === "appeared" || direction === "disappeared" ? "high" : "moderate",
    absolute_delta: null,
    relative_delta: null,
    absolute_threshold: null
  };
}

function riskChangeSeverity(input: {
  absoluteDeltaMagnitude: number;
  relativeDelta: number;
  absoluteThreshold: number | null;
}): RiskMetricChangeEvaluation["severity"] {
  const absoluteRatio = input.absoluteThreshold === null || input.absoluteThreshold === 0 ? 0 : input.absoluteDeltaMagnitude / input.absoluteThreshold;
  const relativeRatio = input.relativeDelta / RISK_CHANGE_RELATIVE_THRESHOLD;
  const ratio = Math.max(absoluteRatio, relativeRatio);
  if (ratio >= 3) return "critical";
  if (ratio >= 2) return "high";
  return "moderate";
}

function metricsByStableKey<T extends ComparableRiskMetric>(metrics: readonly T[]): Map<string, T> {
  const output = new Map<string, T>();
  for (const metric of metrics) {
    output.set(riskMetricStableKey(metric), metric);
  }
  return output;
}

function riskMetricStableKey(metric: ComparableRiskMetric): string {
  return [metric.metric_kind, metric.subject_kind, metric.subject_id, metric.component_id ?? ""].join(":");
}

function parseFiniteNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function roundSix(value: number): number {
  return Number(value.toFixed(6));
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
