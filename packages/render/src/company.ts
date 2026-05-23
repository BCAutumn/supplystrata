import type { ComponentSpecificity, EvidenceLevel, ObservationType, RelationType, RiskMetricKind } from "@supplystrata/core";
import type { OutputFormat } from "./types.js";
import type { UnknownMapItem } from "./unknown.js";

export interface EdgeStrengthSummary {
  strength_kind: string;
  value: string | null;
  unit: string | null;
  method: string;
  evidence_id: string | null;
}

export interface EdgeFreshnessSummary {
  last_verified_at: string;
  age_days: number;
  freshness_score: number;
  decay_model: string;
}

export interface EdgeIntelligenceSummary {
  strengths: EdgeStrengthSummary[];
  freshness: EdgeFreshnessSummary | null;
  unknowns: UnknownMapItem[];
}

export interface CompanyCardEntity {
  entity_id: string;
  canonical_name: string;
  display_name: string;
}

export interface CompanyCardEdge {
  edge_id: string;
  relation: RelationType;
  component: string | null;
  component_id: string | null;
  component_specificity: ComponentSpecificity | null;
  counterparty_id: string;
  counterparty_name: string;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  primary_evidence_id: string | null;
  cite_text: string | null;
  source_url: string | null;
  source_date: string | null;
  intelligence?: EdgeIntelligenceSummary;
}

export interface CompanyExposureMetric {
  metric_id: string;
  metric_kind: RiskMetricKind;
  subject_kind: string;
  subject_id: string;
  value: string | null;
  confidence: number;
  provenance: Record<string, unknown>;
  attrs: Record<string, unknown>;
}

export interface CompanyTopExposureNode {
  node_id: string;
  node_name: string;
  direction: "upstream" | "downstream";
  component_id: string;
  component: string | null;
  risk_view_id: string;
  model_version: string;
  generated_at: string;
  metrics: CompanyExposureMetric[];
}

export interface CompanyFinancialPeerMetric {
  risk_view_id: string;
  generated_at: string;
  model_version: string;
  inputs_fingerprint: string;
  metric_id: string;
  value: string | null;
  confidence: number;
  metric_name: string;
  metric_value: number | null;
  metric_unit: string | null;
  fiscal_year: number | null;
  fiscal_period: string | null;
  period_basis: string | null;
  peer_count: number | null;
  percentile: number | null;
  rank_descending: number | null;
  z_score: number | null;
  peer_company_ids: string[];
  provenance: Record<string, unknown>;
  attrs: Record<string, unknown>;
}

export interface ObservationAnomalySummary {
  risk_view_id: string;
  model_version: string;
  generated_at: string;
  metric_id: string;
  is_anomaly: boolean;
  severity: "none" | "moderate" | "high" | "critical";
  direction: "increase" | "decrease" | "flat";
  change_percent: number;
  threshold_percent: number;
  baseline_method?: string;
  baseline_value?: string;
  z_like_score?: number;
  z_threshold?: number;
  method: string;
}

export interface CompanyObservation {
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
  change_value: string | null;
  change_percent: number | null;
  confidence: number;
  provenance: Record<string, unknown>;
  attrs: Record<string, unknown>;
  anomaly: ObservationAnomalySummary | null;
  created_at: string;
}

export interface CompanyCardModel {
  entity: CompanyCardEntity;
  directly_disclosed_upstream: CompanyCardEdge[];
  directly_disclosed_downstream: CompanyCardEdge[];
  related_observations: CompanyObservation[];
  financial_peer_metrics: CompanyFinancialPeerMetric[];
  top_exposure_nodes: CompanyTopExposureNode[];
  unknown_map: UnknownMapItem[];
}

export function renderCompanyCard(card: CompanyCardModel, format: OutputFormat): string {
  if (format === "json") {
    return JSON.stringify(
      {
        schema_version: "1.0.0",
        entity: card.entity,
        directly_disclosed_upstream: card.directly_disclosed_upstream,
        directly_disclosed_downstream: card.directly_disclosed_downstream,
        related_observations: card.related_observations,
        financial_peer_metrics: card.financial_peer_metrics,
        top_exposure_nodes: card.top_exposure_nodes,
        unknown_map: card.unknown_map
      },
      null,
      2
    );
  }

  const lines = [`# ${card.entity.canonical_name} [${card.entity.entity_id}]`, "", "## Directly disclosed upstream (Level 4-5)", ""];
  if (card.directly_disclosed_upstream.length === 0) {
    lines.push("(no directly disclosed upstream edges yet)", "");
  }
  appendCompanyEdges(lines, card.directly_disclosed_upstream);
  lines.push("## Directly disclosed downstream customers (Level 4-5)", "");
  if (card.directly_disclosed_downstream.length === 0) {
    lines.push("(no directly disclosed downstream edges yet)", "");
  }
  appendCompanyEdges(lines, card.directly_disclosed_downstream);
  lines.push("## Related observations", "");
  appendCompanyObservations(lines, card.related_observations);
  lines.push("## Financial peer position", "");
  appendFinancialPeerMetrics(lines, card.financial_peer_metrics);
  lines.push("## Top exposure nodes", "");
  appendTopExposureNodes(lines, card.top_exposure_nodes);
  lines.push("## Unknown map", "");
  for (const item of card.unknown_map) {
    lines.push(`- ${item.question}`);
    lines.push(`  Scope: ${item.scope_kind}:${item.scope_id}`);
    lines.push(`  Why unknown: ${item.why_unknown}`);
  }
  return lines.join("\n");
}

