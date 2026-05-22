import { createHash } from "node:crypto";
import type { RiskMetricKind } from "@supplystrata/core";
import type { DbClient, DbTxClient, RiskMetricRecord } from "@supplystrata/db";
import { replaceRiskView } from "@supplystrata/db";
import type { FinancialMetricObservationRow } from "./db-rows.js";

interface PeerComparisonGroup {
  key: PeerComparisonKey;
  observations: readonly FinancialMetricObservationRow[];
}

interface PeerComparisonKey {
  metric_name: string;
  metric_unit: string | null;
  period_basis: "fiscal_period" | "time_window";
  fiscal_year: number | null;
  fiscal_period: string | null;
  time_window_start: string | null;
  time_window_end: string | null;
}

interface PeerScore {
  observation: FinancialMetricObservationRow;
  value: number;
  z_score: number;
  percentile: number;
  rank_descending: number;
}

export interface RefreshFinancialMetricPeerComparisonInput {
  limit?: number;
  min_peer_count?: number;
  computed_at?: string;
  generated_by?: string;
}

export interface FinancialMetricPeerComparisonSummary {
  scanned: number;
  groups_considered: number;
  groups_evaluated: number;
  metrics_written: number;
  min_peer_count: number;
  risk_views_refreshed: number;
  generated_by: string;
  computed_at: string;
}

const FINANCIAL_PEER_MODEL_VERSION = "financial-peer-comparison.v1";
const FINANCIAL_PEER_METRIC_KIND: RiskMetricKind = "financial_metric_peer_zscore";

export async function refreshFinancialMetricPeerComparisonViews(
  client: DbTxClient,
  input: RefreshFinancialMetricPeerComparisonInput = {}
): Promise<FinancialMetricPeerComparisonSummary> {
  const limit = input.limit ?? 1000;
  const minPeerCount = input.min_peer_count ?? 3;
  validateRefreshInput({ limit, minPeerCount });

  const computedAt = input.computed_at ?? new Date().toISOString();
  const generatedBy = input.generated_by ?? "evidence-maintenance.financial-peer-comparison.v1";
  const observations = await listFinancialMetricObservations(client, limit);
  const groups = groupComparableObservations(observations);
  let groupsEvaluated = 0;
  let metricsWritten = 0;
  let riskViewsRefreshed = 0;

  for (const group of groups) {
    if (group.observations.length < minPeerCount) continue;
    const scores = scorePeerGroup(group);
    if (scores.length < minPeerCount) continue;

    groupsEvaluated += 1;
    const fingerprint = peerGroupFingerprint({ group, minPeerCount });
    const riskViewId = deterministicRiskViewId(group.key, fingerprint);
    const metrics = scores.map((score) => peerScoreMetric({ riskViewId, score, group, generatedBy }));
    await replaceRiskView(client, {
      risk_view_id: riskViewId,
      scope_kind: "financial_metric_peer_group",
      scope_id: peerGroupScopeId(group.key),
      generated_at: computedAt,
      model_version: FINANCIAL_PEER_MODEL_VERSION,
      inputs_fingerprint: fingerprint,
      summary: {
        metric_name: group.key.metric_name,
        metric_unit: group.key.metric_unit,
        period_basis: group.key.period_basis,
        fiscal_year: group.key.fiscal_year,
        fiscal_period: group.key.fiscal_period,
        time_window_start: group.key.time_window_start,
        time_window_end: group.key.time_window_end,
        peer_count: scores.length,
        generated_by: generatedBy,
        experimental: true
      },
      attrs: {
        generated_by: generatedBy,
        comparison_scope: "company_financial_observations",
        limitation:
          "Company observations are compared by identical metric/unit and fiscal period when available; exact time window is used only when fiscal period is missing."
      },
      metrics
    });
    metricsWritten += metrics.length;
    riskViewsRefreshed += 1;
  }

  return {
    scanned: observations.length,
    groups_considered: groups.length,
    groups_evaluated: groupsEvaluated,
    metrics_written: metricsWritten,
    min_peer_count: minPeerCount,
    risk_views_refreshed: riskViewsRefreshed,
    generated_by: generatedBy,
    computed_at: computedAt
  };
}

function validateRefreshInput(input: { limit: number; minPeerCount: number }): void {
  if (!Number.isInteger(input.limit) || input.limit <= 0) throw new Error(`Financial peer comparison limit must be a positive integer: ${input.limit}`);
  if (!Number.isInteger(input.minPeerCount) || input.minPeerCount < 2) {
    throw new Error(`Financial peer comparison min_peer_count must be an integer >= 2: ${input.minPeerCount}`);
  }
}

