import type { EvidenceLevel, ExtractionMethod, RelationType } from "@supplystrata/core";
import type { OutputFormat } from "./types.js";

export interface EvidenceCardModel {
  evidence_id: string;
  edge_id: string | null;
  superseded_by: string | null;
  cite_text: string;
  cite_locator: string | null;
  cite_start_char: number | null;
  cite_end_char: number | null;
  cite_text_sha256: string | null;
  normalized_cite_text_sha256: string | null;
  source_snapshot_sha256: string | null;
  parser_version: string | null;
  extractor_version: string | null;
  relation_candidate_hash: string | null;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  extraction_method: ExtractionMethod;
  source_url: string;
  source_date: string | null;
  fetched_at: string;
  source_adapter_id: string;
  document_type: string;
  subject_name: string | null;
  object_name: string | null;
  relation: RelationType | null;
}

export function renderEvidenceCard(evidence: EvidenceCardModel, format: OutputFormat): string {
  if (format === "json") return JSON.stringify({ schema_version: "1.0.0", evidence }, null, 2);
  return [
    `# Evidence ${evidence.evidence_id}`,
    "",
    `Level: ${evidence.evidence_level}`,
    `Confidence: ${evidence.confidence.toFixed(3)}`,
    `Inferred: ${evidence.is_inferred ? "yes" : "no"}`,
    `Extraction: ${evidence.extraction_method}`,
    `Source: ${evidence.source_adapter_id} ${evidence.source_date?.slice(0, 10) ?? ""}`,
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
