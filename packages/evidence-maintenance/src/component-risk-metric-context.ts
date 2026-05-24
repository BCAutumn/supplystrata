import type { EdgeFreshnessRecord, EdgeStrengthEstimateRecord, EdgeStrengthKind } from "@supplystrata/core";
import type { ComponentRiskEdgeRow } from "./db-rows.js";

export interface ComponentRiskMetricInput {
  riskViewId: string;
  componentId: string;
  edges: readonly ComponentRiskEdgeRow[];
  strengthsByEdgeId: ReadonlyMap<string, EdgeStrengthEstimateRecord[]>;
  freshnessByEdgeId: ReadonlyMap<string, EdgeFreshnessRecord>;
}

export interface ComponentRiskSupplierContext {
  supplier_id: string;
  supplier_name: string;
  consumer_id: string;
  consumer_name: string;
}

export function componentRiskGraphEdges(edges: readonly ComponentRiskEdgeRow[]): Array<{ edge_id: string; from_entity_id: string; to_entity_id: string }> {
  return edges.map((edge) => {
    const supplier = supplierForEdge(edge);
    return {
      edge_id: edge.edge_id,
      from_entity_id: supplier.supplier_id,
      to_entity_id: supplier.consumer_id
    };
  });
}

export function componentRiskWeightedGraphEdges(
  input: Pick<ComponentRiskMetricInput, "edges" | "strengthsByEdgeId" | "freshnessByEdgeId">
): Array<{ edge_id: string; from_entity_id: string; to_entity_id: string; weight?: number }> {
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

export function supplierForEdge(edge: ComponentRiskEdgeRow): ComponentRiskSupplierContext {
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

export function uniqueSuppliers(edges: readonly ComponentRiskEdgeRow[]): Array<{ supplier_id: string; supplier_name: string }> {
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

export function numericStrength(strengths: readonly EdgeStrengthEstimateRecord[], kind: EdgeStrengthKind): number | undefined {
  for (const strength of strengths) {
    if (strength.strength_kind !== kind || strength.value === undefined) continue;
    const parsed = Number.parseFloat(strength.value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function exposureStrengthWeight(strengths: readonly EdgeStrengthEstimateRecord[]): number | undefined {
  const share = numericStrength(strengths, "share");
  if (share !== undefined) return Math.min(1, Math.max(0, share / 100));
  const dependency = numericStrength(strengths, "dependency");
  if (dependency !== undefined) return Math.min(1, Math.max(0, dependency));
  if (numericStrength(strengths, "capacity") !== undefined) return 1;
  if (numericStrength(strengths, "qualitative") !== undefined) return 0.75;
  return undefined;
}

export function hasSingleSourceDependency(strengths: readonly EdgeStrengthEstimateRecord[]): boolean {
  return strengths.some((strength) => strength.strength_kind === "dependency" && strength.attrs["dependency_kind"] === "single_source");
}

export function edgePropagationWeight(
  edge: ComponentRiskEdgeRow,
  input: Pick<ComponentRiskMetricInput, "strengthsByEdgeId" | "freshnessByEdgeId">
): number | undefined {
  const strengthWeight = exposureStrengthWeight(input.strengthsByEdgeId.get(edge.edge_id) ?? []);
  const freshness = input.freshnessByEdgeId.get(edge.edge_id);
  if (strengthWeight === undefined || freshness === undefined) return undefined;
  return Math.min(1, Math.max(0, strengthWeight * freshness.freshness_score));
}

export function groupEdgesByEntityId(edges: readonly ComponentRiskEdgeRow[]): Map<string, ComponentRiskEdgeRow[]> {
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

export function entityNames(edges: readonly ComponentRiskEdgeRow[]): Map<string, string> {
  const output = new Map<string, string>();
  for (const edge of edges) {
    output.set(edge.subject_id, edge.subject_name);
    output.set(edge.object_id, edge.object_name);
  }
  return output;
}

export function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

export function roundSix(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
