import type { OutputFormat } from "@supplystrata/render";
import type { DueSourceCheckRow, SourceHealthRow } from "@supplystrata/source-monitor";
import type { SourcePlanItem } from "@supplystrata/source-plan";
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
    lines.push(
      `  Policy: ${source.policy_enabled === false ? "disabled" : "enabled"}; cadence: ${formatMinutes(source.check_cadence_minutes)}; next: ${formatDate(source.next_check_at)}`
    );
    lines.push(`  Last checked: ${formatDate(source.last_checked_at)}; last success: ${formatDate(source.last_success_at)}; failures: ${source.failure_count}`);
    lines.push(`  Last change: ${formatDate(source.last_change_at)}`);
    if (source.last_error_message !== null) lines.push(`  Last error: ${source.last_error_message}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderDueSources(sources: DueSourceCheckRow[], format: OutputFormat): string {
  if (format === "json") return JSON.stringify({ schema_version: "1.0.0", sources }, null, 2);
  const lines = ["# Due Source Checks", "", `Count: ${sources.length}`, ""];
  for (const source of sources) {
    lines.push(`- ${source.check_target_id} (${source.source_adapter_id})`);
    lines.push(`  Kind: ${source.target_kind}; subject: ${source.subject_entity_id ?? "n/a"}`);
    lines.push(
      `  Priority: ${source.policy_priority}/${source.target_priority}; cadence: ${formatMinutes(source.check_cadence_minutes)}; next: ${formatDate(source.next_check_at)}`
    );
    lines.push(`  Config: ${source.target_config_source}${source.target_notes === null ? "" : `; notes: ${source.target_notes}`}`);
  }
  return lines.join("\n");
}

export function renderSourcePlan(plan: SourcePlanItem[], format: OutputFormat): string {
  if (format === "json") return JSON.stringify({ schema_version: "1.0.0", source_plan: plan }, null, 2);
  const lines = ["# Source Plan", "", `Count: ${plan.length}`, ""];
  for (const item of plan) {
    lines.push(`- ${item.source_id} [${item.priority}] ${item.status}`);
    lines.push(`  Name: ${item.source_name}`);
    lines.push(`  Purpose: ${item.purpose}; output: ${item.expected_output_layer}; policy: ${item.relation_policy}`);
    lines.push(`  Automation: ${item.automation}; key: ${item.requires_key ? "yes" : "no"}`);
    lines.push(`  Parent components: ${item.parent_component_ids.join(", ")}`);
    lines.push(`  Targets: ${item.target_ids.join(", ")}`);
    lines.push(`  Triggers: ${item.trigger_dependency_ids.join(", ")}`);
    for (const reason of item.reasons.slice(0, 3)) lines.push(`  Reason: ${reason}`);
    if (item.reasons.length > 3) lines.push(`  More reasons: ${item.reasons.length - 3}`);
    lines.push("");
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
