import type pg from "pg";
import type { ComponentSpecificity, EdgeValidity, EntityRecord, EvidenceLevel, RelationType } from "@supplystrata/core";

export interface EdgeIdentityRow extends pg.QueryResultRow {
  edge_id: string;
  evidence_level: EvidenceLevel;
  confidence: number;
}

export interface ComponentLookupRow extends pg.QueryResultRow {
  component_id: string;
  name: string;
}

export interface EvidenceDocumentRow extends pg.QueryResultRow {
  bytes_sha256: string;
  metadata: Record<string, unknown>;
}

export interface EvidenceChunkRow extends pg.QueryResultRow {
  text: string;
}

export interface EntityRow extends pg.QueryResultRow {
  entity_id: string;
  kind: EntityRecord["kind"];
  canonical_name: string;
  display_name: string;
  language_of_canonical: string;
  identifiers: Record<string, unknown>;
  primary_country: string | null;
  industry: string[];
  status: EntityRecord["status"];
  attrs: Record<string, unknown>;
}

export interface GraphEdgeRow extends pg.QueryResultRow {
  edge_id: string;
  subject_id: string;
  object_id: string;
  relation: RelationType;
  component: string | null;
  component_id: string | null;
  component_specificity: ComponentSpecificity | null;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  validity: EdgeValidity;
  last_verified_at: Date;
}

export interface ProjectionStatsRow extends pg.QueryResultRow {
  nodes: number;
  edges: number;
}
