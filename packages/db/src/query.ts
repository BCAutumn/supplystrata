import type pg from "pg";
import { normalizeAlias, type ComponentSpecificity, type EdgeValidity, type EvidenceLevel, type ExtractionMethod, type RelationType } from "@supplystrata/core";
import type { DbClient } from "./client.js";

export interface EdgeRow extends pg.QueryResultRow {
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
  primary_evidence_id: string | null;
  last_verified_at: Date;
  subject_name: string;
  object_name: string;
}

export async function listCurrentEdges(client: DbClient): Promise<EdgeRow[]> {
  const result = await client.query<EdgeRow>(
    `SELECT e.*, s.display_name AS subject_name, o.display_name AS object_name
     FROM edges e
     JOIN entity_master s ON s.entity_id = e.subject_id
     JOIN entity_master o ON o.entity_id = e.object_id
     WHERE e.validity = 'current'
     ORDER BY e.edge_id`
  );
  return result.rows;
}

export interface EvidenceDetailRow extends pg.QueryResultRow {
  evidence_id: string;
  edge_id: string | null;
  superseded_by: string | null;
  cite_text: string;
  cite_locator: string | null;
  cite_start_char: number | null;
  cite_end_char: number | null;
  cite_text_sha256: string | null;
  normalized_cite_text_sha256: string | null;
  source_snapshot_sha256: string | null;
  parser_version: string | null;
  extractor_version: string | null;
  relation_candidate_hash: string | null;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  extraction_method: ExtractionMethod;
  source_url: string;
  source_date: Date | null;
  fetched_at: Date;
  source_adapter_id: string;
  document_type: string;
  subject_name: string | null;
  object_name: string | null;
  relation: RelationType | null;
}

export async function getEvidence(client: DbClient, evidenceId: string): Promise<EvidenceDetailRow | undefined> {
  const result = await client.query<EvidenceDetailRow>(
    `SELECT ev.*, d.source_url, d.source_date, d.fetched_at, d.source_adapter_id, d.document_type,
            s.display_name AS subject_name, o.display_name AS object_name, ed.relation
     FROM evidence ev
     JOIN documents d ON d.doc_id = ev.doc_id
     LEFT JOIN edges ed ON ed.edge_id = ev.edge_id
     LEFT JOIN entity_master s ON s.entity_id = ed.subject_id
     LEFT JOIN entity_master o ON o.entity_id = ed.object_id
     WHERE ev.evidence_id = $1`,
    [evidenceId]
  );
  return result.rows[0];
}

export async function listEvidenceForEdges(client: DbClient, edgeIds: readonly string[]): Promise<EvidenceDetailRow[]> {
  if (edgeIds.length === 0) return [];
  const result = await client.query<EvidenceDetailRow>(
    `SELECT ev.*, d.source_url, d.source_date, d.fetched_at, d.source_adapter_id, d.document_type,
            s.display_name AS subject_name, o.display_name AS object_name, ed.relation
     FROM evidence ev
     JOIN documents d ON d.doc_id = ev.doc_id
     LEFT JOIN edges ed ON ed.edge_id = ev.edge_id
     LEFT JOIN entity_master s ON s.entity_id = ed.subject_id
     LEFT JOIN entity_master o ON o.entity_id = ed.object_id
     WHERE ev.edge_id = ANY($1::text[])
     ORDER BY ev.edge_id,
              CASE WHEN ev.superseded_by IS NULL THEN 0 ELSE 1 END,
              ev.evidence_level DESC,
              ev.confidence DESC,
              ev.created_at DESC,
              ev.evidence_id`,
    [[...edgeIds]]
  );
  return result.rows;
}

export interface UnknownItemRow extends pg.QueryResultRow {
  unknown_id: string;
  scope_kind: string;
  scope_id: string;
  question: string;
  why_unknown: string;
  blocking_data_sources: string[];
  proxies: string[];
  status: string;
}

export async function listUnknownItems(client: DbClient, scopeId: string): Promise<UnknownItemRow[]> {
  const result = await client.query<UnknownItemRow>(
    `SELECT unknown_id, scope_kind, scope_id, question, why_unknown, blocking_data_sources, proxies, status
     FROM unknown_items
     WHERE scope_id = $1 AND status = 'open'
     ORDER BY created_at`,
    [scopeId]
  );
  return result.rows;
}

export async function resolveEntityId(client: DbClient, input: string): Promise<string> {
  const normalized = normalizeAlias(input);
  const entityId = await tryResolveEntityId(client, input);
  if (entityId !== undefined) return entityId;
  throw new Error(`Cannot resolve entity: ${input}`);
}

export async function tryResolveEntityId(client: DbClient, input: string): Promise<string | undefined> {
  const normalized = normalizeAlias(input);
  const entityResult = await client.query<{ entity_id: string } & pg.QueryResultRow>(
    `SELECT entity_id FROM entity_master
     WHERE lower(entity_id) = $1 OR lower(display_name) = $1 OR lower(canonical_name) = $1
     LIMIT 1`,
    [normalized]
  );
  if (entityResult.rows[0] !== undefined) return entityResult.rows[0].entity_id;
  const aliasResult = await client.query<{ entity_id: string } & pg.QueryResultRow>("SELECT entity_id FROM entity_alias WHERE alias_norm = $1 LIMIT 1", [
    normalized
  ]);
  const alias = aliasResult.rows[0];
  return alias?.entity_id;
}
