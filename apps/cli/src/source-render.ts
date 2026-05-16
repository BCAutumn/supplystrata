import type { OutputFormat } from "@supplystrata/render";
import type { SourceHealthRow, SourcePolicyRow } from "@supplystrata/source-monitor";
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

export function renderSourceHealth(sources: SourceHealthRow[], format: OutputFormat): string {
  if (format === "json") return JSON.stringify({ schema_version: "1.0.0", sources }, null, 2);
  const lines = ["# Source Health", ""];
  for (const source of sources) {
    lines.push(`- ${source.source_adapter_id} [${source.tier}] ${source.registry_status}`);
    lines.push(`  Automation: ${source.automation}; category: ${source.category}; key: ${source.requires_key ? "yes" : "no"}`);
    lines.push(`  Policy: ${source.policy_enabled === false ? "disabled" : "enabled"}; cadence: ${formatMinutes(source.check_cadence_minutes)}; next: ${formatDate(source.next_check_at)}`);
    lines.push(`  Last checked: ${formatDate(source.last_checked_at)}; last success: ${formatDate(source.last_success_at)}; failures: ${source.failure_count}`);
    lines.push(`  Last change: ${formatDate(source.last_change_at)}`);
    if (source.last_error_message !== null) lines.push(`  Last error: ${source.last_error_message}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderDueSources(sources: SourcePolicyRow[], format: OutputFormat): string {
  if (format === "json") return JSON.stringify({ schema_version: "1.0.0", sources }, null, 2);
  const lines = ["# Due Source Checks", "", `Count: ${sources.length}`, ""];
  for (const source of sources) {
    lines.push(`- ${source.source_adapter_id}`);
    lines.push(`  Priority: ${source.priority}; cadence: ${formatMinutes(source.check_cadence_minutes)}; next: ${formatDate(source.next_check_at)}`);
    lines.push(`  Config: ${source.config_source}${source.notes === null ? "" : `; notes: ${source.notes}`}`);
  }
  return lines.join("\n");
}

function formatDate(value: Date | null): string {
  return value === null ? "never" : value.toISOString();
}

function formatMinutes(value: number | null): string {
  if (value === null) return "unknown";
  if (value % 1440 === 0) return `${value / 1440}d`;
  if (value % 60 === 0) return `${value / 60}h`;
  return `${value}m`;
}
