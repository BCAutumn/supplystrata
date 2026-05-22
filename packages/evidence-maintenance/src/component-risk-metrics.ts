import { createHash } from "node:crypto";
import type { EdgeFreshnessRecord, EdgeStrengthEstimateRecord, EdgeStrengthKind, RiskMetricKind } from "@supplystrata/core";
import type { RiskMetricRecord } from "@supplystrata/db";
import { COMPONENT_RISK_MODEL_VERSION } from "./component-risk-definitions.js";
import type { ComponentRiskEdgeRow } from "./db-rows.js";
import {
  calculateBetweennessCentrality,
  calculateDirectedReachability,
  calculateTerminalPathRedundancy,
  calculateWeightedPathCentrality,
  calculateWeightedReachability,
  calculateWeightedTerminalPathRedundancy
} from "./component-risk-graph.js";

type StableJsonArray = readonly StableJsonValue[];
type StableJsonObject = { readonly [key: string]: StableJsonValue };
type StableJsonValue = null | string | number | boolean | StableJsonArray | StableJsonObject;

export function buildComponentRiskMetrics(input: {
  riskViewId: string;
  componentId: string;
  edges: readonly ComponentRiskEdgeRow[];
  strengthsByEdgeId: ReadonlyMap<string, EdgeStrengthEstimateRecord[]>;
  freshnessByEdgeId: ReadonlyMap<string, EdgeFreshnessRecord>;
}): Omit<RiskMetricRecord, "risk_view_id">[] {
  return [
    supplierConcentrationMetric(input),
    singleSourceExposureMetric(input),
    pathRedundancyMetric(input),
    ...nodeKnockoutReachMetrics(input),
    ...nodeKnockoutWeightedImpactMetrics(input),
    ...betweennessCentralityMetrics(input),
    ...input.edges.map((edge) => freshnessAdjustedExposureMetric(edge, input))
  ];
}

export function riskInputsFingerprint(input: {
  componentId: string;
  edges: readonly ComponentRiskEdgeRow[];
  strengths: readonly EdgeStrengthEstimateRecord[];
  freshness: readonly EdgeFreshnessRecord[];
}): string {
  return createHash("sha256")
    .update(
      stableJson({
        component_id: input.componentId,
        edges: input.edges.map((edge) => ({
          edge_id: edge.edge_id,
          relation: edge.relation,
          subject_id: edge.subject_id,
          object_id: edge.object_id,
          confidence: edge.confidence,
          primary_evidence_id: edge.primary_evidence_id
        })),
        strengths: input.strengths.map((strength) => ({
          edge_id: strength.edge_id,
          strength_kind: strength.strength_kind,
          value: strength.value ?? null,
          unit: strength.unit ?? null,
          method: strength.method,
          evidence_id: strength.evidence_id ?? null
        })),
        freshness: input.freshness.map((item) => ({
          edge_id: item.edge_id,
          freshness_score: item.freshness_score,
          age_days: item.age_days,
          source_evidence_id: item.source_evidence_id ?? null
        }))
      })
    )
    .digest("hex");
}

export function deterministicRiskViewId(componentId: string, fingerprint: string): string {
  return `RSK-COMP-${digestForId(`${componentId}:${fingerprint}`, 24)}`;
}

