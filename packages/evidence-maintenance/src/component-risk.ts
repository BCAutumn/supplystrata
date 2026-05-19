import type pg from "pg";
import { createHash } from "node:crypto";
import type { EdgeFreshnessRecord, EdgeStrengthEstimateRecord, EdgeStrengthKind, EvidenceLevel, RelationType, RiskMetricKind } from "@supplystrata/core";
import type { DbClient } from "@supplystrata/db";
import {
  getLatestRiskViewByScope,
  listEdgeFreshness,
  listEdgeStrengthEstimates,
  listRiskMetricsForView,
  replaceRiskView,
  type RiskMetricRecord
} from "@supplystrata/db";
import { recordComponentRiskMetricChanges } from "./component-risk-changes.js";
import { calculateBetweennessCentrality, calculateDirectedReachability, calculateWeightedReachability } from "./component-risk-graph.js";

interface ComponentRiskEdgeRow extends pg.QueryResultRow {
  edge_id: string;
  relation: RelationType;
  subject_id: string;
  subject_name: string;
  object_id: string;
  object_name: string;
  component_id: string;
  evidence_level: EvidenceLevel;
  confidence: number;
  primary_evidence_id: string | null;
}

export interface RefreshComponentRiskViewInput {
  component_id: string;
  computed_at?: string;
  generated_by?: string;
}

export interface ComponentRiskRefreshSummary {
  risk_view_id: string;
  component_id: string;
  metrics: number;
  edge_count: number;
  supplier_count: number;
  share_unknown: boolean;
  risk_changes_recorded: number;
  model_version: string;
  inputs_fingerprint: string;
}

interface ComponentRiskComponentRow extends pg.QueryResultRow {
  component_id: string;
}

const COMPONENT_RISK_MODEL_VERSION = "component-risk-baseline.v1";

type StableJsonArray = readonly StableJsonValue[];
type StableJsonObject = { readonly [key: string]: StableJsonValue };
type StableJsonValue = null | string | number | boolean | StableJsonArray | StableJsonObject;

export async function listRefreshableComponentRiskComponentIds(client: DbClient, componentIds: readonly string[]): Promise<string[]> {
  const normalizedComponentIds = uniqueSorted(componentIds.map((componentId) => componentId.trim()).filter((componentId) => componentId.length > 0));
  if (normalizedComponentIds.length === 0) return [];
  const result = await client.query<ComponentRiskComponentRow>(
    `SELECT DISTINCT e.component_id
     FROM edges e
     WHERE e.validity = 'current'
       AND e.evidence_level >= 4
       AND e.is_inferred = false
       AND e.component_id = ANY($1::text[])
       AND e.relation IN ('BUYS_FROM','SUPPLIES_TO','USES_FOUNDRY','MANUFACTURES_AT')
     ORDER BY e.component_id`,
    [normalizedComponentIds]
  );
  return result.rows.map((row) => row.component_id);
}

