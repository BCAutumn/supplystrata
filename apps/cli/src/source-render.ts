import type { OutputFormat } from "@supplystrata/render";
import type { SourceManagementCatalog } from "@supplystrata/source-management";
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

export function renderSourceManagementCatalog(catalog: SourceManagementCatalog, format: OutputFormat): string {
  if (format === "json") return JSON.stringify(catalog, null, 2);
  const lines = ["# Source Management Catalog", "", `Sources: ${catalog.sources.length}`, ""];
  for (const item of catalog.sources) {
    lines.push(`- ${item.source.id} [${item.source.tier}] ${item.config_mode}`);
    lines.push(`  Name: ${item.source.name}`);
    lines.push(`  Category: ${item.source.category}; automation: ${item.source.automation}; status: ${item.source.status}`);
    lines.push(`  Output authority: ${item.source.relation_authority}; evidence cap: ${item.source.evidence_level_cap}`);
    lines.push(`  Credentials: ${item.source.requires_key ? "required" : "not required"}`);
    lines.push(`  Connectors: ${item.connector_keys.length === 0 ? "none" : item.connector_keys.join(", ")}`);
    for (const [targetKind, schema] of Object.entries(item.target_config_schemas)) {
      const required = schema.fields.filter((field) => field.required).map((field) => field.key);
      lines.push(`  Config ${targetKind}: required ${required.length === 0 ? "none" : required.join(", ")}`);
    }
    lines.push("");
  }
  if (catalog.unregistered_connector_keys.length > 0) {
    lines.push("## Registry Gaps", "");
    for (const key of catalog.unregistered_connector_keys) lines.push(`- ${key}`);
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
    if (item.suggested_check_targets.length > 0) {
      lines.push(`  Suggested check targets: ${item.suggested_check_targets.length}`);
      for (const target of item.suggested_check_targets.slice(0, 4)) {
        lines.push(`    - ${target.runnable ? "runnable" : "planned"} ${target.target_kind}: ${formatTargetConfig(target.target_config)}`);
        lines.push(`      Reason: ${target.reason}`);
      }
      if (item.suggested_check_targets.length > 4) lines.push(`    More target suggestions: ${item.suggested_check_targets.length - 4}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function formatTargetConfig(config: Record<string, string | number | boolean | string[]>): string {
  return Object.entries(config)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join("|") : String(value)}`)
    .join("; ");
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