async function listFinancialMetricObservations(client: DbClient, limit: number): Promise<FinancialMetricObservationRow[]> {
  const result = await client.query<FinancialMetricObservationRow>(
    `SELECT o.observation_id, o.source_adapter_id, o.source_item_id, o.doc_id,
            o.scope_kind, o.scope_id, em.display_name AS company_name, o.metric_name,
            o.metric_value::text, o.metric_unit, o.time_window_start, o.time_window_end,
            o.confidence, o.provenance, o.attrs, o.created_at
     FROM observations o
     LEFT JOIN entity_master em ON em.entity_id = o.scope_id
     WHERE o.observation_type = 'FINANCIAL_METRIC_OBSERVATION'
       AND o.scope_kind = 'company'
       AND o.metric_value IS NOT NULL
     ORDER BY o.time_window_end DESC NULLS LAST, o.created_at DESC, o.observation_id
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

function groupComparableObservations(observations: readonly FinancialMetricObservationRow[]): PeerComparisonGroup[] {
  const groups = new Map<string, FinancialMetricObservationRow[]>();
  const keys = new Map<string, PeerComparisonKey>();
  for (const observation of observations) {
    const key = peerComparisonKey(observation);
    const serialized = stableStringify(key);
    keys.set(serialized, key);
    const current = groups.get(serialized) ?? [];
    current.push(observation);
    groups.set(serialized, current);
  }
  return [...groups.entries()]
    .map(([serialized, rows]) => {
      const key = keys.get(serialized);
      if (key === undefined) throw new Error(`Missing financial peer comparison key for ${serialized}`);
      return { key, observations: latestObservationPerCompany(rows) };
    })
    .sort((left, right) => stableStringify(left.key).localeCompare(stableStringify(right.key)));
}

function latestObservationPerCompany(observations: readonly FinancialMetricObservationRow[]): FinancialMetricObservationRow[] {
  const byCompany = new Map<string, FinancialMetricObservationRow>();
  for (const observation of observations) {
    const current = byCompany.get(observation.scope_id);
    if (current === undefined || isNewerObservation(observation, current)) byCompany.set(observation.scope_id, observation);
  }
  return [...byCompany.values()].sort((left, right) => left.scope_id.localeCompare(right.scope_id));
}

function isNewerObservation(candidate: FinancialMetricObservationRow, current: FinancialMetricObservationRow): boolean {
  const createdDifference = candidate.created_at.getTime() - current.created_at.getTime();
  if (createdDifference !== 0) return createdDifference > 0;
  return candidate.observation_id.localeCompare(current.observation_id) > 0;
}

function peerComparisonKey(observation: FinancialMetricObservationRow): PeerComparisonKey {
  const fiscalYear = numberFromRecord(observation.provenance, "fiscal_year");
  const fiscalPeriod = stringFromRecord(observation.provenance, "fiscal_period");
  const hasFiscalPeriod = fiscalYear !== null && fiscalPeriod !== null;
  return {
    metric_name: observation.metric_name,
    metric_unit: observation.metric_unit,
    period_basis: hasFiscalPeriod ? "fiscal_period" : "time_window",
    fiscal_year: fiscalYear,
    fiscal_period: fiscalPeriod,
    time_window_start: hasFiscalPeriod ? null : dateOnly(observation.time_window_start),
    time_window_end: hasFiscalPeriod ? null : dateOnly(observation.time_window_end)
  };
}

function scorePeerGroup(group: PeerComparisonGroup): PeerScore[] {
  const numericObservations = group.observations
    .map((observation) => ({ observation, value: Number.parseFloat(observation.metric_value) }))
    .filter((item) => Number.isFinite(item.value))
    .sort((left, right) => left.observation.scope_id.localeCompare(right.observation.scope_id));
  const values = numericObservations.map((item) => item.value);
  const meanValue = mean(values);
  const stddevValue = populationStddev(values, meanValue);
  return numericObservations.map((item) => ({
    observation: item.observation,
    value: item.value,
    z_score: stddevValue === 0 ? 0 : (item.value - meanValue) / stddevValue,
    percentile: percentileForValue(values, item.value),
    rank_descending: 1 + values.filter((value) => value > item.value).length
  }));
}

function peerScoreMetric(input: {
  riskViewId: string;
  score: PeerScore;
  group: PeerComparisonGroup;
  generatedBy: string;
}): Omit<RiskMetricRecord, "risk_view_id"> {
  const values = input.group.observations.map((observation) => Number.parseFloat(observation.metric_value)).filter((value) => Number.isFinite(value));
  const meanValue = mean(values);
  const stddevValue = populationStddev(values, meanValue);
  return {
    metric_id: deterministicRiskMetricId(input.riskViewId, FINANCIAL_PEER_METRIC_KIND, "company", input.score.observation.scope_id),
    metric_kind: FINANCIAL_PEER_METRIC_KIND,
    subject_kind: "company",
    subject_id: input.score.observation.scope_id,
    value: input.score.z_score.toFixed(6),
    confidence: input.score.observation.confidence,
    provenance: {
      model_version: FINANCIAL_PEER_MODEL_VERSION,
      method: "financial-peer-comparison.same-period-population-zscore.v1",
      observation_id: input.score.observation.observation_id,
      doc_id: input.score.observation.doc_id,
      source_item_id: input.score.observation.source_item_id,
      generated_by: input.generatedBy
    },
    attrs: {
      company_name: input.score.observation.company_name,
      metric_name: input.group.key.metric_name,
      metric_value: input.score.value,
      metric_unit: input.group.key.metric_unit,
      period_basis: input.group.key.period_basis,
      fiscal_year: input.group.key.fiscal_year,
      fiscal_period: input.group.key.fiscal_period,
      time_window_start: input.group.key.time_window_start,
      time_window_end: input.group.key.time_window_end,
      observation_time_window_start: dateOnly(input.score.observation.time_window_start),
      observation_time_window_end: dateOnly(input.score.observation.time_window_end),
      peer_count: values.length,
      peer_company_ids: uniqueSorted(input.group.observations.map((observation) => observation.scope_id)),
      mean: roundMetric(meanValue),
      standard_deviation: roundMetric(stddevValue),
      z_score: roundMetric(input.score.z_score),
      percentile: roundMetric(input.score.percentile),
      rank_descending: input.score.rank_descending,
      zero_variance: stddevValue === 0,
      limitation: "This is a same-period peer position signal, not a risk score and not a supply relationship."
    }
  };
}

function peerGroupFingerprint(input: { group: PeerComparisonGroup; minPeerCount: number }): string {
  return sha256(
    stableStringify({
      model_version: FINANCIAL_PEER_MODEL_VERSION,
      min_peer_count: input.minPeerCount,
      key: input.group.key,
      observations: input.group.observations
        .map((observation) => ({
          observation_id: observation.observation_id,
          scope_id: observation.scope_id,
          metric_value: observation.metric_value,
          confidence: observation.confidence,
          doc_id: observation.doc_id,
          source_item_id: observation.source_item_id
        }))
        .sort((left, right) => left.observation_id.localeCompare(right.observation_id))
    })
  );
}

function deterministicRiskViewId(key: PeerComparisonKey, fingerprint: string): string {
  return `RSK-FIN-PEER-${sha256(`${peerGroupScopeId(key)}:${fingerprint}`)
    .slice(0, 24)
    .toUpperCase()}`;
}

function deterministicRiskMetricId(riskViewId: string, metricKind: RiskMetricKind, subjectKind: string, subjectId: string): string {
  return `RKM-${sha256(`${riskViewId}:${metricKind}:${subjectKind}:${subjectId}`).slice(0, 28).toUpperCase()}`;
}

function peerGroupScopeId(key: PeerComparisonKey): string {
  return `FIN-PEER-${sha256(stableStringify(key)).slice(0, 24).toUpperCase()}`;
}

function numberFromRecord(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringFromRecord(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function dateOnly(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function populationStddev(values: readonly number[], meanValue: number): number {
  if (values.length === 0) return 0;
  return Math.sqrt(values.reduce((total, value) => total + (value - meanValue) ** 2, 0) / values.length);
}

function percentileForValue(values: readonly number[], value: number): number {
  if (values.length <= 1) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const matchingIndexes = sorted.flatMap((sortedValue, index) => (sortedValue === value ? [index] : []));
  if (matchingIndexes.length === 0) return 0;
  const averageIndex = mean(matchingIndexes);
  return averageIndex / (sorted.length - 1);
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (!isRecord(value)) throw new Error("Stable stringify only supports JSON-like records.");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key] ?? null)}`)
    .join(",")}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
