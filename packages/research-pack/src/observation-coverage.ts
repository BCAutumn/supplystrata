import { OBSERVATION_TYPES, type ObservationType } from "@supplystrata/core";

export type ObservationCoverageContextKind = "company_card" | "component_card" | "linked_company" | "chain_view_segment";

export interface ObservationCoverageObservation {
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
  time_window_start: string | null;
  time_window_end: string | null;
  baseline_value: string | null;
  change_percent: number | null;
  confidence: number;
  anomaly: {
    is_anomaly: boolean;
    method: string;
  } | null;
  created_at: string;
}

export interface ObservationCoverageCompanyInput {
  related_observations: readonly ObservationCoverageObservation[];
}

export interface ObservationCoverageComponentInput {
  component: {
    component_id: string;
    name: string;
  };
  related_observations: readonly ObservationCoverageObservation[];
  linked_company_observations: readonly {
    entity_id: string;
    entity_name: string;
    role: string;
    observations: readonly ObservationCoverageObservation[];
  }[];
}

export interface ObservationCoverageWorkbenchInput {
  chain_segments: readonly ObservationCoverageChainSegment[];
}

export interface ObservationCoverageChainSegment {
  semantic_layer: string;
  observation_id?: string;
  component_id: string | null;
}

export interface ObservationCoverageInput {
  generated_at: string;
  company_id: string;
  workbench: ObservationCoverageWorkbenchInput;
  company: ObservationCoverageCompanyInput | null;
  components: readonly ObservationCoverageComponentInput[];
}

export interface ObservationCoverageContext {
  kind: ObservationCoverageContextKind;
  scope_id: string;
  label: string;
}

export interface ObservationCoverageTypeSummary {
  observation_type: ObservationType;
  observations: number;
  scopes: string[];
  components: string[];
  geographies: string[];
  source_adapters: string[];
  metrics: string[];
  latest_time_window_end: string | null;
  latest_created_at: string | null;
  sample_observation_ids: string[];
  contexts: ObservationCoverageContext[];
}

export type ObservationSeriesReadinessStatus = "explicit_baseline_ready" | "time_series_ready" | "sparse";

export interface ObservationSeriesReadiness {
  series_key: string;
  observation_type: ObservationType;
  source_adapters: string[];
  scope: string;
  component_id: string | null;
  geography: string | null;
  metric_name: string;
  metric_unit: string | null;
  observations: number;
  numeric_points: number;
  windowed_points: number;
  explicit_baseline_points: number;
  anomaly_summaries: number;
  latest_time_window_end: string | null;
  sample_observation_ids: string[];
  status: ObservationSeriesReadinessStatus;
  reason: string;
}

export interface ObservationCoverageGap {
  observation_type: ObservationType;
  reason: string;
}

export interface ObservationCoverageSummary {
  total_observations: number;
  typed_observations: number;
  chain_observation_segments: number;
  chain_observation_segments_without_type: number;
  observation_types_present: number;
  methodology_types_total: number;
  methodology_types_present: number;
  methodology_types_missing: number;
  observation_series: number;
  time_series_ready: number;
  explicit_baseline_ready: number;
  sparse_series: number;
}

export interface ObservationCoverageReport {
  schema_version: "1.0.0";
  generated_at: string;
  company_id: string;
  summary: ObservationCoverageSummary;
  types: ObservationCoverageTypeSummary[];
  series: ObservationSeriesReadiness[];
  gaps: ObservationCoverageGap[];
}

interface MutableTypeSummary {
  observation_type: ObservationType;
  observation_ids: Set<string>;
  scopes: Set<string>;
  components: Set<string>;
  geographies: Set<string>;
  source_adapters: Set<string>;
  metrics: Set<string>;
  latest_time_window_end: string | null;
  latest_created_at: string | null;
  contexts: Map<string, ObservationCoverageContext>;
}