function supplierConcentrationMetric(input: {
  riskViewId: string;
  componentId: string;
  edges: readonly ComponentRiskEdgeRow[];
  strengthsByEdgeId: ReadonlyMap<string, EdgeStrengthEstimateRecord[]>;
  freshnessByEdgeId: ReadonlyMap<string, EdgeFreshnessRecord>;
}): Omit<RiskMetricRecord, "risk_view_id"> {
  const missingShareEdgeIds: string[] = [];
  const missingFreshnessEdgeIds: string[] = [];
  const sharesBySupplier = new Map<string, number>();
  const freshnessAdjustedSharesBySupplier = new Map<string, number>();
  const supplierShareInputs: Array<{
    supplier_id: string;
    edge_id: string;
    raw_share: number;
    freshness_score: number | null;
    freshness_adjusted_share: number | null;
  }> = [];
  for (const edge of input.edges) {
    const share = numericStrength(input.strengthsByEdgeId.get(edge.edge_id) ?? [], "share");
    if (share === undefined) {
      missingShareEdgeIds.push(edge.edge_id);
      continue;
    }
    const freshness = input.freshnessByEdgeId.get(edge.edge_id);
    if (freshness === undefined) {
      missingFreshnessEdgeIds.push(edge.edge_id);
    }
    const supplier = supplierForEdge(edge);
    const rawShare = share / 100;
    const freshnessAdjustedShare = freshness === undefined ? undefined : rawShare * freshness.freshness_score;
    sharesBySupplier.set(supplier.supplier_id, (sharesBySupplier.get(supplier.supplier_id) ?? 0) + rawShare);
    if (freshnessAdjustedShare !== undefined) {
      freshnessAdjustedSharesBySupplier.set(supplier.supplier_id, (freshnessAdjustedSharesBySupplier.get(supplier.supplier_id) ?? 0) + freshnessAdjustedShare);
    }
    supplierShareInputs.push({
      supplier_id: supplier.supplier_id,
      edge_id: edge.edge_id,
      raw_share: roundSix(rawShare),
      freshness_score: freshness?.freshness_score ?? null,
      freshness_adjusted_share: freshnessAdjustedShare === undefined ? null : roundSix(freshnessAdjustedShare)
    });
  }

  const rawHhi = missingShareEdgeIds.length === 0 && sharesBySupplier.size > 0 ? sum([...sharesBySupplier.values()].map((share) => share * share)) : undefined;
  const hhi =
    rawHhi !== undefined && missingFreshnessEdgeIds.length === 0
      ? sum([...freshnessAdjustedSharesBySupplier.values()].map((share) => share * share))
      : undefined;
  return {
    metric_id: deterministicRiskMetricId(input.riskViewId, "supplier_concentration_hhi", "component", input.componentId),
    metric_kind: "supplier_concentration_hhi",
    subject_kind: "component",
    subject_id: input.componentId,
    component_id: input.componentId,
    ...(hhi === undefined ? {} : { value: hhi.toFixed(6) }),
    confidence: hhi === undefined ? 0 : 0.8,
    provenance: { model_version: COMPONENT_RISK_MODEL_VERSION, input_edges: input.edges.map((edge) => edge.edge_id) },
    attrs: {
      share_unknown: missingShareEdgeIds.length > 0,
      freshness_missing: missingFreshnessEdgeIds.length > 0,
      missing_share_edge_ids: missingShareEdgeIds,
      missing_freshness_edge_ids: missingFreshnessEdgeIds,
      raw_hhi: rawHhi === undefined ? null : roundSix(rawHhi),
      freshness_adjustment: "share_weighted_by_edge_freshness_score",
      supplier_share_inputs: supplierShareInputs
    }
  };
}

function singleSourceExposureMetric(input: {
  riskViewId: string;
  componentId: string;
  edges: readonly ComponentRiskEdgeRow[];
  strengthsByEdgeId: ReadonlyMap<string, EdgeStrengthEstimateRecord[]>;
}): Omit<RiskMetricRecord, "risk_view_id"> {
  const supplierIds = uniqueSorted(input.edges.map((edge) => supplierForEdge(edge).supplier_id));
  const dependencyEdges = input.edges.filter((edge) => hasSingleSourceDependency(input.strengthsByEdgeId.get(edge.edge_id) ?? []));
  const exposed = supplierIds.length === 1 || dependencyEdges.length > 0;
  return {
    metric_id: deterministicRiskMetricId(input.riskViewId, "single_source_exposure", "component", input.componentId),
    metric_kind: "single_source_exposure",
    subject_kind: "component",
    subject_id: input.componentId,
    component_id: input.componentId,
    value: exposed ? "1" : "0",
    confidence: dependencyEdges.length > 0 ? 0.9 : supplierIds.length === 1 ? 0.65 : 0.7,
    provenance: {
      model_version: COMPONENT_RISK_MODEL_VERSION,
      supplier_ids: supplierIds,
      dependency_edge_ids: dependencyEdges.map((edge) => edge.edge_id)
    },
    attrs: { supplier_count: supplierIds.length }
  };
}

