import type { OutputFormat } from "@supplystrata/render";
import type { SourceRegistryEntry } from "@supplystrata/source-registry";

export function renderSourcesList(sources: SourceRegistryEntry[], format: OutputFormat): string {
  if (format === "json") return JSON.stringify({ schema_version: "1.0.0", sources }, null, 2);
  const lines = ["# Source Registry", ""];
  for (const source of sources) {
    lines.push(`- ${source.id} [${source.tier}] ${source.status}`);
    lines.push(`  Name: ${source.name}`);
    lines.push(`  Evidence cap: ${source.evidence_level_cap}; automation: ${source.automation}; key: ${source.requires_key ? "yes" : "no"}`);
    lines.push(`  URL: ${source.official_url}`);
    lines.push(`  Notes: ${source.notes}`);
    lines.push("");
  }
  return lines.join("\n");
}
