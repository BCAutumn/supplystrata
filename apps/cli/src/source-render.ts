import type { OutputFormat } from "@supplystrata/render";
import type { SourceManagementCatalog, SourcePlanTargetPreviewReport } from "@supplystrata/source-management";
import type { DueSourceCheckRow, SourceHealthRow } from "@supplystrata/source-monitor";
import type { SourcePlanItem } from "@supplystrata/source-plan";
import type { SourceRegistryEntry } from "@supplystrata/source-registry";
import type { SourcePlanSmokeReport } from "@supplystrata/source-workflows";

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
    for (const [targetKind, requirements] of Object.entries(item.target_credential_requirements)) {
      const envKeys = requirements.filter((requirement) => requirement.required).map((requirement) => requirement.env_key);
      lines.push(`  Credentials ${targetKind}: ${envKeys.length === 0 ? "none" : envKeys.join(", ")}`);
    }
    lines.push("");
  }
  if (catalog.unregistered_connector_keys.length > 0) {
    lines.push("## Registry Gaps", "");
    for (const key of catalog.unregistered_connector_keys) lines.push(`- ${key}`);
  }
  return lines.join("\n");
}

export function renderSourcePlanTargetPreview(report: SourcePlanTargetPreviewReport, format: OutputFormat): string {
  if (format === "json") return JSON.stringify(report, null, 2);
  const lines = [
    "# Source Plan Target Preview",
    "",
    `Namespace: ${report.namespace}`,
    `Source plan items: ${report.summary.source_plan_items}`,
    `Runnable suggestions: ${report.summary.runnable_suggestions}`,
    `Generated targets: ${report.summary.generated_targets}`,
    `Duplicate suggestions skipped: ${report.summary.duplicate_targets_skipped}`,
    `Enabled targets: ${report.summary.enabled_targets}`,
    `Targets requiring credentials: ${report.summary.targets_requiring_credentials}`,
    `Validation: ${report.validation.ok ? "ok" : "blocked"} (${report.summary.validation_errors} errors, ${report.summary.validation_warnings} warnings)`,
    ""
  ];
  lines.push("## By Source", "");
  for (const [source, count] of Object.entries(report.summary.by_source)) lines.push(`- ${source}: ${count}`);
  lines.push("", "## By Target Kind", "");
  for (const [targetKind, count] of Object.entries(report.summary.by_target_kind)) lines.push(`- ${targetKind}: ${count}`);
  if (report.validation.errors.length > 0) {
    lines.push("", "## Errors", "");
    for (const issue of report.validation.errors) lines.push(`- ${issue.message}`);
  }
  if (report.validation.warnings.length > 0) {
    lines.push("", "## Warnings", "");
    for (const issue of report.validation.warnings) lines.push(`- ${issue.message}`);
  }
  lines.push("", "## Target IDs", "");
  for (const targetId of report.target_ids) lines.push(`- ${targetId}`);
  return lines.join("\n");
}

export function renderSourcePlanSmokeReport(report: SourcePlanSmokeReport, format: OutputFormat): string {
  if (format === "json") return JSON.stringify(report, null, 2);
  const lines = [
    "# Source Plan Smoke",
    "",
    `Requested targets: ${report.summary.requested_targets}`,
    `Selected targets: ${report.summary.selected_targets}`,
    `Checked targets: ${report.summary.checked_targets}`,
    `Failed targets: ${report.summary.failed_targets}`,
    `Skipped targets: ${report.summary.skipped_targets}`,
    `Planned tasks: ${report.summary.planned_tasks}`,
    `Fetched documents: ${report.summary.fetched_documents}`,
    `Normalized documents: ${report.summary.normalized_documents}`,
    `Degraded documents: ${report.summary.degraded_documents}`,
    "",
    "## By Source",
    ""
  ];
  for (const [source, count] of Object.entries(report.summary.by_source)) lines.push(`- ${source}: ${count}`);
  lines.push("", "## Source Readiness Matrix", "");
  for (const [source, summary] of Object.entries(report.summary.by_source_status)) {
    const targetKinds = Object.entries(summary.target_kinds)
      .map(([targetKind, count]) => `${targetKind}:${count}`)
      .join(", ");
    const issueKinds = Object.entries(summary.issue_kinds)
      .map(([issueKind, count]) => `${issueKind}:${count}`)
      .join(", ");
    lines.push(
      `- ${source}: checked=${summary.checked_targets}; failed=${summary.failed_targets}; skipped=${summary.skipped_targets}; normalized=${summary.normalized_documents}; degraded=${summary.degraded_documents}; target_kinds=${targetKinds.length === 0 ? "none" : targetKinds}; issue_kinds=${issueKinds.length === 0 ? "none" : issueKinds}`
    );
  }
  lines.push("", "## Targets", "");
  for (const item of report.items) {
    lines.push(`- ${item.status} ${item.check_target_id} (${item.source_adapter_id}/${item.target_kind})`);
    lines.push(
      `  Tasks: ${item.planned_tasks}; fetched: ${item.fetched_documents}; normalized: ${item.normalized_documents}; degraded: ${item.degraded_documents}`
    );
    if (item.issue_kind !== undefined) lines.push(`  Issue kind: ${item.issue_kind}`);
    if (item.error_message !== undefined) lines.push(`  Error: ${item.error_message}`);
    for (const document of item.documents.slice(0, 3)) {
      lines.push(
        `  - ${document.task_id}: ${document.document_type ?? "raw"}${document.source_date === undefined ? "" : ` @ ${document.source_date}`} (${document.text_chars ?? 0} chars)`
      );
      lines.push(`    URL: ${document.source_url}`);
    }
    if (item.documents.length > 3) lines.push(`  More documents: ${item.documents.length - 3}`);
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