function pathRedundancyMetric(input: {
  riskViewId: string;
  componentId: string;
  edges: readonly ComponentRiskEdgeRow[];
  strengthsByEdgeId: ReadonlyMap<string, EdgeStrengthEstimateRecord[]>;
  freshnessByEdgeId: ReadonlyMap<string, EdgeFreshnessRecord>;
}): Omit<RiskMetricRecord, "risk_view_id"> {
  const suppliers = uniqueSuppliers(input.edges);
  const directAlternateSupplierCount = Math.max(0, suppliers.length - 1);
  const terminalScores = calculateTerminalPathRedundancy(componentRiskGraphEdges(input.edges));
  const multiHopAlternatePathCount = sum(terminalScores.map((score) => score.alternate_path_count));
  const weightedTerminalScores = calculateWeightedTerminalPathRedundancy(componentRiskWeightedGraphEdges(input));
  const weightedMissingEdgeIds = uniqueSorted(weightedTerminalScores.flatMap((score) => score.missing_weight_edge_ids));
  const knownWeightedAlternatePathScore = sum(weightedTerminalScores.map((score) => score.known_weighted_alternate_path_score ?? 0));
  const weightedAlternatePathScore =
    weightedMissingEdgeIds.length === 0 ? sum(weightedTerminalScores.map((score) => score.weighted_alternate_path_score ?? 0)) : null;
  return {
    metric_id: deterministicRiskMetricId(input.riskViewId, "path_redundancy", "component", input.componentId),
    metric_kind: "path_redundancy",
    subject_kind: "component",
    subject_id: input.componentId,
    component_id: input.componentId,
    value: multiHopAlternatePathCount.toString(),
    confidence: suppliers.length === 0 ? 0 : Math.min(0.85, average(input.edges.map((edge) => edge.confidence))),
    provenance: {
      model_version: COMPONENT_RISK_MODEL_VERSION,
      method: "component-risk.terminal-consumer-path-redundancy.v1",
      input_edges: input.edges.map((edge) => edge.edge_id),
      supplier_ids: suppliers.map((supplier) => supplier.supplier_id),
      terminal_entity_ids: terminalScores.map((score) => score.terminal_entity_id)
    },
    attrs: {
      direct_supplier_count: suppliers.length,
      direct_alternate_supplier_count: directAlternateSupplierCount,
      multi_hop_alternate_path_count: multiHopAlternatePathCount,
      terminal_path_redundancy: terminalScores,
      weighted_alternate_path_score: weightedAlternatePathScore === null ? null : roundSix(weightedAlternatePathScore),
      known_weighted_alternate_path_score: roundSix(knownWeightedAlternatePathScore),
      weighted_path_missing: weightedMissingEdgeIds.length > 0,
      weighted_missing_edge_ids: weightedMissingEdgeIds,
      weighted_terminal_path_redundancy: weightedTerminalScores,
      redundancy_scope: "terminal_consumer_simple_paths",
      weighted_redundancy_scope: "terminal_consumer_strength_freshness_simple_paths",
      limitation:
        "Counts alternate simple upstream paths from source suppliers to terminal consumers in the component-scoped Level 4/5 fact-edge graph; duplicate route edges are collapsed so repeated evidence does not become false redundancy. Weighted redundancy uses strength*freshness path products and stays null when any path weight is missing."
    }
  };
}

