import type { EvidenceLevel, ObservationType, RelationType } from "@supplystrata/core";
import type { OutputFormat } from "./types.js";
import type { UnknownMapItem } from "./unknown.js";

export interface ComponentHeader {
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
  source_date: string | null;
}

export interface ComponentObservation {
  observation_id: string;
  observation_type: ObservationType;
  source_adapter_id: string;
  source_item_id: string | null;
  doc_id: string | null;
  scope_kind: string;
  scope_id: string;
  geography_kind: string | null;
  geography_id: string | null;
  component_id: string | null;
  metric_name: string;
  metric_value: string | null;
  metric_unit: string | null;
  time_window_start: string | null;
  time_window_end: string | null;
  baseline_value: string | null;
  change_value: string | null;
  change_percent: number | null;
  confidence: number;
  provenance: Record<string, unknown>;
  attrs: Record<string, unknown>;
  created_at: string;
}

export interface ComponentCardModel {
  component: ComponentHeader;
  known_suppliers: ComponentParticipant[];
  known_consumers: ComponentParticipant[];
  evidence_edges: ComponentEvidenceEdge[];
  source_coverage: {
    sources: number;
    evidence_edges: number;
    latest_source_date: string | null;
  };
  related_observations: ComponentObservation[];
  unknown_map: UnknownMapItem[];
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
    if (edge.source_date !== null) lines.push(`  Source date: ${edge.source_date.slice(0, 10)}`);
    if (edge.cite_text !== null) lines.push(`  "${edge.cite_text}"`);
    if (edge.primary_evidence_id !== null) lines.push(`  Evidence: ${edge.primary_evidence_id}`);
  }
}

function appendRelatedObservations(lines: string[], observations: readonly ComponentObservation[]): void {
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
