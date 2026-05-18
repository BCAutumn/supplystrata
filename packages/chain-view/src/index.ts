import type { ChainEndpointKind, EvidenceLevel, RelationType, SemanticLayer } from "@supplystrata/core";

export type ChainViewRelation = RelationType | "CLAIMS" | "OBSERVES" | "LEADS_TO" | "UNKNOWN_BOUNDARY";

export interface ChainViewSourceHint {
  source_id: string;
  source_name: string;
  expected_output_layer: "edge" | "observation" | "lead" | "entity";
  relation_policy: "can_create_fact_edge" | "observation_only" | "lead_only" | "entity_only";
  requires_key: boolean;
  status: string;
  reasons: string[];
}

export interface ChainViewRoot {
  kind: ChainEndpointKind;
  id: string;
  name: string;
}

export interface ChainViewEndpoint {
  kind: ChainEndpointKind;
  id: string;
  name: string;
}

export interface ChainViewSegmentModel {
  sequence_index: number;
  depth: number;
  semantic_layer: SemanticLayer;
  from: ChainViewEndpoint;
  to: ChainViewEndpoint;
  relation: ChainViewRelation;
  component: string | null;
  component_id: string | null;
  edge_id?: string;
  claim_id?: string;
  observation_id?: string;
  lead_id?: string;
  unknown_id?: string;
  evidence_ids: string[];
  evidence_level?: EvidenceLevel;
  confidence: number;
  label: string;
  source_hints?: ChainViewSourceHint[];
}

export interface ChainViewModel {
  schema_version: "1.0.0";
  view_type: "company_chain";
  root: ChainViewRoot;
  max_depth: number;
  generated_by: string;
  segments: ChainViewSegmentModel[];
  stats: ChainViewStats;
}

export interface ChainViewStats {
  fact_edges: number;
  claims: number;
  observations: number;
  leads: number;
  unknowns: number;
}

export function summarizeChainSegments(segments: readonly ChainViewSegmentModel[]): ChainViewStats {
  return {
    fact_edges: segments.filter((segment) => segment.semantic_layer === "edge").length,
    claims: segments.filter((segment) => segment.semantic_layer === "claim").length,
    observations: segments.filter((segment) => segment.semantic_layer === "observation").length,
    leads: segments.filter((segment) => segment.semantic_layer === "lead").length,
    unknowns: segments.filter((segment) => segment.semantic_layer === "unknown").length
  };
}
