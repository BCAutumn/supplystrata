import type { ComponentSpecificity, EdgeValidity, EntityRecord, EvidenceLevel, RelationType } from "@supplystrata/core";

export interface GraphEdgeInput {
  edge_id: string;
  subject_id: string;
  object_id: string;
  relation: RelationType;
  component?: string;
  component_id?: string;
  component_specificity?: ComponentSpecificity;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  validity: EdgeValidity;
  last_verified_at: string;
}

export interface GraphProjectionStats {
  nodes: number;
  edges: number;
}

export interface GraphStore {
  close(): Promise<void>;
  ensureSchema(): Promise<void>;
  clear(): Promise<void>;
  upsertEntity(entity: EntityRecord): Promise<void>;
  upsertEdge(edge: GraphEdgeInput): Promise<void>;
  removeEdge(edgeId: string): Promise<void>;
  stats(): Promise<GraphProjectionStats>;
}
