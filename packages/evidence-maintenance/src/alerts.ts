import { createHash } from "node:crypto";
import type { RiskMetricKind } from "@supplystrata/core";
import type { AlertSeverity, DbClient, UpsertAlertCandidateInput } from "@supplystrata/db";
import { upsertAlertCandidate } from "@supplystrata/db";
import type { ComponentRiskMetricAlertRow, ObservationAnomalyChangeRow, SourceFailureEventRow } from "./db-rows.js";

export interface ComponentRiskAlertPolicyInput {
  metric_kind: RiskMetricKind;
  value?: string | null;
  attrs?: Record<string, unknown>;
}

export type ComponentRiskAlertPolicyDecision =
  | {
      action: "trigger";
      severity: AlertSeverity;
      reason: "threshold_met";
      evaluated_label: string;
      evaluated_value: number;
      medium_threshold: number;
      high_threshold: number;
      value_source: ComponentRiskAlertValueSource;
      rule_version: string;
    }
  | {
      action: "skip";
      reason: "below_threshold" | "missing_value" | "unsupported_metric";
      evaluated_label: string;
      evaluated_value: number | null;
      medium_threshold: number | null;
      high_threshold: number | null;
      value_source: ComponentRiskAlertValueSource;
      rule_version: string;
    };

export interface ComponentRiskAlertPolicySample extends ComponentRiskAlertPolicyInput {
  sample_id: string;
  expected_action?: ComponentRiskAlertPolicyDecision["action"];
}

