import type { DataQualitySummary } from "@supplystrata/data-quality";
import type { OutputFormat } from "@supplystrata/render";

export function renderDataQuality(summary: DataQualitySummary, format: OutputFormat): string {
  if (format === "json") return JSON.stringify({ schema_version: "1.0.0", ...summary }, null, 2);

  const lines = [
    "# Data Quality",
    "",
    `OK: ${summary.ok ? "yes" : "no"}`,
    `Checked at: ${summary.checked_at}`,
    `Errors: ${summary.counts.error}`,
    `Warnings: ${summary.counts.warn}`,
    `Info: ${summary.counts.info}`,
    ""
  ];

  if (summary.issues.length === 0) {
    lines.push("(no issues)");
    return lines.join("\n");
  }

  lines.push("## Issues", "");
  for (const item of summary.issues) {
    lines.push(`- [${item.severity}] ${item.rule_id}: ${item.scope_kind}/${item.scope_id}`);
    lines.push(`  ${item.message}`);
    if (Object.keys(item.detail).length > 0) {
      lines.push(`  Detail: ${JSON.stringify(item.detail)}`);
    }
  }
  return lines.join("\n");
}
