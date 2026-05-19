import type { DbClient } from "@supplystrata/db";
import type { CompanyExposureMetric, CompanyTopExposureNode, ComponentRiskMetric, ComponentRiskView } from "@supplystrata/render";
import { loadComponentRiskView } from "./risk-view.js";

export interface CompanyRiskEdgeInput {
  edge_id: string;
  component: string | null;
  component_id: string | null;
  counterparty_id: string;
  counterparty_name: string;
}

export async function loadCompanyTopExposureNodes(client: DbClient, upstreamEdges: readonly CompanyRiskEdgeInput[]): Promise<CompanyTopExposureNode[]> {
  const componentIds = [...new Set(upstreamEdges.flatMap((edge) => (edge.component_id === null ? [] : [edge.component_id])))].sort();
  const riskViewsByComponentId = new Map<string, ComponentRiskView>();
  for (const componentId of componentIds) {
    const riskView = await loadComponentRiskView(client, componentId);
    if (riskView !== null) riskViewsByComponentId.set(componentId, riskView);
  }

  const nodes: CompanyTopExposureNode[] = [];
  for (const edge of upstreamEdges) {
    if (edge.component_id === null) continue;
    const riskView = riskViewsByComponentId.get(edge.component_id);
    if (riskView === undefined) continue;
    const metrics = exposureMetricsForCompanyEdge(edge, riskView);
    if (metrics.length === 0) continue;
    nodes.push({
      node_id: edge.counterparty_id,
      node_name: edge.counterparty_name,
      direction: "upstream",
      component_id: edge.component_id,
      component: edge.component,
      risk_view_id: riskView.risk_view_id,
      model_version: riskView.model_version,
      generated_at: riskView.generated_at,
      metrics
    });
  }

  return nodes.sort(compareCompanyExposureNodes).slice(0, 10);
}

function exposureMetricsForCompanyEdge(edge: CompanyRiskEdgeInput, riskView: ComponentRiskView): CompanyExposureMetric[] {
  return riskView.metrics
    .filter((metric) => isRelevantCompanyExposureMetric(metric, edge))
    .map((metric) => ({
      metric_id: metric.metric_id,
      metric_kind: metric.metric_kind,
      subject_kind: metric.subject_kind,
      subject_id: metric.subject_id,
      value: metric.value,
      confidence: metric.confidence,
      provenance: metric.provenance,
      attrs: metric.attrs
    }))
    .sort(compareExposureMetrics);
}

function isRelevantCompanyExposureMetric(metric: ComponentRiskMetric, edge: CompanyRiskEdgeInput): boolean {
  if (metric.metric_kind === "node_knockout_reach") return metric.subject_kind === "entity" && metric.subject_id === edge.counterparty_id;
  if (metric.metric_kind === "node_knockout_weighted_impact") return metric.subject_kind === "entity" && metric.subject_id === edge.counterparty_id;
  if (metric.metric_kind === "betweenness_centrality") return metric.subject_kind === "entity" && metric.subject_id === edge.counterparty_id;
  if (metric.metric_kind === "freshness_adjusted_exposure") return metric.subject_kind === "edge" && metric.subject_id === edge.edge_id;
  return metric.subject_kind === "component" && metric.component_id === edge.component_id;
}

function compareCompanyExposureNodes(left: CompanyTopExposureNode, right: CompanyTopExposureNode): number {
  return (
    metricValue(right, "node_knockout_weighted_impact") - metricValue(left, "node_knockout_weighted_impact") ||
    metricValue(right, "node_knockout_reach") - metricValue(left, "node_knockout_reach") ||
    metricValue(right, "betweenness_centrality") - metricValue(left, "betweenness_centrality") ||
    metricValue(right, "single_source_exposure") - metricValue(left, "single_source_exposure") ||
    metricValue(left, "path_redundancy") - metricValue(right, "path_redundancy") ||
    metricValue(right, "freshness_adjusted_exposure") - metricValue(left, "freshness_adjusted_exposure") ||
    metricConfidence(right) - metricConfidence(left) ||
    left.node_name.localeCompare(right.node_name) ||
    left.component_id.localeCompare(right.component_id)
  );
}

function compareExposureMetrics(left: CompanyExposureMetric, right: CompanyExposureMetric): number {
  return exposureMetricRank(left.metric_kind) - exposureMetricRank(right.metric_kind) || left.metric_kind.localeCompare(right.metric_kind);
}

function exposureMetricRank(metricKind: CompanyExposureMetric["metric_kind"]): number {
  if (metricKind === "node_knockout_weighted_impact") return 0;
  if (metricKind === "node_knockout_reach") return 1;
  if (metricKind === "betweenness_centrality") return 2;
  if (metricKind === "single_source_exposure") return 3;
  if (metricKind === "path_redundancy") return 4;
  if (metricKind === "freshness_adjusted_exposure") return 5;
  if (metricKind === "supplier_concentration_hhi") return 6;
  return 7;
}

function metricValue(node: CompanyTopExposureNode, metricKind: CompanyExposureMetric["metric_kind"]): number {
  const metric = node.metrics.find((item) => item.metric_kind === metricKind);
  if (metric?.value === null || metric?.value === undefined) return 0;
  const parsed = Number.parseFloat(metric.value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metricConfidence(node: CompanyTopExposureNode): number {
  return node.metrics.reduce((highest, metric) => Math.max(highest, metric.confidence), 0);
}
