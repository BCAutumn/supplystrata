import type { ChainViewModel, ChainViewSegmentModel } from "@supplystrata/chain-view";
import type { OutputFormat } from "./types.js";

export type { ChainViewModel, ChainViewSegmentModel };

export function renderChainCard(model: ChainViewModel, format: OutputFormat): string {
  if (format === "json") return JSON.stringify(model, null, 2);

  const lines = [
    `# Supply Chain ${model.root.name} [${model.root.id}]`,
    "",
    `Max depth: ${model.max_depth}`,
    `Segments: ${model.segments.length}`,
    `Fact edges: ${model.stats.fact_edges}`,
    `Claims: ${model.stats.claims}`,
    `Observations: ${model.stats.observations}`,
    `Leads: ${model.stats.leads}`,
    `Unknowns: ${model.stats.unknowns}`,
    "",
    "## Chain segments",
    ""
  ];
  if (model.segments.length === 0) {
    lines.push("(no Level 4-5 upstream chain segments yet)");
    return lines.join("\n");
  }
  for (const segment of model.segments) {
    appendSegment(lines, segment);
  }
  return lines.join("\n");
}

function appendSegment(lines: string[], segment: ChainViewSegmentModel): void {
  const indent = "  ".repeat(Math.max(segment.depth - 1, 0));
  const component = segment.component === null ? "" : ` (${segment.component})`;
  lines.push(`${indent}- ${segment.semantic_layer} depth ${segment.depth}: ${segment.from.name} -${segment.relation}${component}-> ${segment.to.name}`);
  lines.push(`${indent}  ${segment.label}`);
  lines.push(`${indent}  From: ${segment.from.name} [${segment.from.id}]`);
  lines.push(`${indent}  To: ${segment.to.name} [${segment.to.id}]`);
  lines.push(`${indent}  ${formatSegmentConfidence(segment)}`);
  if (segment.edge_id !== undefined) lines.push(`${indent}  Edge: ${segment.edge_id}`);
  if (segment.claim_id !== undefined) lines.push(`${indent}  Claim: ${segment.claim_id}`);
  if (segment.observation_id !== undefined) lines.push(`${indent}  Observation: ${segment.observation_id}`);
  if (segment.lead_id !== undefined) lines.push(`${indent}  Lead: ${segment.lead_id}`);
  if (segment.unknown_id !== undefined) lines.push(`${indent}  Unknown: ${segment.unknown_id}`);
}

function formatSegmentConfidence(segment: ChainViewSegmentModel): string {
  const evidence = segment.evidence_level === undefined ? "Context" : `Evidence: Level ${segment.evidence_level}`;
  return `${evidence}, conf ${segment.confidence.toFixed(3)}${formatEvidence(segment.evidence_ids)}`;
}

function formatEvidence(evidenceIds: readonly string[]): string {
  if (evidenceIds.length === 0) return "";
  return `, ${evidenceIds.join(", ")}`;
}
