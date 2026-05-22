import type pg from "pg";
import type { EvidenceLevel, RelationType } from "@supplystrata/core";

export interface EntityHeaderRow extends pg.QueryResultRow {
  entity_id: string;
  display_name: string;
}

export interface ChainFactRow extends pg.QueryResultRow {
  depth: number;
  edge_id: string;
  relation: RelationType;
  subject_id: string;
  subject_name: string;
  object_id: string;
  object_name: string;
  upstream_id: string;
  upstream_name: string;
  component: string | null;
  component_id: string | null;
  evidence_level: EvidenceLevel;
  confidence: number;
  primary_evidence_id: string | null;
  claim_id: string | null;
  claim_text: string | null;
}
