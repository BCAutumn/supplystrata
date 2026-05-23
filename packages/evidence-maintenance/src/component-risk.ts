import type { EdgeStrengthEstimateRecord } from "@supplystrata/core";
import { getLatestRiskViewByScope, listEdgeFreshness, listEdgeStrengthEstimates, listRiskMetricsForView, type DbClient } from "@supplystrata/db/read";
import { replaceRiskView, type DatabaseStore, type DbTxClient } from "@supplystrata/db/write";
import { COMPONENT_RISK_MODEL_VERSION, type ComponentRiskRefreshSummary, type RefreshComponentRiskViewInput } from "./component-risk-definitions.js";
import { recordComponentRiskMetricChanges } from "./component-risk-changes.js";
import { buildComponentRiskMetrics, deterministicRiskViewId, riskInputsFingerprint } from "./component-risk-metrics.js";
import { listComponentRiskEdges, listRefreshableComponentRiskComponentIds } from "./component-risk-repository.js";

export type { ComponentRiskRefreshSummary, RefreshComponentRiskViewInput } from "./component-risk-definitions.js";
export { listRefreshableComponentRiskComponentIds } from "./component-risk-repository.js";

export async function refreshComponentRiskView(client: DbTxClient, input: RefreshComponentRiskViewInput): Promise<ComponentRiskRefreshSummary> {
  const computedAt = input.computed_at;
  const edges = await listComponentRiskEdges(client, input.component_id);
  const edgeIds = edges.map((edge) => edge.edge_id);
  const [strengths, freshness] = await Promise.all([listEdgeStrengthEstimates(client, edgeIds), listEdgeFreshness(client, { edgeIds, computedAt })]);
  const strengthsByEdgeId = groupByEdgeId(strengths);
  const freshnessByEdgeId = new Map(freshness.map((item) => [item.edge_id, item]));
  const supplierIds = uniqueSorted(edges.map((edge) => (edge.relation === "SUPPLIES_TO" ? edge.subject_id : edge.object_id)));
  const fingerprint = riskInputsFingerprint({ componentId: input.component_id, edges, strengths, freshness });
  const riskViewId = deterministicRiskViewId(input.component_id, fingerprint);
  const generatedBy = input.generated_by ?? "evidence-maintenance.component-risk.v1";
  const previousRiskView = await getLatestRiskViewByScope(client, { scope_kind: "component", scope_id: input.component_id });
  const previousMetrics =
    previousRiskView === undefined || previousRiskView.risk_view_id === riskViewId ? [] : await listRiskMetricsForView(client, previousRiskView.risk_view_id);
  const metrics = buildComponentRiskMetrics({
    riskViewId,
    componentId: input.component_id,
    edges,
    strengthsByEdgeId,
    freshnessByEdgeId
  });
  const shareUnknown = metrics.some((metric) => metric.metric_kind === "supplier_concentration_hhi" && metric.attrs["share_unknown"] === true);
  await replaceRiskView(client, {
    risk_view_id: riskViewId,
    scope_kind: "component",
    scope_id: input.component_id,
    generated_at: computedAt,
    model_version: COMPONENT_RISK_MODEL_VERSION,
    inputs_fingerprint: fingerprint,
    summary: {
      component_id: input.component_id,
      edge_count: edges.length,
      supplier_count: supplierIds.length,
      share_unknown: shareUnknown,
      stale_edge_count: freshness.filter((item) => item.freshness_score < 0.7).length,
      generated_by: generatedBy,
      experimental: true
    },
    attrs: { generated_by: generatedBy },
    metrics
  });
  const riskChangesRecorded = await recordComponentRiskMetricChanges(client, {
    componentId: input.component_id,
    previousRiskView,
    previousMetrics,
    riskViewId,
    metrics,
    generatedBy,
    modelVersion: COMPONENT_RISK_MODEL_VERSION
  });
  return {
    risk_view_id: riskViewId,
    component_id: input.component_id,
    metrics: metrics.length,
    edge_count: edges.length,
    supplier_count: supplierIds.length,
    share_unknown: shareUnknown,
    risk_changes_recorded: riskChangesRecorded,
    model_version: COMPONENT_RISK_MODEL_VERSION,
    inputs_fingerprint: fingerprint
  };
}

export async function refreshComponentRiskViewTransactionally(
  store: DatabaseStore,
  input: RefreshComponentRiskViewInput
): Promise<ComponentRiskRefreshSummary> {
  return store.transaction((client) => refreshComponentRiskView(client, input));
}

function groupByEdgeId<T extends EdgeStrengthEstimateRecord>(items: readonly T[]): Map<string, T[]> {
  const output = new Map<string, T[]>();
  for (const item of items) {
    const group = output.get(item.edge_id) ?? [];
    group.push(item);
    output.set(item.edge_id, group);
  }
  return output;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