export interface ComponentRiskAlertPolicySummary {
  rule_version: string;
  sample_size: number;
  trigger_count: number;
  skip_count: number;
  matched_expected_count: number;
  mismatched_expected_count: number;
  by_metric_kind: Record<string, { samples: number; triggers: number; skips: number }>;
  decisions: Array<
    ComponentRiskAlertPolicyDecision & { sample_id: string; expected_action?: ComponentRiskAlertPolicyDecision["action"]; expected_matched?: boolean }
  >;
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
const COMPONENT_RISK_ALERT_RULE_VERSION = "alert-rules.component-risk.threshold-policy.v1";
const COMPONENT_RISK_ALERT_METRIC_KINDS: readonly RiskMetricKind[] = [
  "single_source_exposure",
  "supplier_concentration_hhi",
  "node_knockout_reach",
  "node_knockout_weighted_impact",
  "betweenness_centrality"
];
type ComponentRiskAlertValueSource = "metric_value" | "metric_attrs.weighted_path_centrality_score";

export function evaluateComponentRiskAlertPolicy(input: ComponentRiskAlertPolicyInput): ComponentRiskAlertPolicyDecision {
  const value = numericString(input.value ?? null);
  const attrs = input.attrs ?? {};
  return evaluateComponentRiskAlert(input.metric_kind, value, attrs);
}

export function summarizeComponentRiskAlertPolicy(samples: readonly ComponentRiskAlertPolicySample[]): ComponentRiskAlertPolicySummary {
  const decisions = samples.map((sample) => {
    const decision = evaluateComponentRiskAlertPolicy(sample);
    return {
      sample_id: sample.sample_id,
      ...decision,
      ...(sample.expected_action === undefined ? {} : { expected_action: sample.expected_action, expected_matched: sample.expected_action === decision.action })
    };
  });
  const byMetricKind = new Map<string, { samples: number; triggers: number; skips: number }>();
  for (const sample of samples) {
    const previous = byMetricKind.get(sample.metric_kind) ?? { samples: 0, triggers: 0, skips: 0 };
    const decision = evaluateComponentRiskAlertPolicy(sample);
    byMetricKind.set(sample.metric_kind, {
      samples: previous.samples + 1,
      triggers: previous.triggers + (decision.action === "trigger" ? 1 : 0),
      skips: previous.skips + (decision.action === "skip" ? 1 : 0)
    });
  }
  return {
    rule_version: COMPONENT_RISK_ALERT_RULE_VERSION,
    sample_size: samples.length,
    trigger_count: decisions.filter((decision) => decision.action === "trigger").length,
    skip_count: decisions.filter((decision) => decision.action === "skip").length,
    matched_expected_count: decisions.filter((decision) => decision.expected_matched === true).length,
    mismatched_expected_count: decisions.filter((decision) => decision.expected_matched === false).length,
    by_metric_kind: Object.fromEntries([...byMetricKind.entries()].sort(([left], [right]) => left.localeCompare(right))),
    decisions
  };
}

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
       AND rm.metric_kind = ANY($3::text[])
     ORDER BY rv.generated_at DESC, rm.metric_kind, rm.metric_id
     LIMIT $2`,
    [input.since, input.limit, COMPONENT_RISK_ALERT_METRIC_KINDS]
  );
  return result.rows.flatMap((row) => {
    const value = numericString(row.value);
    const evaluation = evaluateComponentRiskAlert(row.metric_kind, value, row.attrs);
    if (evaluation.action !== "trigger") return [];
    const dedupeKey = `component_risk:${row.metric_id}`;
    const draft: UpsertAlertCandidateInput = {
      alert_id: deterministicAlertId(dedupeKey),
      alert_kind: "component_risk",
      severity: evaluation.severity,
      scope_kind: "component",
      scope_id: row.component_id,
      title: `Component risk: ${row.metric_kind}`,
      summary: `Component ${row.component_id} has ${evaluation.evaluated_label}=${evaluation.evaluated_value} in ${row.risk_view_id}.`,
      dedupe_key: dedupeKey,
      risk_view_id: row.risk_view_id,
      risk_metric_id: row.metric_id,
      detected_at: row.generated_at.toISOString(),
      provenance: { rule: COMPONENT_RISK_ALERT_RULE_VERSION, generated_by: input.generatedBy, model_version: row.model_version },
      attrs: {
        metric_kind: row.metric_kind,
        subject_kind: row.subject_kind,
        subject_id: row.subject_id,
        value: row.value,
        confidence: row.confidence,
        metric_attrs: row.attrs,
        alert_policy: evaluation
      }
    };
    return [draft];
  });
}

function evaluateComponentRiskAlert(metricKind: RiskMetricKind, value: number | undefined, attrs: Record<string, unknown>): ComponentRiskAlertPolicyDecision {
  if (metricKind === "single_source_exposure") {
    return evaluateNumericComponentRiskMetric(metricKind, value, { medium: 1, high: 1, source: "metric_value" });
  }
  if (metricKind === "supplier_concentration_hhi") {
    return evaluateNumericComponentRiskMetric(metricKind, value, { medium: 0.25, high: 0.5, source: "metric_value" });
  }
  if (metricKind === "node_knockout_reach") {
    return evaluateNumericComponentRiskMetric(metricKind, value, { medium: 1, high: 3, source: "metric_value" });
  }
  if (metricKind === "node_knockout_weighted_impact") {
    return evaluateNumericComponentRiskMetric(metricKind, value, { medium: 0.25, high: 1, source: "metric_value" });
  }
  if (metricKind === "betweenness_centrality") {
    return evaluateNumericComponentRiskMetric(metricKind, numberField(attrs, "weighted_path_centrality_score"), {
      medium: 0.5,
      high: 0.8,
      source: "metric_attrs.weighted_path_centrality_score"
    });
  }
  return componentRiskAlertSkip(metricKind, null, {
    medium: null,
    high: null,
    source: "metric_value",
    reason: "unsupported_metric"
  });
}

function evaluateNumericComponentRiskMetric(
  metricKind: RiskMetricKind,
  value: number | undefined,
  thresholds: {
    medium: number;
    high: number;
    source: ComponentRiskAlertValueSource;
  }
): ComponentRiskAlertPolicyDecision {
  if (value === undefined) return componentRiskAlertSkip(metricKind, null, { ...thresholds, reason: "missing_value" });
  if (value < thresholds.medium) return componentRiskAlertSkip(metricKind, value, { ...thresholds, reason: "below_threshold" });
  return componentRiskAlertEvaluation(metricKind, value, thresholds);
}

function componentRiskAlertEvaluation(
  metricKind: RiskMetricKind,
  value: number,
  thresholds: {
    medium: number;
    high: number;
    source: ComponentRiskAlertValueSource;
  }
): ComponentRiskAlertPolicyDecision {
  return {
    action: "trigger",
    severity: value >= thresholds.high ? "high" : "medium",
    reason: "threshold_met",
    evaluated_label: thresholds.source === "metric_value" ? metricKind : `${metricKind}.weighted_path_centrality_score`,
    evaluated_value: value,
    medium_threshold: thresholds.medium,
    high_threshold: thresholds.high,
    value_source: thresholds.source,
    rule_version: COMPONENT_RISK_ALERT_RULE_VERSION
  };
}

function componentRiskAlertSkip(
  metricKind: RiskMetricKind,
  value: number | null,
  thresholds: {
    medium: number | null;
    high: number | null;
    source: ComponentRiskAlertValueSource;
    reason: "below_threshold" | "missing_value" | "unsupported_metric";
  }
): ComponentRiskAlertPolicyDecision {
  return {
    action: "skip",
    reason: thresholds.reason,
    evaluated_label: thresholds.source === "metric_value" ? metricKind : `${metricKind}.weighted_path_centrality_score`,
    evaluated_value: value,
    medium_threshold: thresholds.medium,
    high_threshold: thresholds.high,
    value_source: thresholds.source,
    rule_version: COMPONENT_RISK_ALERT_RULE_VERSION
  };
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
