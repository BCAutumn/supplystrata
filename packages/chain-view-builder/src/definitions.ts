import type { EvidenceLevel, RelationType } from "@supplystrata/core";

export interface ChainFact {
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

export interface ChainObservation {
  observation_id: string;
  component_id: string | null;
  observation_type: string;
  metric_name: string;
  metric_value: string | null;
  metric_unit: string | null;
  confidence: number;
}

export interface ChainLead {
  lead_id: string;
  title: string;
  summary: string;
  status: "open" | "in_review" | "promoted" | "rejected" | "closed";
}

export interface ChainUnknown {
  unknown_id: string;
  question: string;
  why_unknown: string;
}