function nodeKnockoutReachMetrics(input: {
  riskViewId: string;
  componentId: string;
  edges: readonly ComponentRiskEdgeRow[];
}): Array<Omit<RiskMetricRecord, "risk_view_id">> {
  const graphEdges = componentRiskGraphEdges(input.edges);
  const reachabilityByEntityId = new Map(calculateDirectedReachability(graphEdges).map((score) => [score.entity_id, score]));
  const entityNamesById = entityNames(input.edges);
  const edgesByEntityId = groupEdgesByEntityId(input.edges);
  return uniqueSuppliers(input.edges).map((supplier) => {
    const reachability = reachabilityByEntityId.get(supplier.supplier_id);
    const affectedConsumerIds = reachability?.reachable_entity_ids ?? [];
    const affectedEdgeIds = reachability?.reachable_edge_ids ?? [];
    const incidentEdges = edgesByEntityId.get(supplier.supplier_id) ?? [];
    return {
      metric_id: deterministicRiskMetricId(input.riskViewId, "node_knockout_reach", "entity", supplier.supplier_id),
      metric_kind: "node_knockout_reach",
      subject_kind: "entity",
      subject_id: supplier.supplier_id,
      component_id: input.componentId,
      value: affectedConsumerIds.length.toString(),
      confidence: incidentEdges.length === 0 ? 0 : Math.min(0.85, average(incidentEdges.map((edge) => edge.confidence))),
      provenance: {
        model_version: COMPONENT_RISK_MODEL_VERSION,
        method: "component-risk.directed-reachability-knockout.v1",
        supplier_id: supplier.supplier_id,
        affected_edge_ids: affectedEdgeIds,
        affected_consumer_ids: affectedConsumerIds
      },
      attrs: {
        supplier_name: entityNamesById.get(supplier.supplier_id) ?? supplier.supplier_name,
        affected_consumer_count: affectedConsumerIds.length,
        affected_consumer_ids: affectedConsumerIds,
        affected_edge_ids: affectedEdgeIds,
        knockout_scope: "directed_component_fact_edge_reachability",
        limitation:
          "Counts downstream entities reachable in the current component-scoped Level 4/5 fact-edge graph; weighted propagation is emitted separately."
      }
    };
  });
}

function nodeKnockoutWeightedImpactMetrics(input: {
  riskViewId: string;
  componentId: string;
  edges: readonly ComponentRiskEdgeRow[];
  strengthsByEdgeId: ReadonlyMap<string, EdgeStrengthEstimateRecord[]>;
  freshnessByEdgeId: ReadonlyMap<string, EdgeFreshnessRecord>;
}): Array<Omit<RiskMetricRecord, "risk_view_id">> {
  const weightedGraphEdges = componentRiskWeightedGraphEdges(input);
  const weightedReachabilityByEntityId = new Map(calculateWeightedReachability(weightedGraphEdges).map((score) => [score.entity_id, score]));
  const unweightedReachabilityByEntityId = new Map(
    calculateDirectedReachability(componentRiskGraphEdges(input.edges)).map((score) => [score.entity_id, score])
  );
  const entityNamesById = entityNames(input.edges);
  const edgesByEntityId = groupEdgesByEntityId(input.edges);
  return uniqueSuppliers(input.edges).map((supplier) => {
    const weightedReachability = weightedReachabilityByEntityId.get(supplier.supplier_id);
    const unweightedReachability = unweightedReachabilityByEntityId.get(supplier.supplier_id);
    const incidentEdges = edgesByEntityId.get(supplier.supplier_id) ?? [];
    const weightedScore = weightedReachability?.weighted_score ?? 0;
    const hasWeightedPath = weightedScore > 0;
    return {
      metric_id: deterministicRiskMetricId(input.riskViewId, "node_knockout_weighted_impact", "entity", supplier.supplier_id),
      metric_kind: "node_knockout_weighted_impact",
      subject_kind: "entity",
      subject_id: supplier.supplier_id,
      component_id: input.componentId,
      ...(hasWeightedPath ? { value: weightedScore.toFixed(6) } : {}),
      confidence: hasWeightedPath ? Math.min(0.85, average(incidentEdges.map((edge) => edge.confidence))) : 0.3,
      provenance: {
        model_version: COMPONENT_RISK_MODEL_VERSION,
        method: "component-risk.weighted-node-knockout-propagation.v1",
        supplier_id: supplier.supplier_id,
        contributing_edge_ids: weightedReachability?.contributing_edge_ids ?? [],
        missing_weight_edge_ids: weightedReachability?.missing_weight_edge_ids ?? []
      },
      attrs: {
        supplier_name: entityNamesById.get(supplier.supplier_id) ?? supplier.supplier_name,
        weighted_impact_score: hasWeightedPath ? weightedScore : null,
        reachable_entity_count: unweightedReachability?.reachable_entity_ids.length ?? 0,
        weighted_reachable_entity_count: weightedReachability?.reachable_entity_ids.length ?? 0,
        weighted_entity_impacts: weightedReachability?.weighted_entity_impacts ?? [],
        contributing_edge_ids: weightedReachability?.contributing_edge_ids ?? [],
        missing_weight_edge_ids: weightedReachability?.missing_weight_edge_ids ?? [],
        weight_unknown: !hasWeightedPath,
        propagation_scope: "directed_component_fact_edge_strength_freshness",
        limitation:
          "Uses max-product paths over known strength*freshness edge weights; edges missing strength or freshness are listed and not imputed. Alternate-path redundancy is emitted as a separate path_redundancy metric."
      }
    };
  });
}

