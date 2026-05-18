import type { DbClient } from "@supplystrata/db";
import { getEvidence } from "@supplystrata/db";
import type { OutputFormat } from "./types.js";

export async function renderEvidence(client: DbClient, evidenceId: string, format: OutputFormat): Promise<string> {
  const evidence = await getEvidence(client, evidenceId);
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
