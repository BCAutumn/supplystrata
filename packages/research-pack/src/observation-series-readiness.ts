import type { ObservationType } from "@supplystrata/core";
import type { ObservationCoverageObservation, ObservationSeriesReadiness, ObservationSeriesReadinessStatus } from "./observation-coverage.js";

export interface MutableSeriesSummary {
  series_key: string;
  observation_type: ObservationType;
  scope: string;
  component_id: string | null;
  geography: string | null;
  metric_name: string;
  metric_unit: string | null;
  source_adapters: Set<string>;
  observation_ids: Set<string>;
  numeric_points: Set<string>;
  windowed_points: Set<string>;
  explicit_baseline_points: Set<string>;
  anomaly_summaries: Set<string>;
  latest_time_window_end: string | null;
}

const DEFAULT_MIN_HISTORY_POINTS = 5;

export function registerSeriesObservation(seriesSummaries: Map<string, MutableSeriesSummary>, observation: ObservationCoverageObservation): void {
  const seriesKey = seriesKeyForObservation(observation);
  let summary = seriesSummaries.get(seriesKey);
  if (summary === undefined) {
    summary = {
      series_key: seriesKey,
      observation_type: observation.observation_type,
      scope: `${observation.scope_kind}:${observation.scope_id}`,
      component_id: observation.component_id,
      geography: observation.geography_kind === null || observation.geography_id === null ? null : `${observation.geography_kind}:${observation.geography_id}`,
      metric_name: observation.metric_name,
      metric_unit: observation.metric_unit,
      source_adapters: new Set<string>(),
      observation_ids: new Set<string>(),
      numeric_points: new Set<string>(),
      windowed_points: new Set<string>(),
      explicit_baseline_points: new Set<string>(),
      anomaly_summaries: new Set<string>(),
      latest_time_window_end: null
    };
    seriesSummaries.set(seriesKey, summary);
  }

  summary.source_adapters.add(observation.source_adapter_id);
  summary.observation_ids.add(observation.observation_id);
  if (parseFiniteNumber(observation.metric_value) !== null) summary.numeric_points.add(observation.observation_id);
  if (observation.time_window_end !== null) summary.windowed_points.add(observation.observation_id);
  if (observation.baseline_value !== null && observation.change_percent !== null) summary.explicit_baseline_points.add(observation.observation_id);
  if (observation.anomaly !== null) summary.anomaly_summaries.add(observation.observation_id);
  summary.latest_time_window_end = laterNullableDate(summary.latest_time_window_end, observation.time_window_end);
}

export function toSeriesReadiness(summary: MutableSeriesSummary): ObservationSeriesReadiness {
  const status = seriesReadinessStatus(summary);
  return {
    series_key: summary.series_key,
    observation_type: summary.observation_type,
    source_adapters: sortedValues(summary.source_adapters),
    scope: summary.scope,
    component_id: summary.component_id,
    geography: summary.geography,
    metric_name: summary.metric_name,
    metric_unit: summary.metric_unit,
    observations: summary.observation_ids.size,
    numeric_points: summary.numeric_points.size,
    windowed_points: summary.windowed_points.size,
    explicit_baseline_points: summary.explicit_baseline_points.size,
    anomaly_summaries: summary.anomaly_summaries.size,
    latest_time_window_end: summary.latest_time_window_end,
    sample_observation_ids: sortedValues(summary.observation_ids).slice(0, 5),
    status,
    reason: seriesReadinessReason(summary, status)
  };
}

export function compareSeriesReadiness(left: ObservationSeriesReadiness, right: ObservationSeriesReadiness): number {
  return (
    seriesStatusRank(left.status) - seriesStatusRank(right.status) || right.observations - left.observations || left.series_key.localeCompare(right.series_key)
  );
}

function seriesStatusRank(status: ObservationSeriesReadinessStatus): number {
  if (status === "time_series_ready") return 0;
  if (status === "explicit_baseline_ready") return 1;
  return 2;
}

function seriesReadinessStatus(summary: MutableSeriesSummary): ObservationSeriesReadinessStatus {
  if (summary.numeric_points.size >= DEFAULT_MIN_HISTORY_POINTS + 1 && summary.windowed_points.size >= DEFAULT_MIN_HISTORY_POINTS + 1) {
    return "time_series_ready";
  }
  if (summary.explicit_baseline_points.size > 0) return "explicit_baseline_ready";
  return "sparse";
}

function seriesReadinessReason(summary: MutableSeriesSummary, status: ObservationSeriesReadinessStatus): string {
  if (status === "time_series_ready") {
    return `Has at least ${DEFAULT_MIN_HISTORY_POINTS} comparable historical points plus a current numeric/windowed observation.`;
  }
  if (status === "explicit_baseline_ready") {
    return "Has explicit baseline/change fields, so deterministic anomaly evaluation can run without a long history window.";
  }
  return `Needs either explicit baseline/change fields or at least ${DEFAULT_MIN_HISTORY_POINTS + 1} numeric observations with time_window_end in the same series.`;
}

function seriesKeyForObservation(observation: ObservationCoverageObservation): string {
  const geography =
    observation.geography_kind === null || observation.geography_id === null ? "geo:none" : `${observation.geography_kind}:${observation.geography_id}`;
  const component = observation.component_id === null ? "component:none" : `component:${observation.component_id}`;
  const unit = observation.metric_unit === null ? "unit:none" : `unit:${observation.metric_unit}`;
  return [
    observation.observation_type,
    `${observation.scope_kind}:${observation.scope_id}`,
    geography,
    component,
    `metric:${observation.metric_name}`,
    unit
  ].join("|");
}

function parseFiniteNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function laterNullableDate(left: string | null, right: string | null): string | null {
  if (right === null) return left;
  if (left === null) return right;
  return right > left ? right : left;
}

function sortedValues(values: ReadonlySet<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}