function betweennessCentralityMetrics(input: {
  riskViewId: string;
  componentId: string;
  edges: readonly ComponentRiskEdgeRow[];
  strengthsByEdgeId: ReadonlyMap<string, EdgeStrengthEstimateRecord[]>;
  freshnessByEdgeId: ReadonlyMap<string, EdgeFreshnessRecord>;
}): Array<Omit<RiskMetricRecord, "risk_view_id">> {
  const graphEdges = componentRiskGraphEdges(input.edges);
  const weightedCentralityByEntityId = new Map(
    calculateWeightedPathCentrality(componentRiskWeightedGraphEdges(input)).map((score) => [score.entity_id, score])
  );
  const entityNamesById = entityNames(input.edges);
  const edgesByEntityId = groupEdgesByEntityId(input.edges);
  return calculateBetweennessCentrality(graphEdges).map((score) => {
    const incidentEdges = edgesByEntityId.get(score.entity_id) ?? [];
    const weightedCentrality = weightedCentralityByEntityId.get(score.entity_id);
    return {
      metric_id: deterministicRiskMetricId(input.riskViewId, "betweenness_centrality", "entity", score.entity_id),
      metric_kind: "betweenness_centrality",
      subject_kind: "entity",
      subject_id: score.entity_id,
      component_id: input.componentId,
      value: score.normalized_score.toFixed(6),
      confidence: incidentEdges.length === 0 ? 0 : Math.min(0.85, average(incidentEdges.map((edge) => edge.confidence))),
      provenance: {
        model_version: COMPONENT_RISK_MODEL_VERSION,
        method: "component-risk.directed-betweenness-centrality.v1",
        graph_scope: "component_fact_edges",
        input_edges: input.edges.map((edge) => edge.edge_id)
      },
      attrs: {
        entity_name: entityNamesById.get(score.entity_id) ?? score.entity_id,
        raw_score: score.raw_score,
        normalized_score: score.normalized_score,
        weighted_path_centrality_raw_score: weightedCentrality?.raw_score ?? null,
        weighted_path_centrality_score: weightedCentrality?.normalized_score ?? null,
        weighted_path_count: weightedCentrality?.path_count ?? 0,
        weighted_contributing_path_edge_ids: weightedCentrality?.contributing_path_edge_ids ?? [],
        weighted_missing_weight_edge_ids: weightedCentrality?.missing_weight_edge_ids ?? [],
        centrality_scope: "directed_component_fact_edge_graph",
        weighted_centrality_scope: "terminal_consumer_strength_freshness_simple_paths",
        limitation:
          "Unweighted value uses directed shortest-path betweenness. Weighted attrs use strength*freshness simple paths from source suppliers to terminal consumers and stay explicit about missing weights."
      }
    };
  });
}

