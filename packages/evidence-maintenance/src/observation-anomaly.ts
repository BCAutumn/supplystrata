import type { ObservationType } from "@supplystrata/core";
import type { DbClient } from "@supplystrata/db/read";
import { recordSemanticChange, replaceRiskView, type DatabaseStore, type DbTxClient } from "@supplystrata/db/write";
import type { ExistingSemanticChangeRow, ObservationAnomalyHistoryRow, ObservationAnomalyRow } from "./db-rows.js";
import {
  deterministicRiskViewId,
  evaluateExplicitBaselineChange,
  evaluateTrailingMedianMadChange,
  observationAnomalyInputsFingerprint,
  observationAnomalyMetric,
  OBSERVATION_ANOMALY_MODEL_VERSION,
  type ObservationChangeEvaluation
} from "./observation-anomaly-evaluation.js";

export interface RefreshObservationAnomalyViewsInput {
  limit?: number;
  threshold_percent?: number;
  z_threshold?: number;
  history_periods?: number;
  min_history_points?: number;
  emit_semantic_changes?: boolean;
  computed_at: string;
  generated_by?: string;
}

export interface ObservationAnomalyRefreshSummary {
  scanned: number;
  evaluated: number;
  anomalies: number;
  risk_views_refreshed: number;
  threshold_percent: number;
  z_threshold: number;
  explicit_baseline_evaluated: number;
  time_series_evaluated: number;
  semantic_changes_recorded: number;
  generated_by: string;
  computed_at: string;
}

const DEFAULT_THRESHOLD_PERCENT = 25;
const DEFAULT_Z_THRESHOLD = 3.5;
const DEFAULT_HISTORY_PERIODS = 12;
const DEFAULT_MIN_HISTORY_POINTS = 5;

export async function refreshObservationAnomalyViews(
  client: DbTxClient,
  input: RefreshObservationAnomalyViewsInput
): Promise<ObservationAnomalyRefreshSummary> {
  const limit = input.limit ?? 1000;
  const thresholdPercent = input.threshold_percent ?? DEFAULT_THRESHOLD_PERCENT;
  const zThreshold = input.z_threshold ?? DEFAULT_Z_THRESHOLD;
  const historyPeriods = input.history_periods ?? DEFAULT_HISTORY_PERIODS;
  const minHistoryPoints = input.min_history_points ?? DEFAULT_MIN_HISTORY_POINTS;
  validateRefreshInput({ limit, thresholdPercent, zThreshold, historyPeriods, minHistoryPoints });

  const computedAt = input.computed_at;
  const generatedBy = input.generated_by ?? "evidence-maintenance.observation-anomaly.v1";
  const rows = await listAnomalyCandidateObservations(client, limit);
  const explicitEvaluations = new Map<string, ObservationChangeEvaluation>();
  const timeSeriesCandidates: ObservationAnomalyRow[] = [];
  for (const row of rows) {
    const explicit = evaluateExplicitBaselineChange(row, thresholdPercent);
    if (explicit === undefined) {
      timeSeriesCandidates.push(row);
    } else {
      explicitEvaluations.set(row.observation_id, explicit);
    }
  }
  const historyByCandidateId = await listComparableHistoryByCandidateId(client, timeSeriesCandidates, historyPeriods);
  let evaluated = 0;
  let anomalies = 0;
  let riskViewsRefreshed = 0;
  let explicitBaselineEvaluated = 0;
  let timeSeriesEvaluated = 0;
  let semanticChangesRecorded = 0;

  for (const row of rows) {
    const evaluation =
      explicitEvaluations.get(row.observation_id) ??
      evaluateTrailingMedianMadChange(row, historyByCandidateId.get(row.observation_id) ?? [], {
        thresholdPercent,
        zThreshold,
        minHistoryPoints
      });
    if (evaluation === undefined) continue;
    evaluated += 1;
    if (evaluation.is_anomaly) anomalies += 1;
    if (evaluation.baseline_method === "explicit_baseline") explicitBaselineEvaluated += 1;
    if (evaluation.baseline_method === "trailing_median_mad") timeSeriesEvaluated += 1;

    const fingerprint = observationAnomalyInputsFingerprint({
      row,
      evaluation,
      thresholdPercent,
      zThreshold,
      historyPeriods,
      minHistoryPoints
    });
    const riskViewId = deterministicRiskViewId(row.observation_id, fingerprint);
    await replaceRiskView(client, {
      risk_view_id: riskViewId,
      scope_kind: "observation",
      scope_id: row.observation_id,
      generated_at: computedAt,
      model_version: OBSERVATION_ANOMALY_MODEL_VERSION,
      inputs_fingerprint: fingerprint,
      summary: {
        observation_id: row.observation_id,
        observation_type: row.observation_type,
        metric_name: row.metric_name,
        is_anomaly: evaluation.is_anomaly,
        severity: evaluation.severity,
        direction: evaluation.direction,
        change_percent: evaluation.change_percent,
        threshold_percent: thresholdPercent,
        z_threshold: zThreshold,
        baseline_method: evaluation.baseline_method,
        z_like_score: evaluation.z_like_score ?? null,
        generated_by: generatedBy,
        experimental: true
      },
      attrs: { generated_by: generatedBy },
      metrics: [observationAnomalyMetric({ riskViewId, row, evaluation, thresholdPercent, zThreshold })]
    });
    riskViewsRefreshed += 1;
    if (input.emit_semantic_changes !== false && evaluation.is_anomaly) {
      const recorded = await recordObservationAnomalyChangeIfMissing(client, {
        row,
        evaluation,
        riskViewId,
        generatedBy
      });
      if (recorded) semanticChangesRecorded += 1;
    }
  }

  return {
    scanned: rows.length,
    evaluated,
    anomalies,
    risk_views_refreshed: riskViewsRefreshed,
    threshold_percent: thresholdPercent,
    z_threshold: zThreshold,
    explicit_baseline_evaluated: explicitBaselineEvaluated,
    time_series_evaluated: timeSeriesEvaluated,
    semantic_changes_recorded: semanticChangesRecorded,
    generated_by: generatedBy,
    computed_at: computedAt
  };
}

