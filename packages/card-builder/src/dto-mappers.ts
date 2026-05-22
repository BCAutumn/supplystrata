import type { UnknownItemRow } from "@supplystrata/db/read";
import type { CompanyCardEdge, CompanyCardEntity, ComponentEvidenceEdge, ComponentHeader, EdgeIntelligenceSummary, UnknownMapItem } from "@supplystrata/render";
import type { CompanyEdgeRow, CompanyHeaderRow, ComponentEdgeRow, ComponentHeaderRow } from "./db-rows.js";

export function companyEntityFromRow(row: CompanyHeaderRow): CompanyCardEntity {
  return { entity_id: row.entity_id, canonical_name: row.canonical_name, display_name: row.display_name };
}

export function companyEdgeFromRow(row: CompanyEdgeRow, intelligenceByEdgeId: ReadonlyMap<string, EdgeIntelligenceSummary>): CompanyCardEdge {
  const base = { ...row, source_date: row.source_date === null ? null : row.source_date.toISOString() };
  const intelligence = intelligenceByEdgeId.get(row.edge_id);
  return intelligence === undefined ? base : { ...base, intelligence };
}

export function componentHeaderFromRow(row: ComponentHeaderRow): ComponentHeader {
  return { component_id: row.component_id, name: row.name, taxonomy_path: row.taxonomy_path, aliases: row.aliases };
}

export function toComponentEvidenceEdge(row: ComponentEdgeRow, intelligenceByEdgeId: ReadonlyMap<string, EdgeIntelligenceSummary>): ComponentEvidenceEdge {
  const direction = componentEdgeDirection(row);
  const base = {
    edge_id: row.edge_id,
    relation: row.relation,
    supplier_id: direction.supplier_id,
    supplier_name: direction.supplier_name,
    consumer_id: direction.consumer_id,
    consumer_name: direction.consumer_name,
    evidence_level: row.evidence_level,
    confidence: row.confidence,
    is_inferred: row.is_inferred,
    primary_evidence_id: row.primary_evidence_id,
    cite_text: row.cite_text,
    source_url: row.source_url,
    source_date: row.source_date === null ? null : row.source_date.toISOString()
  };
  const intelligence = intelligenceByEdgeId.get(row.edge_id);
  return intelligence === undefined ? base : { ...base, intelligence };
}

export function unknownMapItemFromRow(row: UnknownItemRow): UnknownMapItem {
  return {
    unknown_id: row.unknown_id,
    question: row.question,
    why_unknown: row.why_unknown,
    blocking_data_sources: row.blocking_data_sources,
    proxies: row.proxies,
    status: row.status
  };
}

function componentEdgeDirection(row: ComponentEdgeRow): {
  supplier_id: string;
  supplier_name: string;
  consumer_id: string;
  consumer_name: string;
} {
  if (row.relation === "SUPPLIES_TO") {
    return {
      supplier_id: row.subject_id,
      supplier_name: row.subject_name,
      consumer_id: row.object_id,
      consumer_name: row.object_name
    };
  }
  return {
    supplier_id: row.object_id,
    supplier_name: row.object_name,
    consumer_id: row.subject_id,
    consumer_name: row.subject_name
  };
}