function componentRiskGraphEdges(edges: readonly ComponentRiskEdgeRow[]): Array<{ edge_id: string; from_entity_id: string; to_entity_id: string }> {
  return edges.map((edge) => {
    const supplier = supplierForEdge(edge);
    return {
      edge_id: edge.edge_id,
      from_entity_id: supplier.supplier_id,
      to_entity_id: supplier.consumer_id
    };
  });
}

function componentRiskWeightedGraphEdges(input: {
  edges: readonly ComponentRiskEdgeRow[];
  strengthsByEdgeId: ReadonlyMap<string, EdgeStrengthEstimateRecord[]>;
  freshnessByEdgeId: ReadonlyMap<string, EdgeFreshnessRecord>;
}): Array<{ edge_id: string; from_entity_id: string; to_entity_id: string; weight?: number }> {
  return input.edges.map((edge) => {
    const supplier = supplierForEdge(edge);
    const weight = edgePropagationWeight(edge, input);
    return {
      edge_id: edge.edge_id,
      from_entity_id: supplier.supplier_id,
      to_entity_id: supplier.consumer_id,
      ...(weight === undefined ? {} : { weight })
    };
  });
}

function freshnessAdjustedExposureMetric(
  edge: ComponentRiskEdgeRow,
  input: {
    riskViewId: string;
    componentId: string;
    strengthsByEdgeId: ReadonlyMap<string, EdgeStrengthEstimateRecord[]>;
    freshnessByEdgeId: ReadonlyMap<string, EdgeFreshnessRecord>;
  }
): Omit<RiskMetricRecord, "risk_view_id"> {
  const strengths = input.strengthsByEdgeId.get(edge.edge_id) ?? [];
  const freshness = input.freshnessByEdgeId.get(edge.edge_id);
  const strengthWeight = exposureStrengthWeight(strengths);
  const value = strengthWeight === undefined || freshness === undefined ? undefined : strengthWeight * freshness.freshness_score;
  return {
    metric_id: deterministicRiskMetricId(input.riskViewId, "freshness_adjusted_exposure", "edge", edge.edge_id),
    metric_kind: "freshness_adjusted_exposure",
    subject_kind: "edge",
    subject_id: edge.edge_id,
    component_id: input.componentId,
    ...(value === undefined ? {} : { value: value.toFixed(6) }),
    confidence: value === undefined ? 0.3 : Math.min(1, edge.confidence * (freshness?.freshness_score ?? 1)),
    provenance: {
      model_version: COMPONENT_RISK_MODEL_VERSION,
      edge_id: edge.edge_id,
      primary_evidence_id: edge.primary_evidence_id,
      strength_ids: strengths.map((strength) => strength.strength_id),
      freshness_score: freshness?.freshness_score
    },
    attrs: {
      strength_unknown: strengthWeight === undefined,
      freshness_missing: freshness === undefined,
      supplier_id: supplierForEdge(edge).supplier_id,
      consumer_id: supplierForEdge(edge).consumer_id
    }
  };
}

function edgePropagationWeight(
  edge: ComponentRiskEdgeRow,
  input: {
    strengthsByEdgeId: ReadonlyMap<string, EdgeStrengthEstimateRecord[]>;
    freshnessByEdgeId: ReadonlyMap<string, EdgeFreshnessRecord>;
  }
): number | undefined {
  const strengthWeight = exposureStrengthWeight(input.strengthsByEdgeId.get(edge.edge_id) ?? []);
  const freshness = input.freshnessByEdgeId.get(edge.edge_id);
  if (strengthWeight === undefined || freshness === undefined) return undefined;
  return Math.min(1, Math.max(0, strengthWeight * freshness.freshness_score));
}

