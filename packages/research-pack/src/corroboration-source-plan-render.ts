import { CORROBORATION_SOURCE_PLAN_ACTION_BATCHES, type CorroborationSourcePlan } from "./corroboration-source-plan-definitions.js";

export function renderCorroborationSourcePlanMarkdown(plan: CorroborationSourcePlan): string {
  const lines = [
    `# Corroboration Source Plan ${plan.company_id}`,
    "",
    `Generated at: ${plan.generated_at}`,
    "",
    "This file is a filtered source-plan for edge-level corroboration reviews. It is executable by the existing source target commands, but it does not fetch sources, write observations, or create fact edges by itself.",
    "",
    "## Summary",
    "",
    `- Review edges: ${plan.summary.review_edges}`,
    `- Disposition-only edges: ${plan.summary.disposition_only_edges}`,
    `- Source-plan items: ${plan.summary.source_plan_items}`,
    `- Runnable targets: ${plan.summary.runnable_targets}`,
    `- Need sync: ${plan.summary.targets_need_sync}`,
    `- Need enable: ${plan.summary.targets_need_enable}`,
    `- Due: ${plan.summary.targets_due}`,
    `- Failed preflight: ${plan.summary.targets_failed_preflight}`,
    `- Missing credentials: ${plan.summary.targets_missing_credentials}`,
    `- By next action: ${formatCountMap(plan.summary.by_next_action)}`,
    `- By source: ${formatCountMap(plan.summary.by_source)}`,
    "",
    "## Action Batches",
    "",
    "Use the action-specific source-plan files when they are present, so smoke/sync/enable/run-due steps stay aligned with the audited next action for each target.",
    "",
    ...CORROBORATION_SOURCE_PLAN_ACTION_BATCHES.map(
      (batch) => `- ${batch.file_name}: ${batch.next_actions.join(", ")} targets for ${batch.kind.replace("_", "-")} execution`
    ),
    "",
    "## Targets",
    ""
  ];
  if (plan.target_refs.length === 0) {
    lines.push("No runnable corroboration source targets. Record explicit single-source disposition for disposition-only edges.");
    return lines.join("\n");
  }
  for (const target of plan.target_refs) {
    const coverage = target.coverage_state === null ? "no coverage" : target.coverage_state;
    const preflight =
      target.preflight_status === null
        ? "no preflight"
        : `${target.preflight_status}${target.preflight_issue_kind === null ? "" : `/${target.preflight_issue_kind}`}`;
    lines.push(`- ${target.source_adapter_id}/${target.target_kind}: ${coverage}; ${preflight}`);
    lines.push(`  Next action: ${target.next_action} — ${target.next_action_reason}`);
    lines.push(
      `  Backlog: ${target.backlog_id}; edges=${target.edge_ids.join(",")}; unknowns=${target.unknown_ids.length === 0 ? "none" : target.unknown_ids.join(",")}`
    );
    if (target.check_target_id !== null) lines.push(`  Source target: ${target.check_target_id}`);
    if (target.preflight_missing_credential_env_keys.length > 0) {
      lines.push(`  Missing credentials: ${target.preflight_missing_credential_env_keys.join(", ")}`);
    }
  }
  return lines.join("\n");
}

function formatCountMap(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) return "none";
  return entries.map(([key, count]) => `${key}=${count}`).join(", ");
}
