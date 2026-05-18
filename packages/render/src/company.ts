import type { ComponentSpecificity, EvidenceLevel, RelationType } from "@supplystrata/core";
import type { OutputFormat } from "./types.js";
import type { UnknownMapItem } from "./unknown.js";

export interface CompanyCardEntity {
  entity_id: string;
  canonical_name: string;
  display_name: string;
}

export interface CompanyCardEdge {
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
  source_date: string | null;
}

export interface CompanyCardModel {
  entity: CompanyCardEntity;
  directly_disclosed_upstream: CompanyCardEdge[];
  directly_disclosed_downstream: CompanyCardEdge[];
  unknown_map: UnknownMapItem[];
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

function appendCompanyEdges(lines: string[], edges: readonly CompanyCardEdge[]): void {
  for (const edge of edges) {
    const component = edge.component === null ? "" : ` (${edge.component})`;
    lines.push(`- ${edge.relation}${component} -> ${edge.counterparty_name} [Level ${edge.evidence_level}, conf ${edge.confidence.toFixed(3)}]`);
    if (edge.source_date !== null) lines.push(`  Source date: ${edge.source_date.slice(0, 10)}`);
    if (edge.cite_text !== null) lines.push(`  "${edge.cite_text}"`);
    if (edge.primary_evidence_id !== null) lines.push(`  Evidence: ${edge.primary_evidence_id}`);
    lines.push("");
  }
}