interface MutableSeriesSummary {
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

export function buildObservationCoverageReport(input: ObservationCoverageInput): ObservationCoverageReport {
  const summaries = new Map<ObservationType, MutableTypeSummary>();
  const seriesSummaries = new Map<string, MutableSeriesSummary>();
  const seenObservationIds = new Set<string>();
  const chainObservationSegments = input.workbench.chain_segments.filter((segment) => segment.semantic_layer === "observation");

  if (input.company !== null) {
    for (const observation of input.company.related_observations) {
      registerObservation(summaries, seriesSummaries, seenObservationIds, observation, {
        kind: "company_card",
        scope_id: input.company_id,
        label: `company:${input.company_id}`
      });
    }
  }

  for (const component of input.components) {
    for (const observation of component.related_observations) {
      registerObservation(summaries, seriesSummaries, seenObservationIds, observation, {
        kind: "component_card",
        scope_id: component.component.component_id,
        label: `${component.component.name} [${component.component.component_id}]`
      });
    }
    for (const linkedCompany of component.linked_company_observations) {
      for (const observation of linkedCompany.observations) {
        registerObservation(summaries, seriesSummaries, seenObservationIds, observation, {
          kind: "linked_company",
          scope_id: `${component.component.component_id}:${linkedCompany.entity_id}`,
          label: `${linkedCompany.entity_name} as ${linkedCompany.role} for ${component.component.name}`
        });
      }
    }
  }

  const types = [...summaries.values()].map(toTypeSummary).sort(compareTypeSummary);
  const series = [...seriesSummaries.values()].map(toSeriesReadiness).sort(compareSeriesReadiness);
  const presentTypes = new Set(types.map((item) => item.observation_type));
  const gaps = OBSERVATION_TYPES.filter((observationType) => !presentTypes.has(observationType)).map((observationType) => ({
    observation_type: observationType,
    reason: gapReason(observationType)
  }));

  return {
    schema_version: "1.0.0",
    generated_at: input.generated_at,
    company_id: input.company_id,
    summary: {
      total_observations: seenObservationIds.size + chainObservationSegments.length,
      typed_observations: seenObservationIds.size,
      chain_observation_segments: chainObservationSegments.length,
      // ChainView segment 只保存 context lane；正式 observation type 仍以 card/DB DTO 为准，避免靠 label 猜类型。
      chain_observation_segments_without_type: chainObservationSegments.length,
      observation_types_present: types.length,
      methodology_types_total: OBSERVATION_TYPES.length,
      methodology_types_present: types.length,
      methodology_types_missing: gaps.length,
      observation_series: series.length,
      time_series_ready: series.filter((item) => item.status === "time_series_ready").length,
      explicit_baseline_ready: series.filter((item) => item.status === "explicit_baseline_ready").length,
      sparse_series: series.filter((item) => item.status === "sparse").length
    },
    types,
    series,
    gaps
  };
}

export function renderObservationCoverageMarkdown(report: ObservationCoverageReport): string {
  const lines = [
    `# Observation Coverage ${report.company_id}`,
    "",
    `Generated at: ${report.generated_at}`,
    "",
    "## Summary",
    "",
    `- Typed observations: ${report.summary.typed_observations}`,
    `- Chain observation segments: ${report.summary.chain_observation_segments}`,
    `- Observation types present: ${report.summary.observation_types_present}/${report.summary.methodology_types_total}`,
    `- Observation series: ${report.summary.observation_series}`,
    `- Time-series ready: ${report.summary.time_series_ready}`,
    `- Explicit-baseline ready: ${report.summary.explicit_baseline_ready}`,
    `- Sparse series: ${report.summary.sparse_series}`,
    `- Methodology gaps: ${report.summary.methodology_types_missing}`,
    "",
    "## Present observation types",
    ""
  ];

  if (report.types.length === 0) {
    lines.push("(no typed observations are present in this research pack)", "");
  } else {
    for (const item of report.types) {
      lines.push(`- ${item.observation_type}: ${item.observations}`);
      lines.push(`  Sources: ${formatList(item.source_adapters)}`);
      lines.push(`  Scopes: ${formatList(item.scopes)}`);
      lines.push(`  Components: ${formatList(item.components)}`);
      lines.push(`  Geographies: ${formatList(item.geographies)}`);
      lines.push(`  Metrics: ${formatList(item.metrics)}`);
      lines.push(`  Latest window end: ${item.latest_time_window_end ?? "(none)"}`);
      lines.push(`  Samples: ${formatList(item.sample_observation_ids)}`);
    }
    lines.push("");
  }

  lines.push("## Series readiness", "");
  if (report.series.length === 0) {
    lines.push("(no observation series can be evaluated yet)", "");
  } else {
    for (const item of report.series) {
      lines.push(`- ${item.series_key}: ${item.status}`);
      lines.push(
        `  Points: ${item.observations}; numeric ${item.numeric_points}; windowed ${item.windowed_points}; explicit baseline ${item.explicit_baseline_points}; anomaly summaries ${item.anomaly_summaries}`
      );
      lines.push(`  Latest window end: ${item.latest_time_window_end ?? "(none)"}`);
      lines.push(`  Reason: ${item.reason}`);
      lines.push(`  Samples: ${formatList(item.sample_observation_ids)}`);
    }
    lines.push("");
  }

  lines.push("## Missing methodology types", "");
  for (const gap of report.gaps) {
    lines.push(`- ${gap.observation_type}: ${gap.reason}`);
  }
  return lines.join("\n");
}

function registerObservation(
  summaries: Map<ObservationType, MutableTypeSummary>,
  seriesSummaries: Map<string, MutableSeriesSummary>,
  seenObservationIds: Set<string>,
  observation: ObservationCoverageObservation,
  context: ObservationCoverageContext
): void {
  let summary = summaries.get(observation.observation_type);
  if (summary === undefined) {
    summary = {
      observation_type: observation.observation_type,
      observation_ids: new Set<string>(),
      scopes: new Set<string>(),
      components: new Set<string>(),
      geographies: new Set<string>(),
      source_adapters: new Set<string>(),
      metrics: new Set<string>(),
      latest_time_window_end: null,
      latest_created_at: null,
      contexts: new Map<string, ObservationCoverageContext>()
    };
    summaries.set(observation.observation_type, summary);
  }

  summary.observation_ids.add(observation.observation_id);
  seenObservationIds.add(observation.observation_id);
  summary.scopes.add(`${observation.scope_kind}:${observation.scope_id}`);
  if (observation.component_id !== null) summary.components.add(observation.component_id);
  if (observation.geography_kind !== null && observation.geography_id !== null) {
    summary.geographies.add(`${observation.geography_kind}:${observation.geography_id}`);
  }
  summary.source_adapters.add(observation.source_adapter_id);
  summary.metrics.add(observation.metric_unit === null ? observation.metric_name : `${observation.metric_name} (${observation.metric_unit})`);
  summary.latest_time_window_end = laterNullableDate(summary.latest_time_window_end, observation.time_window_end);
  summary.latest_created_at = laterNullableDate(summary.latest_created_at, observation.created_at);
  summary.contexts.set(`${context.kind}:${context.scope_id}`, context);

  registerSeriesObservation(seriesSummaries, observation);
}

function toTypeSummary(summary: MutableTypeSummary): ObservationCoverageTypeSummary {
  return {
    observation_type: summary.observation_type,
    observations: summary.observation_ids.size,
    scopes: sortedValues(summary.scopes),
    components: sortedValues(summary.components),
    geographies: sortedValues(summary.geographies),
    source_adapters: sortedValues(summary.source_adapters),
    metrics: sortedValues(summary.metrics),
    latest_time_window_end: summary.latest_time_window_end,
    latest_created_at: summary.latest_created_at,
    sample_observation_ids: sortedValues(summary.observation_ids).slice(0, 5),
    contexts: [...summary.contexts.values()].sort(
      (left, right) => left.kind.localeCompare(right.kind) || left.label.localeCompare(right.label) || left.scope_id.localeCompare(right.scope_id)
    )
  };
}

function compareTypeSummary(left: ObservationCoverageTypeSummary, right: ObservationCoverageTypeSummary): number {
  return right.observations - left.observations || left.observation_type.localeCompare(right.observation_type);
}

function registerSeriesObservation(seriesSummaries: Map<string, MutableSeriesSummary>, observation: ObservationCoverageObservation): void {
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

function toSeriesReadiness(summary: MutableSeriesSummary): ObservationSeriesReadiness {
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

function compareSeriesReadiness(left: ObservationSeriesReadiness, right: ObservationSeriesReadiness): number {
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

function formatList(values: readonly string[]): string {
  return values.length === 0 ? "(none)" : values.join(", ");
}

function gapReason(observationType: ObservationType): string {
  switch (observationType) {
    case "FINANCIAL_METRIC_OBSERVATION":
      return "No company-scoped financial metric observation is present in this pack.";
    case "TRADE_FLOW_OBSERVATION":
      return "No trade-flow observation is linked to the selected company/components yet.";
    case "PORT_ACTIVITY_OBSERVATION":
      return "Port activity source is still planned; keep it isolated as observation when added.";
    case "ROUTE_OBSERVATION":
      return "Route/AIS context is still planned and must not become a company fact edge by itself.";
    case "ENERGY_PRICE_OBSERVATION":
      return "Energy price source has not produced a typed observation for this pack.";
    case "COMMODITY_PRICE_OBSERVATION":
      return "No commodity price observation is linked to selected component/material context yet.";
    case "MINERAL_SUPPLY_OBSERVATION":
      return "Critical-mineral source is still planned for a later connector.";
    case "CAPEX_OBSERVATION":
      return "No official disclosure capex semantic observation is present in this pack.";
    case "INVENTORY_OBSERVATION":
      return "No inventory semantic or financial metric observation is present in this pack.";
    case "BACKLOG_OBSERVATION":
      return "No backlog semantic observation is present in this pack.";
    case "CUSTOMER_CONCENTRATION_OBSERVATION":
      return "No customer concentration observation is present; anonymous concentration must remain observation/unknown.";
    case "POLICY_OBSERVATION":
      return "Policy/sanctions observation source is still planned.";
    case "PROCUREMENT_OBSERVATION":
      return "No procurement commitment observation is present in this pack.";
    case "FACILITY_PROFILE_OBSERVATION":
      return "No facility profile observation is linked to selected company/components yet.";
  }
}
