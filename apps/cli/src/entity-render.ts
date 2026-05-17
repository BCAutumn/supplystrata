import type { EntityLookupSummary } from "@supplystrata/pipeline";
import type { OutputFormat } from "@supplystrata/render";

export function renderEntityLookup(result: EntityLookupSummary, format: OutputFormat): string {
  if (format === "json") return JSON.stringify({ schema_version: "1.0.0", lookup: result }, null, 2);
  const lines = ["# Entity Source Lookup", "", `Query: ${result.query}`, ""];
  for (const source of result.results) {
    lines.push(`## ${source.source_adapter_id}`);
    if (source.source_url !== undefined) lines.push(`Source URL: ${source.source_url}`);
    if (source.error_message !== undefined) {
      lines.push(`Error: ${source.error_message}`, "");
      continue;
    }
    if (source.candidates.length === 0) {
      lines.push("No candidates.", "");
      continue;
    }
    for (const candidate of source.candidates) {
      lines.push(`- ${candidate.name} (${candidate.external_id})`);
      lines.push(
        `  Status: ${candidate.current_status ?? "unknown"}; jurisdiction: ${candidate.jurisdiction_code ?? "unknown"}; confidence: ${candidate.confidence.toFixed(2)}`
      );
      if (candidate.company_number !== undefined) lines.push(`  Company number: ${candidate.company_number}`);
      if (candidate.registered_address !== undefined) lines.push(`  Address: ${candidate.registered_address}`);
      if (candidate.previous_names.length > 0) lines.push(`  Former names: ${candidate.previous_names.join("; ")}`);
      if (candidate.alternative_names.length > 0) lines.push(`  Alternative names: ${candidate.alternative_names.join("; ")}`);
      lines.push(`  Provenance: ${candidate.provenance_note}`);
    }
    lines.push("");
  }
  lines.push("Lookup 只输出外部候选，不自动写入 entity_master 或 entity_alias。合并实体必须由显式 review/import 流程完成。");
  return lines.join("\n");
}