export async function refreshComponentRiskView(client: DbClient, input: RefreshComponentRiskViewInput): Promise<ComponentRiskRefreshSummary> {
  const computedAt = input.computed_at ?? new Date().toISOString();
  const edges = await listComponentRiskEdges(client, input.component_id);
  const edgeIds = edges.map((edge) => edge.edge_id);
  const [strengths, freshness] = await Promise.all([listEdgeStrengthEstimates(client, edgeIds), listEdgeFreshness(client, { edgeIds, computedAt })]);
  const strengthsByEdgeId = groupByEdgeId(strengths);
  const freshnessByEdgeId = new Map(freshness.map((item) => [item.edge_id, item]));
  const supplierIds = uniqueSorted(edges.map((edge) => supplierForEdge(edge).supplier_id));
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

function buildComponentRiskMetrics(input: {
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

function supplierConcentrationMetric(input: {
  riskViewId: string;
  componentId: string;
  edges: readonly ComponentRiskEdgeRow[];
  strengthsByEdgeId: ReadonlyMap<string, EdgeStrengthEstimateRecord[]>;
}): Omit<RiskMetricRecord, "risk_view_id"> {
  const missingShareEdgeIds: string[] = [];
  const sharesBySupplier = new Map<string, number>();
  for (const edge of input.edges) {
    const share = numericStrength(input.strengthsByEdgeId.get(edge.edge_id) ?? [], "share");
    if (share === undefined) {
      missingShareEdgeIds.push(edge.edge_id);
      continue;
    }
    const supplier = supplierForEdge(edge);
    sharesBySupplier.set(supplier.supplier_id, (sharesBySupplier.get(supplier.supplier_id) ?? 0) + share / 100);
  }

  const hhi = missingShareEdgeIds.length === 0 && sharesBySupplier.size > 0 ? sum([...sharesBySupplier.values()].map((share) => share * share)) : undefined;
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
      missing_share_edge_ids: missingShareEdgeIds
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
}): Omit<RiskMetricRecord, "risk_view_id"> {
  const suppliers = uniqueSuppliers(input.edges);
  const alternateSupplierCount = Math.max(0, suppliers.length - 1);
  return {
    metric_id: deterministicRiskMetricId(input.riskViewId, "path_redundancy", "component", input.componentId),
    metric_kind: "path_redundancy",
    subject_kind: "component",
    subject_id: input.componentId,
    component_id: input.componentId,
    value: alternateSupplierCount.toString(),
    confidence: suppliers.length === 0 ? 0 : Math.min(0.85, average(input.edges.map((edge) => edge.confidence))),
    provenance: {
      model_version: COMPONENT_RISK_MODEL_VERSION,
      method: "component-risk.direct-alternate-supplier-count.v1",
      input_edges: input.edges.map((edge) => edge.edge_id),
      supplier_ids: suppliers.map((supplier) => supplier.supplier_id)
    },
    attrs: {
      supplier_count: suppliers.length,
      alternate_supplier_count: alternateSupplierCount,
      redundancy_scope: "direct_component_fact_edges",
      limitation: "Counts distinct direct Level 4/5 suppliers for the component; multi-hop path redundancy is not included yet."
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
          "Uses max-product paths over known strength*freshness edge weights; edges missing strength or freshness are listed and not imputed, and alternate-path redundancy is not aggregated yet."
      }
    };
  });
}

function betweennessCentralityMetrics(input: {
  riskViewId: string;
  componentId: string;
  edges: readonly ComponentRiskEdgeRow[];
}): Array<Omit<RiskMetricRecord, "risk_view_id">> {
  const graphEdges = componentRiskGraphEdges(input.edges);
  const entityNamesById = entityNames(input.edges);
  const edgesByEntityId = groupEdgesByEntityId(input.edges);
  return calculateBetweennessCentrality(graphEdges).map((score) => {
    const incidentEdges = edgesByEntityId.get(score.entity_id) ?? [];
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
        centrality_scope: "directed_component_fact_edge_graph",
        limitation: "Uses the current component-scoped Level 4/5 fact-edge graph only; weighted multi-hop propagation is not included yet."
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

async function listComponentRiskEdges(client: DbClient, componentId: string): Promise<ComponentRiskEdgeRow[]> {
  const result = await client.query<ComponentRiskEdgeRow>(
    `SELECT e.edge_id, e.relation,
            e.subject_id, s.display_name AS subject_name,
            e.object_id, o.display_name AS object_name,
            e.component_id, e.evidence_level, e.confidence, e.primary_evidence_id
     FROM edges e
     JOIN entity_master s ON s.entity_id = e.subject_id
     JOIN entity_master o ON o.entity_id = e.object_id
     WHERE e.validity = 'current'
       AND e.evidence_level >= 4
       AND e.is_inferred = false
       AND e.component_id = $1
       AND e.relation IN ('BUYS_FROM','SUPPLIES_TO','USES_FOUNDRY','MANUFACTURES_AT')
     ORDER BY e.evidence_level DESC, e.confidence DESC, e.edge_id`,
    [componentId]
  );
  return result.rows;
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

function groupByEdgeId<T extends { edge_id: string }>(items: readonly T[]): Map<string, T[]> {
  const output = new Map<string, T[]>();
  for (const item of items) {
    const group = output.get(item.edge_id) ?? [];
    group.push(item);
    output.set(item.edge_id, group);
  }
  return output;
}

function groupBySupplierId(edges: readonly ComponentRiskEdgeRow[]): Map<string, ComponentRiskEdgeRow[]> {
  const output = new Map<string, ComponentRiskEdgeRow[]>();
  for (const edge of edges) {
    const supplierId = supplierForEdge(edge).supplier_id;
    const group = output.get(supplierId) ?? [];
    group.push(edge);
    output.set(supplierId, group);
  }
  return output;
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

function riskInputsFingerprint(input: {
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

function deterministicRiskViewId(componentId: string, fingerprint: string): string {
  return `RSK-COMP-${digestForId(`${componentId}:${fingerprint}`, 24)}`;
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
