import type pg from "pg";
import {
  getEvidence,
  getPendingEntity,
  listChangeTimeline,
  listPendingEntities,
  listUnknownItems,
  resolveEntityId,
  type ChangeTimelineInput,
  type ChangeTimelineItem,
  type PendingEntityStatusFilter,
  type UnknownItemRow
} from "@supplystrata/db";
import type { EvidenceLevel, RelationType } from "@supplystrata/core";

export type OutputFormat = "markdown" | "json";

interface CompanyEdgeRow extends pg.QueryResultRow {
  edge_id: string;
  relation: RelationType;
  component: string | null;
  component_id: string | null;
  component_specificity: string | null;
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

interface EntityHeaderRow extends pg.QueryResultRow {
  entity_id: string;
  canonical_name: string;
  display_name: string;
}

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
  source_coverage: { sources: number; evidence_edges: number; latest_source_date: string | null };
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

export interface ChainEdge {
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
  cite_text: string | null;
}

interface ChainEdgeRow extends pg.QueryResultRow {
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
  cite_text: string | null;
}

export async function renderCompany(pool: pg.Pool, query: string, format: OutputFormat): Promise<string> {
  const entityId = await resolveEntityId(pool, query);
  const headerResult = await pool.query<EntityHeaderRow>("SELECT entity_id, canonical_name, display_name FROM entity_master WHERE entity_id = $1", [entityId]);
  const header = headerResult.rows[0];
  if (header === undefined) throw new Error(`Entity not found: ${entityId}`);
  const edges = await loadCompanyEdges(pool, entityId);
  const unknownItems = await listUnknownItems(pool, entityId);

  if (format === "json") {
    return JSON.stringify({ schema_version: "1.0.0", entity: header, directly_disclosed_upstream: edges, unknown_map: unknownItems }, null, 2);
  }

  const lines = [`# ${header.canonical_name} [${header.entity_id}]`, "", "## Directly disclosed upstream (Level 4-5)", ""];
  if (edges.length === 0) {
    lines.push("(no directly disclosed upstream edges yet)", "");
  }
  for (const edge of edges) {
    const component = edge.component === null ? "" : ` (${edge.component})`;
    lines.push(`- ${edge.relation}${component} -> ${edge.counterparty_name} [Level ${edge.evidence_level}, conf ${edge.confidence.toFixed(3)}]`);
    if (edge.source_date !== null) lines.push(`  Source date: ${edge.source_date.toISOString().slice(0, 10)}`);
    if (edge.cite_text !== null) lines.push(`  "${edge.cite_text}"`);
    if (edge.primary_evidence_id !== null) lines.push(`  Evidence: ${edge.primary_evidence_id}`);
    lines.push("");
  }
  lines.push("## Unknown map", "");
  for (const item of unknownItems) {
    lines.push(`- ${item.question}`);
    lines.push(`  Why unknown: ${item.why_unknown}`);
  }
  return lines.join("\n");
}

export async function renderComponent(pool: pg.Pool, query: string, format: OutputFormat): Promise<string> {
  const component = await resolveComponent(pool, query);
  const edges = await loadComponentEdges(pool, component);
  const evidenceEdges = edges.map(toComponentEvidenceEdge);
  const suppliers = summarizeComponentParticipants(evidenceEdges, "supplier");
  const consumers = summarizeComponentParticipants(evidenceEdges, "consumer");
  const unknownItems = await listUnknownItems(pool, component.component_id);
  const sourceCoverage = summarizeComponentSourceCoverage(evidenceEdges);

  const card: ComponentCardModel = {
    component,
    known_suppliers: suppliers,
    known_consumers: consumers,
    evidence_edges: evidenceEdges,
    source_coverage: sourceCoverage,
    unknown_map: unknownItems
  };
  return renderComponentCard(card, format);
}

export async function renderChain(pool: pg.Pool, query: string, input: { depth: number; format: OutputFormat }): Promise<string> {
  const entityId = await resolveEntityId(pool, query);
  const headerResult = await pool.query<EntityHeaderRow>("SELECT entity_id, canonical_name, display_name FROM entity_master WHERE entity_id = $1", [entityId]);
  const header = headerResult.rows[0];
  if (header === undefined) throw new Error(`Entity not found: ${entityId}`);
  const edges = await loadUpstreamChainEdges(pool, entityId, input.depth);
  return renderChainCard({
    root: header,
    max_depth: input.depth,
    edges
  }, input.format);
}

export function renderChainCard(card: { root: EntityHeaderRow; max_depth: number; edges: readonly ChainEdge[] }, format: OutputFormat): string {
  if (format === "json") return JSON.stringify({ schema_version: "1.0.0", ...card }, null, 2);

  const lines = [
    `# Supply Chain ${card.root.display_name} [${card.root.entity_id}]`,
    "",
    `Max depth: ${card.max_depth}`,
    `Edges: ${card.edges.length}`,
    "",
    "## Upstream chain",
    ""
  ];
  if (card.edges.length === 0) {
    lines.push("(no Level 4-5 upstream chain edges yet)");
    return lines.join("\n");
  }
  for (const edge of card.edges) {
    const indent = "  ".repeat(edge.depth - 1);
    const component = edge.component === null ? "" : ` (${edge.component})`;
    lines.push(`${indent}- depth ${edge.depth}: ${edge.subject_name} -${edge.relation}${component}-> ${edge.object_name}`);
    lines.push(`${indent}  Upstream node: ${edge.upstream_name} [${edge.upstream_id}]`);
    lines.push(`${indent}  Evidence: Level ${edge.evidence_level}, conf ${edge.confidence.toFixed(3)}${edge.primary_evidence_id === null ? "" : `, ${edge.primary_evidence_id}`}`);
    if (edge.cite_text !== null) lines.push(`${indent}  "${edge.cite_text}"`);
  }
  return lines.join("\n");
}

async function loadUpstreamChainEdges(pool: pg.Pool, rootEntityId: string, maxDepth: number): Promise<ChainEdge[]> {
  const depth = Math.min(Math.max(maxDepth, 1), 5);
  const result = await pool.query<ChainEdgeRow>(
    `WITH RECURSIVE walk AS (
       SELECT $1::text AS node_id, ARRAY[$1::text] AS path, 0 AS depth
       UNION ALL
       SELECT next_edge.upstream_id,
              walk.path || next_edge.upstream_id,
              walk.depth + 1
       FROM walk
       JOIN LATERAL (
         SELECT CASE
                  WHEN e.relation IN ('BUYS_FROM','USES_FOUNDRY') AND e.subject_id = walk.node_id THEN e.object_id
                  WHEN e.relation = 'SUPPLIES_TO' AND e.object_id = walk.node_id THEN e.subject_id
                  WHEN e.relation = 'MANUFACTURES_AT' AND e.subject_id = walk.node_id THEN e.object_id
                END AS upstream_id
         FROM edges e
         WHERE e.validity = 'current'
           AND e.evidence_level >= 4
           AND (
             (e.relation IN ('BUYS_FROM','USES_FOUNDRY','MANUFACTURES_AT') AND e.subject_id = walk.node_id)
             OR (e.relation = 'SUPPLIES_TO' AND e.object_id = walk.node_id)
           )
       ) next_edge ON next_edge.upstream_id IS NOT NULL
       WHERE walk.depth < $2
         AND NOT next_edge.upstream_id = ANY(walk.path)
     ),
     chain_edges AS (
       SELECT walk.depth + 1 AS depth,
              e.edge_id, e.relation,
              e.subject_id, s.display_name AS subject_name,
              e.object_id, o.display_name AS object_name,
              CASE
                WHEN e.relation IN ('BUYS_FROM','USES_FOUNDRY','MANUFACTURES_AT') AND e.subject_id = walk.node_id THEN e.object_id
                WHEN e.relation = 'SUPPLIES_TO' AND e.object_id = walk.node_id THEN e.subject_id
              END AS upstream_id,
              CASE
                WHEN e.relation IN ('BUYS_FROM','USES_FOUNDRY','MANUFACTURES_AT') AND e.subject_id = walk.node_id THEN o.display_name
                WHEN e.relation = 'SUPPLIES_TO' AND e.object_id = walk.node_id THEN s.display_name
              END AS upstream_name,
              e.component, e.component_id, e.evidence_level, e.confidence, e.primary_evidence_id, ev.cite_text
       FROM walk
       JOIN edges e ON e.validity = 'current'
        AND e.evidence_level >= 4
        AND (
          (e.relation IN ('BUYS_FROM','USES_FOUNDRY','MANUFACTURES_AT') AND e.subject_id = walk.node_id)
          OR (e.relation = 'SUPPLIES_TO' AND e.object_id = walk.node_id)
        )
       JOIN entity_master s ON s.entity_id = e.subject_id
       JOIN entity_master o ON o.entity_id = e.object_id
       LEFT JOIN evidence ev ON ev.evidence_id = e.primary_evidence_id
       WHERE walk.depth < $2
     )
     SELECT depth, edge_id, relation, subject_id, subject_name, object_id, object_name,
            upstream_id, upstream_name, component, component_id, evidence_level, confidence, primary_evidence_id, cite_text
     FROM chain_edges
     WHERE upstream_id IS NOT NULL
     ORDER BY depth, subject_name, relation, object_name`,
    [rootEntityId, depth]
  );
  return result.rows.map((row) => ({
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
    cite_text: row.cite_text
  }));
}

export function renderComponentCard(card: ComponentCardModel, format: OutputFormat): string {
  if (format === "json") {
    return JSON.stringify({
      schema_version: "1.0.0",
      component: card.component,
      known_suppliers: card.known_suppliers,
      known_consumers: card.known_consumers,
      evidence_edges: card.evidence_edges,
      source_coverage: card.source_coverage,
      unknown_map: card.unknown_map
    }, null, 2);
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

export async function renderEvidence(pool: pg.Pool, evidenceId: string, format: OutputFormat): Promise<string> {
  const evidence = await getEvidence(pool, evidenceId);
  if (evidence === undefined) throw new Error(`Evidence not found: ${evidenceId}`);
  if (format === "json") return JSON.stringify({ schema_version: "1.0.0", evidence }, null, 2);
  return [
    `# Evidence ${evidence.evidence_id}`,
    "",
    `Level: ${evidence.evidence_level}`,
    `Confidence: ${evidence.confidence.toFixed(3)}`,
    `Inferred: ${evidence.is_inferred ? "yes" : "no"}`,
    `Extraction: ${evidence.extraction_method}`,
    `Source: ${evidence.source_adapter_id} ${evidence.source_date?.toISOString().slice(0, 10) ?? ""}`,
    `URL: ${evidence.source_url}`,
    `Source snapshot sha256: ${evidence.source_snapshot_sha256 ?? "(not recorded)"}`,
    `Parser version: ${evidence.parser_version ?? "(not recorded)"}`,
    `Extractor version: ${evidence.extractor_version ?? "(not recorded)"}`,
    `Relation candidate hash: ${evidence.relation_candidate_hash ?? "(not recorded)"}`,
    "",
    "## Edge",
    "",
    evidence.edge_id === null ? "(not attached to an edge)" : `${evidence.subject_name} -${evidence.relation}-> ${evidence.object_name}`,
    "",
    "## Location",
    "",
    `Locator: ${evidence.cite_locator ?? "(not recorded)"}`,
    `Chunk offsets: ${renderOffsets(evidence.cite_start_char, evidence.cite_end_char)}`,
    `Cite sha256: ${evidence.cite_text_sha256 ?? "(not recorded)"}`,
    `Normalized cite sha256: ${evidence.normalized_cite_text_sha256 ?? "(not recorded)"}`,
    "",
    "## Cite text",
    "",
    evidence.cite_text
  ].join("\n");
}

function renderOffsets(start: number | null, end: number | null): string {
  if (start === null || end === null) return "(not recorded)";
  return `${start}-${end}`;
}

export async function renderUnknownMap(pool: pg.Pool, query: string, format: OutputFormat): Promise<string> {
  const entityId = await resolveEntityId(pool, query);
  const items = await listUnknownItems(pool, entityId);
  if (format === "json") return JSON.stringify({ schema_version: "1.0.0", scope: entityId, items }, null, 2);
  return [`# Unknown map [${entityId}]`, "", ...items.flatMap((item) => [`- ${item.question}`, `  Why unknown: ${item.why_unknown}`])].join("\n");
}

export async function renderChanges(pool: pg.Pool, input: ChangeTimelineInput & { format: OutputFormat }): Promise<string> {
  const changes = await listChangeTimeline(pool, input);
  return renderChangeTimelineItems(changes, { format: input.format, since: input.since });
}

export function renderChangeTimelineItems(items: readonly ChangeTimelineItem[], input: { format: OutputFormat; since: string }): string {
  if (input.format === "json") return JSON.stringify({ schema_version: "1.0.0", since: input.since, changes: items }, null, 2);
  const attention = items.filter((item) => item.requires_attention);
  const normal = items.filter((item) => !item.requires_attention);
  const lines = [`# Changes since ${input.since}`, "", `Total: ${items.length}`, `Requires attention: ${attention.length}`];
  appendChangeGroup(lines, "Requires attention", attention);
  appendChangeGroup(lines, "Timeline", normal);
  return lines.join("\n");
}

function appendChangeGroup(lines: string[], title: string, items: readonly ChangeTimelineItem[]): void {
  lines.push("", `## ${title}`, "");
  if (items.length === 0) {
    lines.push("(none)");
    return;
  }
  for (const item of items) {
    lines.push(`- ${item.event_type} ${changePrimaryId(item)} at ${item.occurred_at}`);
    lines.push(`  ${changeSummary(item)}`);
    if (item.source_adapter_id !== undefined) lines.push(`  Source: ${item.source_adapter_id}`);
    if (item.evidence_id !== undefined) lines.push(`  Evidence: ${item.evidence_id}${item.evidence_level === undefined ? "" : ` [Level ${item.evidence_level}]`}`);
    if (item.doc_id !== undefined) lines.push(`  Document: ${item.doc_id}`);
  }
}

function changePrimaryId(item: ChangeTimelineItem): string {
  return item.edge_id ?? item.evidence_id ?? item.doc_id ?? item.source_item_id ?? item.scope_id ?? item.event_id;
}

function changeSummary(item: ChangeTimelineItem): string {
  if (item.event_family === "source") return `Source monitor recorded ${item.event_type.toLowerCase()} for ${item.source_adapter_id ?? "unknown source"}.`;
  if (item.subject_name !== undefined && item.object_name !== undefined && item.relation !== undefined) {
    const component = item.component === undefined ? "" : ` (${item.component})`;
    return `${item.subject_name} -${item.relation}${component}-> ${item.object_name}.`;
  }
  if (item.scope_kind !== undefined && item.scope_id !== undefined) return `${item.scope_kind}:${item.scope_id} changed by ${item.caused_by}.`;
  return `Change ${item.event_id} caused by ${item.caused_by}.`;
}

export async function renderPendingEntities(pool: pg.Pool, input: { status: PendingEntityStatusFilter; limit: number; format: OutputFormat }): Promise<string> {
  const items = await listPendingEntities(pool, { status: input.status, limit: input.limit });
  if (input.format === "json") return JSON.stringify({ schema_version: "1.0.0", pending_entities: items }, null, 2);
  const lines = ["# Pending Entities", "", `Status: ${input.status}`, `Count: ${items.length}`, ""];
  for (const item of items) {
    lines.push(`- ${item.pending_id}: ${item.surface}`);
    lines.push(`  Status: ${item.status}; occurrences: ${item.occurrence_count}; first seen: ${item.first_seen_at.toISOString()}`);
    if (item.resolved_entity_id !== null) lines.push(`  Resolved entity: ${item.resolved_entity_id}`);
    lines.push(`  Next: supplystrata entity pending lookup ${item.pending_id} --source all`);
  }
  return lines.join("\n");
}

export async function renderPendingEntity(pool: pg.Pool, pendingId: string, format: OutputFormat): Promise<string> {
  const item = await getPendingEntity(pool, pendingId);
  if (item === undefined) throw new Error(`Pending entity not found: ${pendingId}`);
  if (format === "json") return JSON.stringify({ schema_version: "1.0.0", pending_entity: item }, null, 2);
  return [
    `# Pending Entity ${item.pending_id}`,
    "",
    `Surface: ${item.surface}`,
    `Status: ${item.status}`,
    `Occurrences: ${item.occurrence_count}`,
    `First seen: ${item.first_seen_at.toISOString()}`,
    item.resolved_entity_id === null ? "Resolved entity: (none)" : `Resolved entity: ${item.resolved_entity_id}`,
    item.reviewer === null ? "Reviewer: (none)" : `Reviewer: ${item.reviewer}`,
    "",
    "## Context",
    "",
    JSON.stringify(item.context, null, 2),
    "",
    "## Next",
    "",
    `supplystrata entity pending lookup ${item.pending_id} --source all`,
    `supplystrata review enqueue entity-source "${item.surface}" --source <source>`
  ].join("\n");
}

async function loadCompanyEdges(pool: pg.Pool, entityId: string): Promise<CompanyEdgeRow[]> {
  const result = await pool.query<CompanyEdgeRow>(
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
     ORDER BY e.evidence_level DESC, e.confidence DESC, o.display_name`,
    [entityId]
  );
  return result.rows;
}

async function resolveComponent(pool: pg.Pool, query: string): Promise<ComponentHeaderRow> {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) throw new Error("Component query must not be empty");
  const result = await pool.query<ComponentHeaderRow>(
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

async function loadComponentEdges(pool: pg.Pool, component: ComponentHeaderRow): Promise<ComponentEdgeRow[]> {
  const result = await pool.query<ComponentEdgeRow>(
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

function componentEdgeDirection(row: ComponentEdgeRow): { supplier_id: string; supplier_name: string; consumer_id: string; consumer_name: string } {
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
  return [...byEntity.values()].sort((left, right) =>
    right.best_evidence_level - left.best_evidence_level ||
    right.best_confidence - left.best_confidence ||
    left.name.localeCompare(right.name)
  );
}

function summarizeComponentSourceCoverage(edges: readonly ComponentEvidenceEdge[]): { sources: number; evidence_edges: number; latest_source_date: string | null } {
  const sources = new Set<string>();
  let latestSourceDate: string | null = null;
  for (const edge of edges) {
    if (edge.source_url !== null) sources.add(edge.source_url);
    if (edge.source_date !== null) {
      const sourceDate = edge.source_date.toISOString().slice(0, 10);
      if (latestSourceDate === null || sourceDate > latestSourceDate) latestSourceDate = sourceDate;
    }
  }
  return { sources: sources.size, evidence_edges: edges.length, latest_source_date: latestSourceDate };
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

function appendSourceCoverage(lines: string[], coverage: { sources: number; evidence_edges: number; latest_source_date: string | null }): void {
  lines.push(`- Evidence edges: ${coverage.evidence_edges}`);
  lines.push(`- Distinct source URLs: ${coverage.sources}`);
  lines.push(`- Latest source date: ${coverage.latest_source_date ?? "(none)"}`);
}
