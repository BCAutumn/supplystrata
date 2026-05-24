import type { EdgeFreshnessRecord, EdgeStrengthEstimateRecord } from "@supplystrata/core";
import type { RiskMetricRecord } from "@supplystrata/db/read";
import type { ComponentRiskEdgeRow } from "./db-rows.js";
import {
  betweennessCentralityMetrics,
  freshnessAdjustedExposureMetric,
  nodeKnockoutReachMetrics,
  nodeKnockoutWeightedImpactMetrics,
  pathRedundancyMetric,
  singleSourceExposureMetric,
  supplierConcentrationMetric
} from "./component-risk-metric-builders.js";
import type { ComponentRiskMetricInput } from "./component-risk-metric-context.js";
export { deterministicRiskViewId, riskInputsFingerprint } from "./component-risk-identifiers.js";

export function buildComponentRiskMetrics(input: {
  riskViewId: string;
  componentId: string;
  edges: readonly ComponentRiskEdgeRow[];
  strengthsByEdgeId: ReadonlyMap<string, EdgeStrengthEstimateRecord[]>;
  freshnessByEdgeId: ReadonlyMap<string, EdgeFreshnessRecord>;
}): Omit<RiskMetricRecord, "risk_view_id">[] {
  const metricInput: ComponentRiskMetricInput = input;
  return [
    supplierConcentrationMetric(metricInput),
    singleSourceExposureMetric(metricInput),
    pathRedundancyMetric(metricInput),
    ...nodeKnockoutReachMetrics(metricInput),
    ...nodeKnockoutWeightedImpactMetrics(metricInput),
    ...betweennessCentralityMetrics(metricInput),
    ...metricInput.edges.map((edge) => freshnessAdjustedExposureMetric(edge, metricInput))
  ];
}
