import type pg from "pg";
import { getEvidence, getPendingEntity, listPendingEntities, listUnknownItems, resolveEntityId, type PendingEntityStatusFilter } from "@supplystrata/db";
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
    "",
    "## Edge",
    "",
    evidence.edge_id === null ? "(not attached to an edge)" : `${evidence.subject_name} -${evidence.relation}-> ${evidence.object_name}`,
    "",
    "## Cite text",
    "",
    evidence.cite_text
  ].join("\n");
}

export async function renderUnknownMap(pool: pg.Pool, query: string, format: OutputFormat): Promise<string> {
  const entityId = await resolveEntityId(pool, query);
  const items = await listUnknownItems(pool, entityId);
  if (format === "json") return JSON.stringify({ schema_version: "1.0.0", scope: entityId, items }, null, 2);
  return [`# Unknown map [${entityId}]`, "", ...items.flatMap((item) => [`- ${item.question}`, `  Why unknown: ${item.why_unknown}`])].join("\n");
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
