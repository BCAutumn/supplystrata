import { createHash } from "node:crypto";
import type { EdgeFreshnessRecord, EdgeStrengthEstimateRecord, RiskMetricKind } from "@supplystrata/core";
import type { ComponentRiskEdgeRow } from "./db-rows.js";

type StableJsonArray = readonly StableJsonValue[];
type StableJsonObject = { readonly [key: string]: StableJsonValue };
type StableJsonValue = null | string | number | boolean | StableJsonArray | StableJsonObject;

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

export function deterministicRiskMetricId(riskViewId: string, metricKind: RiskMetricKind, subjectKind: string, subjectId: string): string {
  return `RKM-${digestForId(`${riskViewId}:${metricKind}:${subjectKind}:${subjectId}`, 24)}`;
}

function digestForId(value: string, length: number): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length).toUpperCase();
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
