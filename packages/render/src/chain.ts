import type pg from "pg";
import { buildCompanyChainView, type ChainViewModel, type ChainViewSegmentModel } from "@supplystrata/chain-view";

type OutputFormat = "markdown" | "json";

export type { ChainViewModel, ChainViewSegmentModel };

export async function renderChain(pool: pg.Pool, query: string, input: { depth: number; format: OutputFormat }): Promise<string> {
  const model = await buildCompanyChainView(pool, { query, depth: input.depth });
  return renderChainCard(model, input.format);
}

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
  const indent = "  ".repeat(segment.depth - 1);
  const component = segment.component === null ? "" : ` (${segment.component})`;
  lines.push(`${indent}- ${segment.semantic_layer} depth ${segment.depth}: ${segment.from.name} -${segment.relation}${component}-> ${segment.to.name}`);
  lines.push(`${indent}  ${segment.label}`);
  lines.push(`${indent}  From: ${segment.from.name} [${segment.from.id}]`);
  lines.push(`${indent}  To: ${segment.to.name} [${segment.to.id}]`);
  lines.push(`${indent}  Evidence: Level ${segment.evidence_level}, conf ${segment.confidence.toFixed(3)}${formatEvidence(segment.evidence_ids)}`);
  if (segment.edge_id !== undefined) lines.push(`${indent}  Edge: ${segment.edge_id}`);
  if (segment.claim_id !== undefined) lines.push(`${indent}  Claim: ${segment.claim_id}`);
}

function formatEvidence(evidenceIds: readonly string[]): string {
  if (evidenceIds.length === 0) return "";
  return `, ${evidenceIds.join(", ")}`;
}
