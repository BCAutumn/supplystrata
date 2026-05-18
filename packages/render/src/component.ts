import type pg from "pg";
import type { EvidenceLevel, RelationType } from "@supplystrata/core";
import type { DbClient, ObservationRow, UnknownItemRow } from "@supplystrata/db";
import { listObservationsByScope, listUnknownItems } from "@supplystrata/db";
import type { OutputFormat } from "./types.js";

export interface ComponentHeaderRow extends pg.QueryResultRow {
  component_id: string;
  name: string;
  taxonomy_path: string[];
  aliases: string[];
}

export interface ComponentParticipant {
  entity_id: string;
  name: string;
  roles: string[];
  edge_count: number;
  best_evidence_level: EvidenceLevel;
  best_confidence: number;
}

export interface ComponentEvidenceEdge {
  edge_id: string;
  relation: RelationType;
  supplier_id: string;
  supplier_name: string;
  consumer_id: string;
  consumer_name: string;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  primary_evidence_id: string | null;
  cite_text: string | null;
  source_url: string | null;
  source_date: Date | null;
}

export interface ComponentCardModel {
  component: ComponentHeaderRow;
  known_suppliers: ComponentParticipant[];
  known_consumers: ComponentParticipant[];
  evidence_edges: ComponentEvidenceEdge[];
  source_coverage: {
    sources: number;
    evidence_edges: number;
    latest_source_date: string | null;
  };
  related_observations: ObservationRow[];
  unknown_map: UnknownItemRow[];
}

interface ComponentEdgeRow extends pg.QueryResultRow {
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

export async function renderComponent(client: DbClient, query: string, format: OutputFormat): Promise<string> {
  return renderComponentCard(await loadComponentCard(client, query), format);
}

export async function loadComponentCard(client: DbClient, query: string): Promise<ComponentCardModel> {
  const component = await resolveComponent(client, query);
  const edges = await loadComponentEdges(client, component);
  const evidenceEdges = edges.map(toComponentEvidenceEdge);
  const suppliers = summarizeComponentParticipants(evidenceEdges, "supplier");
  const consumers = summarizeComponentParticipants(evidenceEdges, "consumer");
  const unknownItems = await listUnknownItems(client, component.component_id);
  const relatedObservations = await listObservationsByScope(client, { scope_kind: "component", scope_id: component.component_id, limit: 10 });
  const sourceCoverage = summarizeComponentSourceCoverage(evidenceEdges);

  const card: ComponentCardModel = {
    component,
    known_suppliers: suppliers,
    known_consumers: consumers,
    evidence_edges: evidenceEdges,
    source_coverage: sourceCoverage,
    related_observations: relatedObservations,
    unknown_map: unknownItems
  };
  return card;
}

export function renderComponentCard(card: ComponentCardModel, format: OutputFormat): string {
  if (format === "json") {
    return JSON.stringify(
      {
        schema_version: "1.0.0",
        component: card.component,
        known_suppliers: card.known_suppliers,
        known_consumers: card.known_consumers,
        evidence_edges: card.evidence_edges,
        source_coverage: card.source_coverage,
        related_observations: card.related_observations,
        unknown_map: card.unknown_map
      },
      null,
      2
    );
  }

  const lines = [
    `# Component ${card.component.name} [${card.component.component_id}]`,
    "",
    `Taxonomy: ${card.component.taxonomy_path.join(" > ")}`,
    `Aliases: ${card.component.aliases.length === 0 ? "(none)" : card.component.aliases.join(", ")}`,
    "",
    "## Known suppliers",
    ""
  ];
  appendComponentParticipants(lines, card.known_suppliers);
  lines.push("", "## Known consumers", "");
  appendComponentParticipants(lines, card.known_consumers);
  lines.push("", "## Evidence edges", "");
  appendComponentEvidenceEdges(lines, card.evidence_edges);
  lines.push("", "## Related observations", "");
  appendRelatedObservations(lines, card.related_observations);
  lines.push("", "## Source coverage", "");
  appendSourceCoverage(lines, card.source_coverage);
  lines.push("", "## Unknown map", "");
  if (card.unknown_map.length === 0) {
    lines.push("- No component-scoped unknown items recorded yet.");
  } else {
    for (const item of card.unknown_map) {
      lines.push(`- ${item.question}`);
      lines.push(`  Why unknown: ${item.why_unknown}`);
    }
  }
  return lines.join("\n");
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
    source_date: row.source_date
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
      const sourceDate = edge.source_date.toISOString().slice(0, 10);
      if (latestSourceDate === null || sourceDate > latestSourceDate) latestSourceDate = sourceDate;
    }
  }
  return {
    sources: sources.size,
    evidence_edges: edges.length,
    latest_source_date: latestSourceDate
  };
}

function appendComponentParticipants(lines: string[], items: readonly ComponentParticipant[]): void {
  if (items.length === 0) {
    lines.push("(none recorded at Level 4-5)");
    return;
  }
  for (const item of items) {
    lines.push(`- ${item.name} [${item.entity_id}]`);
    lines.push(`  Evidence: Level ${item.best_evidence_level}, conf ${item.best_confidence.toFixed(3)}, edges ${item.edge_count}`);
    lines.push(`  Roles: ${item.roles.join(", ")}`);
  }
}

function appendComponentEvidenceEdges(lines: string[], edges: readonly ComponentEvidenceEdge[]): void {
  if (edges.length === 0) {
    lines.push("(no Level 4-5 component edges yet)");
    return;
  }
  for (const edge of edges) {
    lines.push(`- ${edge.supplier_name} -> ${edge.consumer_name} via ${edge.relation} [Level ${edge.evidence_level}, conf ${edge.confidence.toFixed(3)}]`);
    if (edge.source_date !== null) lines.push(`  Source date: ${edge.source_date.toISOString().slice(0, 10)}`);
    if (edge.cite_text !== null) lines.push(`  "${edge.cite_text}"`);
    if (edge.primary_evidence_id !== null) lines.push(`  Evidence: ${edge.primary_evidence_id}`);
  }
}

function appendRelatedObservations(lines: string[], observations: readonly ObservationRow[]): void {
  if (observations.length === 0) {
    lines.push("(no component-scoped observations recorded yet)");
    return;
  }
  for (const observation of observations) {
    lines.push(`- ${observation.observation_type}: ${observation.metric_name}`);
    lines.push(`  Scope: ${observation.scope_kind}:${observation.scope_id}; source: ${observation.source_adapter_id}`);
    lines.push(`  Value: ${observation.metric_value ?? "(n/a)"}${observation.metric_unit === null ? "" : ` ${observation.metric_unit}`}`);
    lines.push(`  Confidence: ${observation.confidence.toFixed(3)}`);
  }
}

function appendSourceCoverage(
  lines: string[],
  coverage: {
    sources: number;
    evidence_edges: number;
    latest_source_date: string | null;
  }
): void {
  lines.push(`- Evidence edges: ${coverage.evidence_edges}`);
  lines.push(`- Distinct source URLs: ${coverage.sources}`);
  lines.push(`- Latest source date: ${coverage.latest_source_date ?? "(none)"}`);
}
