import type { ComponentSpecificity, EvidenceLevel, RelationType } from "@supplystrata/core";
import {
  getEvidence,
  listObservationsByScope,
  listUnknownItems,
  resolveEntityId,
  type DbClient,
  type DbRow,
  type ObservationRow,
  type UnknownItemRow
} from "@supplystrata/db";
import { buildCompanyChainView } from "@supplystrata/chain-view-builder";
import type { ChainViewModel } from "@supplystrata/chain-view";
import type {
  CompanyCardModel,
  CompanyCardEdge,
  CompanyCardEntity,
  ComponentCardModel,
  ComponentEvidenceEdge,
  ComponentHeader,
  ComponentObservation,
  ComponentParticipant,
  EvidenceCardModel,
  UnknownMapItem,
  UnknownMapModel
} from "@supplystrata/render";

interface CompanyEdgeRow extends DbRow {
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

interface CompanyHeaderRow extends DbRow {
  entity_id: string;
  canonical_name: string;
  display_name: string;
}

interface ComponentHeaderRow extends DbRow {
  component_id: string;
  name: string;
  taxonomy_path: string[];
  aliases: string[];
}

interface ComponentEdgeRow extends DbRow {
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

export async function loadChainCard(client: DbClient, query: string, input: { depth: number }): Promise<ChainViewModel> {
  return buildCompanyChainView(client, { query, depth: input.depth });
}

export async function loadCompanyCard(client: DbClient, query: string): Promise<CompanyCardModel> {
  const entityId = await resolveEntityId(client, query);
  const header = await loadCompanyHeader(client, entityId);
  const upstreamEdges = await loadCompanyEdges(client, entityId, "upstream");
  const downstreamEdges = await loadCompanyEdges(client, entityId, "downstream");
  const unknownItems = await listUnknownItems(client, entityId);
  return {
    entity: companyEntityFromRow(header),
    directly_disclosed_upstream: upstreamEdges.map(companyEdgeFromRow),
    directly_disclosed_downstream: downstreamEdges.map(companyEdgeFromRow),
    unknown_map: unknownItems.map(unknownMapItemFromRow)
  };
}

export async function loadComponentCard(client: DbClient, query: string): Promise<ComponentCardModel> {
  const component = await resolveComponent(client, query);
  const edges = await loadComponentEdges(client, component);
  const evidenceEdges = edges.map(toComponentEvidenceEdge);
  return {
    component: componentHeaderFromRow(component),
    known_suppliers: summarizeComponentParticipants(evidenceEdges, "supplier"),
    known_consumers: summarizeComponentParticipants(evidenceEdges, "consumer"),
    evidence_edges: evidenceEdges,
    source_coverage: summarizeComponentSourceCoverage(evidenceEdges),
    related_observations: (await listObservationsByScope(client, { scope_kind: "component", scope_id: component.component_id, limit: 10 })).map(
      observationFromRow
    ),
    unknown_map: (await listUnknownItems(client, component.component_id)).map(unknownMapItemFromRow)
  };
}

export async function loadEvidenceCard(client: DbClient, evidenceId: string): Promise<EvidenceCardModel> {
  const evidence = await getEvidence(client, evidenceId);
  if (evidence === undefined) throw new Error(`Evidence not found: ${evidenceId}`);
  return {
    ...evidence,
    source_date: evidence.source_date === null ? null : evidence.source_date.toISOString(),
    fetched_at: evidence.fetched_at.toISOString()
  };
}

export async function loadUnknownMap(client: DbClient, query: string): Promise<UnknownMapModel> {
  const entityId = await resolveEntityId(client, query);
  const items = await listUnknownItems(client, entityId);
  return { scope: entityId, items: items.map(unknownMapItemFromRow) };
}

async function loadCompanyHeader(client: DbClient, entityId: string): Promise<CompanyHeaderRow> {
  const headerResult = await client.query<CompanyHeaderRow>("SELECT entity_id, canonical_name, display_name FROM entity_master WHERE entity_id = $1", [
    entityId
  ]);
  const header = headerResult.rows[0];
  if (header === undefined) throw new Error(`Entity not found: ${entityId}`);
  return header;
}

async function loadCompanyEdges(client: DbClient, entityId: string, direction: "upstream" | "downstream"): Promise<CompanyEdgeRow[]> {
  const relationFilter = direction === "upstream" ? "e.relation IN ('BUYS_FROM','USES_FOUNDRY','MANUFACTURES_AT')" : "e.relation = 'SUPPLIES_TO'";
  const result = await client.query<CompanyEdgeRow>(
    `SELECT e.edge_id, e.relation, e.component, e.component_id, e.component_specificity,
            e.object_id AS counterparty_id,
            o.display_name AS counterparty_name,
            e.evidence_level, e.confidence, e.is_inferred, e.primary_evidence_id,
            ev.cite_text, d.source_url, d.source_date
     FROM edges e
     JOIN entity_master o ON o.entity_id = e.object_id
     LEFT JOIN evidence ev ON ev.evidence_id = e.primary_evidence_id
     LEFT JOIN documents d ON d.doc_id = ev.doc_id
     WHERE e.subject_id = $1 AND e.validity = 'current' AND e.evidence_level >= 4
       AND ${relationFilter}
     ORDER BY e.evidence_level DESC, e.confidence DESC, o.display_name`,
    [entityId]
  );
  return result.rows;
}

async function resolveComponent(client: DbClient, query: string): Promise<ComponentHeaderRow> {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) throw new Error("Component query must not be empty");
  const result = await client.query<ComponentHeaderRow>(
    `SELECT component_id, name, taxonomy_path, aliases
     FROM components
     WHERE lower(component_id) = $1
        OR lower(name) = $1
        OR EXISTS (SELECT 1 FROM unnest(aliases) AS alias WHERE lower(alias) = $1)
     ORDER BY CASE WHEN lower(component_id) = $1 THEN 0 WHEN lower(name) = $1 THEN 1 ELSE 2 END, component_id
     LIMIT 1`,
    [normalized]
  );
  const component = result.rows[0];
  if (component === undefined) throw new Error(`Component not found: ${query}`);
  return component;
}

async function loadComponentEdges(client: DbClient, component: ComponentHeaderRow): Promise<ComponentEdgeRow[]> {
  const result = await client.query<ComponentEdgeRow>(
    `SELECT e.edge_id, e.relation,
            e.subject_id,
            s.display_name AS subject_name,
            e.object_id,
            o.display_name AS object_name,
            e.evidence_level, e.confidence, e.is_inferred, e.primary_evidence_id,
            ev.cite_text, d.source_url, d.source_date
     FROM edges e
     JOIN entity_master s ON s.entity_id = e.subject_id
     JOIN entity_master o ON o.entity_id = e.object_id
     LEFT JOIN evidence ev ON ev.evidence_id = e.primary_evidence_id
     LEFT JOIN documents d ON d.doc_id = ev.doc_id
     WHERE e.validity = 'current'
       AND e.evidence_level >= 4
       AND (
         e.component_id = $1
         OR (e.component_id IS NULL AND lower(e.component) = lower($2))
         OR (e.component_id IS NULL AND EXISTS (SELECT 1 FROM unnest($3::text[]) AS alias WHERE lower(e.component) = lower(alias)))
       )
     ORDER BY e.evidence_level DESC, e.confidence DESC, s.display_name, o.display_name`,
    [component.component_id, component.name, component.aliases]
  );
  return result.rows;
}

function companyEntityFromRow(row: CompanyHeaderRow): CompanyCardEntity {
  return { entity_id: row.entity_id, canonical_name: row.canonical_name, display_name: row.display_name };
}

function companyEdgeFromRow(row: CompanyEdgeRow): CompanyCardEdge {
  return { ...row, source_date: row.source_date === null ? null : row.source_date.toISOString() };
}

function componentHeaderFromRow(row: ComponentHeaderRow): ComponentHeader {
  return { component_id: row.component_id, name: row.name, taxonomy_path: row.taxonomy_path, aliases: row.aliases };
}

function toComponentEvidenceEdge(row: ComponentEdgeRow): ComponentEvidenceEdge {
  const direction = componentEdgeDirection(row);
  return {
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

function summarizeComponentParticipants(edges: readonly ComponentEvidenceEdge[], role: "supplier" | "consumer"): ComponentParticipant[] {
  const byEntity = new Map<string, ComponentParticipant>();
  for (const edge of edges) {
    const entityId = role === "supplier" ? edge.supplier_id : edge.consumer_id;
    const name = role === "supplier" ? edge.supplier_name : edge.consumer_name;
    const item = byEntity.get(entityId) ?? {
      entity_id: entityId,
      name,
      roles: [],
      edge_count: 0,
      best_evidence_level: edge.evidence_level,
      best_confidence: edge.confidence
    };
    item.edge_count += 1;
    item.best_evidence_level = Math.max(item.best_evidence_level, edge.evidence_level) as EvidenceLevel;
    item.best_confidence = Math.max(item.best_confidence, edge.confidence);
    if (!item.roles.includes(edge.relation)) item.roles.push(edge.relation);
    byEntity.set(entityId, item);
  }
  return [...byEntity.values()].sort(
    (left, right) => right.best_evidence_level - left.best_evidence_level || right.best_confidence - left.best_confidence || left.name.localeCompare(right.name)
  );
}

function summarizeComponentSourceCoverage(edges: readonly ComponentEvidenceEdge[]): {
  sources: number;
  evidence_edges: number;
  latest_source_date: string | null;
} {
  const sources = new Set<string>();
  let latestSourceDate: string | null = null;
  for (const edge of edges) {
    if (edge.source_url !== null) sources.add(edge.source_url);
    if (edge.source_date !== null) {
      const sourceDate = edge.source_date.slice(0, 10);
      if (latestSourceDate === null || sourceDate > latestSourceDate) latestSourceDate = sourceDate;
    }
  }
  return {
    sources: sources.size,
    evidence_edges: edges.length,
    latest_source_date: latestSourceDate
  };
}

function observationFromRow(row: ObservationRow): ComponentObservation {
  return {
    ...row,
    time_window_start: row.time_window_start === null ? null : row.time_window_start.toISOString(),
    time_window_end: row.time_window_end === null ? null : row.time_window_end.toISOString(),
    created_at: row.created_at.toISOString()
  };
}

function unknownMapItemFromRow(row: UnknownItemRow): UnknownMapItem {
  return {
    unknown_id: row.unknown_id,
    question: row.question,
    why_unknown: row.why_unknown,
    blocking_data_sources: row.blocking_data_sources,
    proxies: row.proxies,
    status: row.status
  };
}
