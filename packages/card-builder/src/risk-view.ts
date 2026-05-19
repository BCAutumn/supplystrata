import { getLatestRiskViewByScope, listRiskMetricsForView, type DbClient, type RiskMetricRecord, type RiskViewRecord } from "@supplystrata/db";
import type { ComponentRiskMetric, ComponentRiskView } from "@supplystrata/render";

export async function loadComponentRiskView(client: DbClient, componentId: string): Promise<ComponentRiskView | null> {
  const view = await getLatestRiskViewByScope(client, { scope_kind: "component", scope_id: componentId });
  if (view === undefined) return null;
  const metrics = await listRiskMetricsForView(client, view.risk_view_id);
  return componentRiskViewFromRecord(view, metrics);
}

function componentRiskViewFromRecord(view: RiskViewRecord, metrics: readonly RiskMetricRecord[]): ComponentRiskView {
  return {
    risk_view_id: view.risk_view_id,
    generated_at: view.generated_at,
    model_version: view.model_version,
    inputs_fingerprint: view.inputs_fingerprint,
    summary: view.summary,
    attrs: view.attrs,
    metrics: metrics.map(componentRiskMetricFromRecord)
  };
}

function componentRiskMetricFromRecord(metric: RiskMetricRecord): ComponentRiskMetric {
  return {
    metric_id: metric.metric_id,
    metric_kind: metric.metric_kind,
    subject_kind: metric.subject_kind,
    subject_id: metric.subject_id,
    component_id: metric.component_id ?? null,
    value: metric.value ?? null,
    confidence: metric.confidence,
    provenance: metric.provenance,
    attrs: metric.attrs
  };
}
