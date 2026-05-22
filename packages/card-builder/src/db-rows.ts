import type { ComponentSpecificity, EvidenceLevel, RelationType } from "@supplystrata/core";
import type { DbRow } from "@supplystrata/db/read";

export interface CompanyEdgeRow extends DbRow {
  edge_id: string;
  relation: RelationType;
  component: string | null;
  component_id: string | null;
  component_specificity: ComponentSpecificity | null;
  counterparty_id: string;
  counterparty_name: string;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  primary_evidence_id: string | null;
  cite_text: string | null;
  source_url: string | null;
  source_date: Date | null;
}

export interface CompanyHeaderRow extends DbRow {
  entity_id: string;
  canonical_name: string;
  display_name: string;
}

export interface ComponentHeaderRow extends DbRow {
  component_id: string;
  name: string;
  taxonomy_path: string[];
  aliases: string[];
}

export interface ComponentEdgeRow extends DbRow {
  edge_id: string;
  relation: RelationType;
  subject_id: string;
  subject_name: string;
  object_id: string;
  object_name: string;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  primary_evidence_id: string | null;
  cite_text: string | null;
  source_url: string | null;
  source_date: Date | null;
}