export async function refreshObservationAnomalyViewsTransactionally(
  store: DatabaseStore,
  input: RefreshObservationAnomalyViewsInput
): Promise<ObservationAnomalyRefreshSummary> {
  return store.transaction((client) => refreshObservationAnomalyViews(client, input));
}

function validateRefreshInput(input: { limit: number; thresholdPercent: number; zThreshold: number; historyPeriods: number; minHistoryPoints: number }): void {
  if (!Number.isInteger(input.limit) || input.limit <= 0) throw new Error(`Observation anomaly limit must be a positive integer: ${input.limit}`);
  if (!Number.isFinite(input.thresholdPercent) || input.thresholdPercent <= 0) {
    throw new Error(`Observation anomaly threshold_percent must be positive: ${input.thresholdPercent}`);
  }
  if (!Number.isFinite(input.zThreshold) || input.zThreshold <= 0) {
    throw new Error(`Observation anomaly z_threshold must be positive: ${input.zThreshold}`);
  }
  if (!Number.isInteger(input.historyPeriods) || input.historyPeriods <= 0) {
    throw new Error(`Observation anomaly history_periods must be a positive integer: ${input.historyPeriods}`);
  }
  if (!Number.isInteger(input.minHistoryPoints) || input.minHistoryPoints <= 0 || input.minHistoryPoints > input.historyPeriods) {
    throw new Error(`Observation anomaly min_history_points must be positive and no greater than history_periods: ${input.minHistoryPoints}`);
  }
}