function supplierForEdge(edge: ComponentRiskEdgeRow): {
  supplier_id: string;
  supplier_name: string;
  consumer_id: string;
  consumer_name: string;
} {
  if (edge.relation === "SUPPLIES_TO") {
    return {
      supplier_id: edge.subject_id,
      supplier_name: edge.subject_name,
      consumer_id: edge.object_id,
      consumer_name: edge.object_name
    };
  }
  return {
    supplier_id: edge.object_id,
    supplier_name: edge.object_name,
    consumer_id: edge.subject_id,
    consumer_name: edge.subject_name
  };
}

function uniqueSuppliers(edges: readonly ComponentRiskEdgeRow[]): Array<{ supplier_id: string; supplier_name: string }> {
  const bySupplierId = new Map<string, { supplier_id: string; supplier_name: string }>();
  for (const edge of edges) {
    const supplier = supplierForEdge(edge);
    bySupplierId.set(supplier.supplier_id, {
      supplier_id: supplier.supplier_id,
      supplier_name: supplier.supplier_name
    });
  }
  return [...bySupplierId.values()].sort((left, right) => left.supplier_id.localeCompare(right.supplier_id));
}

function numericStrength(strengths: readonly EdgeStrengthEstimateRecord[], kind: EdgeStrengthKind): number | undefined {
  for (const strength of strengths) {
    if (strength.strength_kind !== kind || strength.value === undefined) continue;
    const parsed = Number.parseFloat(strength.value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function exposureStrengthWeight(strengths: readonly EdgeStrengthEstimateRecord[]): number | undefined {
  const share = numericStrength(strengths, "share");
  if (share !== undefined) return Math.min(1, Math.max(0, share / 100));
  const dependency = numericStrength(strengths, "dependency");
  if (dependency !== undefined) return Math.min(1, Math.max(0, dependency));
  if (numericStrength(strengths, "capacity") !== undefined) return 1;
  if (numericStrength(strengths, "qualitative") !== undefined) return 0.75;
  return undefined;
}

function hasSingleSourceDependency(strengths: readonly EdgeStrengthEstimateRecord[]): boolean {
  return strengths.some((strength) => strength.strength_kind === "dependency" && strength.attrs["dependency_kind"] === "single_source");
}

function groupEdgesByEntityId(edges: readonly ComponentRiskEdgeRow[]): Map<string, ComponentRiskEdgeRow[]> {
  const output = new Map<string, ComponentRiskEdgeRow[]>();
  for (const edge of edges) {
    for (const entityId of [edge.subject_id, edge.object_id]) {
      const group = output.get(entityId) ?? [];
      group.push(edge);
      output.set(entityId, group);
    }
  }
  return output;
}

function entityNames(edges: readonly ComponentRiskEdgeRow[]): Map<string, string> {
  const output = new Map<string, string>();
  for (const edge of edges) {
    output.set(edge.subject_id, edge.subject_name);
    output.set(edge.object_id, edge.object_name);
  }
  return output;
}

function deterministicRiskMetricId(riskViewId: string, metricKind: RiskMetricKind, subjectKind: string, subjectId: string): string {
  return `RKM-${digestForId(`${riskViewId}:${metricKind}:${subjectKind}:${subjectId}`, 24)}`;
}

function digestForId(value: string, length: number): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length).toUpperCase();
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function roundSix(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function stableJson(value: StableJsonValue): string {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (isStableJsonArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key] ?? null)}`)
    .join(",")}}`;
}

function isStableJsonArray(value: StableJsonValue): value is StableJsonArray {
  return Array.isArray(value);
}
