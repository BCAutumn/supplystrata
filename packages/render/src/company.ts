import type pg from "pg";
import type { DbClient } from "@supplystrata/db";
import { listUnknownItems, resolveEntityId } from "@supplystrata/db";
import type { EvidenceLevel, RelationType } from "@supplystrata/core";
import type { OutputFormat } from "./types.js";

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

interface CompanyHeaderRow extends pg.QueryResultRow {
  entity_id: string;
  canonical_name: string;
  display_name: string;
}

export interface CompanyCardModel {
  entity: CompanyHeaderRow;
  directly_disclosed_upstream: CompanyEdgeRow[];
  directly_disclosed_downstream: CompanyEdgeRow[];
  unknown_map: Awaited<ReturnType<typeof listUnknownItems>>;
}

export async function loadCompanyCard(client: DbClient, query: string): Promise<CompanyCardModel> {
  const entityId = await resolveEntityId(client, query);
  const headerResult = await client.query<CompanyHeaderRow>("SELECT entity_id, canonical_name, display_name FROM entity_master WHERE entity_id = $1", [
    entityId
  ]);
  const header = headerResult.rows[0];
  if (header === undefined) throw new Error(`Entity not found: ${entityId}`);
  const upstreamEdges = await loadCompanyEdges(client, entityId, "upstream");
  const downstreamEdges = await loadCompanyEdges(client, entityId, "downstream");
  const unknownItems = await listUnknownItems(client, entityId);
  return {
    entity: header,
    directly_disclosed_upstream: upstreamEdges,
    directly_disclosed_downstream: downstreamEdges,
    unknown_map: unknownItems
  };
}

export async function renderCompany(client: DbClient, query: string, format: OutputFormat): Promise<string> {
  return renderCompanyCard(await loadCompanyCard(client, query), format);
}

export function renderCompanyCard(card: CompanyCardModel, format: OutputFormat): string {
  if (format === "json") {
    return JSON.stringify(
      {
        schema_version: "1.0.0",
        entity: card.entity,
        directly_disclosed_upstream: card.directly_disclosed_upstream,
        directly_disclosed_downstream: card.directly_disclosed_downstream,
        unknown_map: card.unknown_map
      },
      null,
      2
    );
  }

  const lines = [`# ${card.entity.canonical_name} [${card.entity.entity_id}]`, "", "## Directly disclosed upstream (Level 4-5)", ""];
  if (card.directly_disclosed_upstream.length === 0) {
    lines.push("(no directly disclosed upstream edges yet)", "");
  }
  appendCompanyEdges(lines, card.directly_disclosed_upstream);
  lines.push("## Directly disclosed downstream customers (Level 4-5)", "");
  if (card.directly_disclosed_downstream.length === 0) {
    lines.push("(no directly disclosed downstream edges yet)", "");
  }
  appendCompanyEdges(lines, card.directly_disclosed_downstream);
  lines.push("## Unknown map", "");
  for (const item of card.unknown_map) {
    lines.push(`- ${item.question}`);
    lines.push(`  Why unknown: ${item.why_unknown}`);
  }
  return lines.join("\n");
}

function appendCompanyEdges(lines: string[], edges: readonly CompanyEdgeRow[]): void {
  for (const edge of edges) {
    const component = edge.component === null ? "" : ` (${edge.component})`;
    lines.push(`- ${edge.relation}${component} -> ${edge.counterparty_name} [Level ${edge.evidence_level}, conf ${edge.confidence.toFixed(3)}]`);
    if (edge.source_date !== null) lines.push(`  Source date: ${edge.source_date.toISOString().slice(0, 10)}`);
    if (edge.cite_text !== null) lines.push(`  "${edge.cite_text}"`);
    if (edge.primary_evidence_id !== null) lines.push(`  Evidence: ${edge.primary_evidence_id}`);
    lines.push("");
  }
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