async function listAnomalyCandidateObservations(client: DbClient, limit: number): Promise<ObservationAnomalyRow[]> {
  const result = await client.query<ObservationAnomalyRow>(
    `SELECT observation_id, observation_type, source_adapter_id, source_item_id, doc_id,
            scope_kind, scope_id, geography_kind, geography_id, component_id, metric_name,
            metric_value::text, metric_unit, time_window_start, time_window_end,
            baseline_value::text, change_value::text, change_percent, confidence,
            provenance, attrs, created_at
     FROM observations
     WHERE metric_value IS NOT NULL
     ORDER BY time_window_end DESC NULLS LAST, created_at DESC, observation_id
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

async function listComparableHistoryByCandidateId(
  client: DbClient,
  candidates: readonly ObservationAnomalyRow[],
  historyPeriods: number
): Promise<Map<string, ObservationAnomalyRow[]>> {
  const historyByCandidateId = new Map<string, ObservationAnomalyRow[]>();
  if (candidates.length === 0) return historyByCandidateId;

  const result = await client.query<ObservationAnomalyHistoryRow>(
    `WITH candidates AS (
       SELECT observation_id, observation_type, scope_kind, scope_id, metric_name,
              metric_unit, geography_kind, geography_id, component_id, anchor_at
       FROM jsonb_to_recordset($1::jsonb) AS candidate(
         observation_id text,
         observation_type text,
         scope_kind text,
         scope_id text,
         metric_name text,
         metric_unit text,
         geography_kind text,
         geography_id text,
         component_id text,
         anchor_at timestamptz
       )
     ),
     ranked_history AS (
       SELECT candidate.observation_id AS candidate_observation_id,
              h.observation_id, h.observation_type, h.source_adapter_id, h.source_item_id, h.doc_id,
              h.scope_kind, h.scope_id, h.geography_kind, h.geography_id, h.component_id, h.metric_name,
              h.metric_value::text, h.metric_unit, h.time_window_start, h.time_window_end,
              h.baseline_value::text, h.change_value::text, h.change_percent, h.confidence,
              h.provenance, h.attrs, h.created_at,
              row_number() OVER (
                PARTITION BY candidate.observation_id
                ORDER BY COALESCE(h.time_window_end, h.created_at) DESC, h.observation_id DESC
              ) AS history_rank
       FROM candidates candidate
       JOIN observations h ON h.observation_id <> candidate.observation_id
        AND h.observation_type = candidate.observation_type
        AND h.scope_kind = candidate.scope_kind
        AND h.scope_id = candidate.scope_id
        AND h.metric_name = candidate.metric_name
        AND h.metric_value IS NOT NULL
        AND h.metric_unit IS NOT DISTINCT FROM candidate.metric_unit
        AND h.geography_kind IS NOT DISTINCT FROM candidate.geography_kind
        AND h.geography_id IS NOT DISTINCT FROM candidate.geography_id
        AND h.component_id IS NOT DISTINCT FROM candidate.component_id
        AND COALESCE(h.time_window_end, h.created_at) < candidate.anchor_at
     )
     SELECT candidate_observation_id,
            observation_id, observation_type, source_adapter_id, source_item_id, doc_id,
            scope_kind, scope_id, geography_kind, geography_id, component_id, metric_name,
            metric_value, metric_unit, time_window_start, time_window_end,
            baseline_value, change_value, change_percent, confidence,
            provenance, attrs, created_at
     FROM ranked_history
     WHERE history_rank <= $2
     ORDER BY candidate_observation_id, history_rank`,
    [JSON.stringify(candidates.map(historyCandidatePayload)), historyPeriods]
  );
  for (const row of result.rows) {
    const group = historyByCandidateId.get(row.candidate_observation_id) ?? [];
    group.push(row);
    historyByCandidateId.set(row.candidate_observation_id, group);
  }
  return historyByCandidateId;
}

function historyCandidatePayload(row: ObservationAnomalyRow): {
  observation_id: string;
  observation_type: ObservationType;
  scope_kind: string;
  scope_id: string;
  metric_name: string;
  metric_unit: string | null;
  geography_kind: string | null;
  geography_id: string | null;
  component_id: string | null;
  anchor_at: string;
} {
  return {
    observation_id: row.observation_id,
    observation_type: row.observation_type,
    scope_kind: row.scope_kind,
    scope_id: row.scope_id,
    metric_name: row.metric_name,
    metric_unit: row.metric_unit,
    geography_kind: row.geography_kind,
    geography_id: row.geography_id,
    component_id: row.component_id,
    anchor_at: dateOrNull(row.time_window_end) ?? row.created_at.toISOString()
  };
}

async function recordObservationAnomalyChangeIfMissing(
  client: DbTxClient,
  input: {
    row: ObservationAnomalyRow;
    evaluation: ObservationChangeEvaluation;
    riskViewId: string;
    generatedBy: string;
  }
): Promise<boolean> {
  // 同一个 observation + risk view 的异常语义事件必须在事务内串行化，否则并发 refresh 会先后读到空结果并重复写 change record。
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`observation-anomaly:${input.row.observation_id}:${input.riskViewId}`]);
  const existing = await client.query<ExistingSemanticChangeRow>(
    `SELECT change_id
     FROM change_records
     WHERE scope_kind = 'observation'
       AND scope_id = $1
       AND change_type = 'OBSERVATION_ANOMALY'
       AND after->>'risk_view_id' = $2
     LIMIT 1`,
    [input.row.observation_id, input.riskViewId]
  );
  if (existing.rows[0] !== undefined) return false;

  await recordSemanticChange(client, {
    scope_kind: "observation",
    scope_id: input.row.observation_id,
    change_type: "OBSERVATION_ANOMALY",
    after: {
      risk_view_id: input.riskViewId,
      observation_type: input.row.observation_type,
      source_adapter_id: input.row.source_adapter_id,
      source_item_id: input.row.source_item_id,
      doc_id: input.row.doc_id,
      observation_scope_kind: input.row.scope_kind,
      observation_scope_id: input.row.scope_id,
      metric_name: input.row.metric_name,
      metric_value: input.row.metric_value,
      metric_unit: input.row.metric_unit,
      component_id: input.row.component_id,
      baseline_method: input.evaluation.baseline_method,
      baseline_value: input.evaluation.baseline_value,
      change_percent: input.evaluation.change_percent,
      z_like_score: input.evaluation.z_like_score ?? null,
      severity: input.evaluation.severity,
      direction: input.evaluation.direction,
      baseline_observation_ids: input.evaluation.baseline_observation_ids
    },
    caused_by: input.generatedBy
  });
  return true;
}

function dateOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}