function appendFinancialPeerMetrics(lines: string[], metrics: readonly CompanyFinancialPeerMetric[]): void {
  if (metrics.length === 0) {
    lines.push("(no financial peer comparison baseline available yet)", "");
    return;
  }
  for (const metric of metrics) {
    const period = financialPeerPeriod(metric);
    const unit = metric.metric_unit === null ? "" : ` ${metric.metric_unit}`;
    const metricValue = metric.metric_value === null ? "unknown" : `${formatMetricNumber(metric.metric_value)}${unit}`;
    const zScore = metric.z_score === null ? (metric.value ?? "unknown") : metric.z_score.toFixed(2);
    const percentile = metric.percentile === null ? "unknown" : `${(metric.percentile * 100).toFixed(1)}%`;
    const rank = metric.rank_descending === null || metric.peer_count === null ? "unknown" : `${metric.rank_descending}/${metric.peer_count}`;
    lines.push(`- ${metric.metric_name} (${period})`);
    lines.push(`  Value: ${metricValue}; peer z-score ${zScore}; percentile ${percentile}; rank ${rank}`);
    lines.push(`  Peer group: ${metric.peer_company_ids.join(", ") || "unknown"}; risk view ${metric.risk_view_id}`);
  }
  lines.push("");
}

function financialPeerPeriod(metric: CompanyFinancialPeerMetric): string {
  if (metric.fiscal_year !== null && metric.fiscal_period !== null) return `FY${metric.fiscal_year} ${metric.fiscal_period}`;
  return metric.period_basis ?? "unknown period";
}

function formatMetricNumber(value: number): string {
  return Math.abs(value) >= 1_000_000 ? value.toLocaleString("en-US", { maximumFractionDigits: 0 }) : value.toLocaleString("en-US");
}

function appendCompanyObservations(lines: string[], observations: readonly CompanyObservation[]): void {
  if (observations.length === 0) {
    lines.push("(no company-scoped observations recorded yet)", "");
    return;
  }
  for (const observation of observations) {
    lines.push(`- ${observation.observation_type}: ${observation.metric_name}`);
    lines.push(`  Scope: ${observation.scope_kind}:${observation.scope_id}; source: ${observation.source_adapter_id}`);
    lines.push(`  Value: ${observation.metric_value ?? "(n/a)"}${observation.metric_unit === null ? "" : ` ${observation.metric_unit}`}`);
    if (observation.baseline_value !== null && observation.change_percent !== null) {
      const changeValue = observation.change_value === null ? "" : `; delta ${observation.change_value}`;
      lines.push(`  Change: ${observation.change_percent.toFixed(2)}% vs baseline ${observation.baseline_value}${changeValue}`);
    }
    lines.push(`  Confidence: ${observation.confidence.toFixed(3)}`);
    appendObservationAnomaly(lines, observation.anomaly);
  }
  lines.push("");
}

export function appendObservationAnomaly(lines: string[], anomaly: ObservationAnomalySummary | null): void {
  if (anomaly === null) return;
  const label = anomaly.is_anomaly ? `${anomaly.severity} ${anomaly.direction}` : "within baseline";
  const zText = anomaly.z_like_score === undefined ? "" : `; z-like ${anomaly.z_like_score.toFixed(2)}`;
  lines.push(`  Anomaly: ${label}; change ${anomaly.change_percent.toFixed(2)}% vs baseline${zText}`);
}

function appendTopExposureNodes(lines: string[], nodes: readonly CompanyTopExposureNode[]): void {
  if (nodes.length === 0) {
    lines.push("(no component risk baseline available yet)", "");
    return;
  }
  for (const node of nodes) {
    const component = node.component === null ? node.component_id : `${node.component} [${node.component_id}]`;
    lines.push(`- ${node.node_name} [${node.node_id}] via ${component}`);
    lines.push(`  Risk view: ${node.risk_view_id}; model ${node.model_version}`);
    for (const metric of node.metrics) {
      lines.push(`  ${metric.metric_kind}: ${metric.value ?? "unknown"} (conf ${metric.confidence.toFixed(2)})`);
    }
  }
  lines.push("");
}

function appendCompanyEdges(lines: string[], edges: readonly CompanyCardEdge[]): void {
  for (const edge of edges) {
    const component = edge.component === null ? "" : ` (${edge.component})`;
    lines.push(`- ${edge.relation}${component} -> ${edge.counterparty_name} [Level ${edge.evidence_level}, conf ${edge.confidence.toFixed(3)}]`);
    if (edge.source_date !== null) lines.push(`  Source date: ${edge.source_date.slice(0, 10)}`);
    if (edge.cite_text !== null) lines.push(`  "${edge.cite_text}"`);
    if (edge.primary_evidence_id !== null) lines.push(`  Evidence: ${edge.primary_evidence_id}`);
    appendEdgeIntelligence(lines, edge.intelligence);
    lines.push("");
  }
}

export function appendEdgeIntelligence(lines: string[], intelligence: EdgeIntelligenceSummary | undefined): void {
  if (intelligence === undefined) return;
  const strengthText =
    intelligence.strengths.length === 0
      ? "no explicit strength estimate"
      : intelligence.strengths
          .map((strength) => {
            const value = strength.value === null ? "disclosed" : strength.value;
            const unit = strength.unit === null ? "" : ` ${strength.unit}`;
            return `${strength.strength_kind}=${value}${unit}`;
          })
          .join("; ");
  const freshnessText =
    intelligence.freshness === null
      ? "freshness not computed"
      : `freshness ${intelligence.freshness.freshness_score.toFixed(2)} (${intelligence.freshness.age_days} days old)`;
  lines.push(`  Intelligence: ${strengthText}; ${freshnessText}`);
  for (const unknown of intelligence.unknowns) {
    lines.push(`  Unknown: ${unknown.question}`);
  }
}
