import type { ChainFact, ChainLead, ChainObservation, ChainUnknown } from "./definitions.js";
import type { ChainFactRow, ChainLeadRow, ChainObservationRow, ChainUnknownRow } from "./db-rows.js";

export function chainFactFromRow(row: ChainFactRow): ChainFact {
  return {
    depth: row.depth,
    edge_id: row.edge_id,
    relation: row.relation,
    subject_id: row.subject_id,
    subject_name: row.subject_name,
    object_id: row.object_id,
    object_name: row.object_name,
    upstream_id: row.upstream_id,
    upstream_name: row.upstream_name,
    component: row.component,
    component_id: row.component_id,
    evidence_level: row.evidence_level,
    confidence: row.confidence,
    primary_evidence_id: row.primary_evidence_id,
    claim_id: row.claim_id,
    claim_text: row.claim_text
  };
}

export function chainObservationFromRow(row: ChainObservationRow): ChainObservation {
  return {
    observation_id: row.observation_id,
    component_id: row.component_id,
    observation_type: row.observation_type,
    metric_name: row.metric_name,
    metric_value: row.metric_value,
    metric_unit: row.metric_unit,
    confidence: row.confidence
  };
}

export function chainLeadFromRow(row: ChainLeadRow): ChainLead {
  return {
    lead_id: row.lead_id,
    title: row.title,
    summary: row.summary,
    status: row.status
  };
}

export function chainUnknownFromRow(row: ChainUnknownRow): ChainUnknown {
  return {
    unknown_id: row.unknown_id,
    question: row.question,
    why_unknown: row.why_unknown
  };
}
