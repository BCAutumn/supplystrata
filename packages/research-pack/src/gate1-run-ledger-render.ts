import type { Gate1RunAction, Gate1RunLedger } from "./gate1-run-ledger-definitions.js";

export function renderGate1RunLedgerMarkdown(ledger: Gate1RunLedger): string {
  const lines = [
    `# Gate 1 Run Ledger ${ledger.company_id}`,
    "",
    `Generated at: ${ledger.generated_at}`,
    `Mainline phase: ${ledger.mainline_phase}`,
    `Reason: ${ledger.phase_reason}`,
    "",
    "This ledger is a deterministic execution map. It does not fetch sources, write observations, or create fact edges.",
    "",
    "## Scorecard",
    "",
    `- Status: ${ledger.scorecard.status}`,
    `- Overall: ${formatPercent(ledger.scorecard.overall_progress)}`,
    `- Data progress: ${formatPercent(ledger.scorecard.data_progress)}`,
    `- Source path progress: ${formatPercent(ledger.scorecard.source_path_progress)}`,
    `- L4/L5 fact edges: ${ledger.scorecard.l4_l5_fact_edges}/${ledger.scorecard.l4_l5_fact_edge_target}`,
    `- Cross-source ratio: ${formatPercent(ledger.scorecard.cross_source_ratio)}/${formatPercent(ledger.scorecard.cross_source_target)}`,
    `- Traceability: ${ledger.scorecard.traceable_edges}/${ledger.scorecard.traceable_edge_target}`,
    "",
    "## Data Progress",
    "",
    `- Fact edge gap: ${ledger.data_progress.fact_edge_gap}`,
    `- Single-source edges: ${ledger.data_progress.single_source_edges}`,
    `- Corroboration queue: ${ledger.data_progress.corroboration_queue_items}; runnable ${ledger.data_progress.corroboration_queue_with_runnable_targets}; need disposition ${ledger.data_progress.corroboration_queue_needing_disposition}; recorded ${ledger.data_progress.corroboration_queue_recorded_disposition}`,
    `- Proposed single-source unknowns: ${ledger.data_progress.proposed_single_source_unknowns}`,
    `- Next focus: ${ledger.data_progress.next_focus}`,
    "",
    "## Source Paths",
    "",
    `- Expected official source links: ${ledger.source_path_progress.expected_source_links_with_coverage}/${ledger.source_path_progress.expected_source_links}`,
    `- Runnable targets: ${ledger.source_path_progress.runnable_targets}`,
    `- Synced targets: ${ledger.source_path_progress.synced_targets}`,
    `- Due targets: ${ledger.source_path_progress.due_targets}`,
    `- Targets with observations: ${ledger.source_path_progress.targets_with_observations}`,
    `- Next focus: ${ledger.source_path_progress.next_focus}`,
    "",
    "## Monitoring Config",
    "",
    `- Config surface: ${ledger.monitoring_config.config_surface}`,
    `- Namespace: ${ledger.monitoring_config.namespace}`,
    `- Default cadence: ${ledger.monitoring_config.target_schedule_defaults.check_cadence_minutes} minutes`,
    `- Default jitter: ${ledger.monitoring_config.target_schedule_defaults.jitter_minutes} minutes`,
    `- Retry: ${ledger.monitoring_config.target_schedule_defaults.max_attempts} attempts`,
    ""
  ];
  for (const batch of ledger.monitoring_config.batches) {
    lines.push(`- ${batch.batch_id}: ${batch.target_count} targets, state=${batch.current_state}, next=${batch.recommended_next_decision}`);
    lines.push(`  Source plan: ${batch.source_plan_ref}`);
    lines.push(`  Sync: \`${batch.sync_command_hint}\``);
  }
  lines.push("", "## Action Queue", "");
  if (ledger.action_queue.length === 0) {
    lines.push("No Gate 1 action is currently open.");
  } else {
    for (const action of ledger.action_queue) renderAction(lines, action);
  }
  lines.push("", "## Review Workbench", "");
  lines.push(`- Items: ${ledger.review_workbench.summary.total_items}`);
  lines.push(`- Human approval required: ${ledger.review_workbench.summary.human_approval_required_items}`);
  lines.push(`- Auto-ranked only: ${ledger.review_workbench.summary.auto_ranked_items}`);
  for (const item of ledger.review_workbench.items.slice(0, 12)) {
    lines.push(`- ${item.priority} ${item.kind}: ${item.title}`);
    lines.push(`  Recommended: ${item.recommended_decision}; allowed: ${item.allowed_decisions.join(", ")}`);
    lines.push(`  Policy: ${item.policy.review_policy}; fact mutation: ${String(item.policy.automatic_fact_mutation_allowed)}`);
  }
  lines.push("", "## Company Switching", "");
  lines.push(`- Frontier companies: ${ledger.company_switching.frontier_companies}`);
  lines.push(`- Next focus: ${ledger.company_switching.next_focus}`);
  if (ledger.company_switching.next_research_targets.length === 0) {
    lines.push("- No generic frontier company research target is ready.");
  } else {
    for (const target of ledger.company_switching.next_research_targets.slice(0, 10)) {
      lines.push(`- ${target.company_name} [${target.company_id}] via ${target.component_id}`);
      lines.push(`  Command: \`${target.command_hint}\``);
      lines.push(`  Seed edge: ${target.seed_edge_id}`);
    }
  }
  lines.push("", "## Guardrails", "");
  for (const guardrail of ledger.guardrails) lines.push(`- ${guardrail}`);
  return lines.join("\n");
}

function renderAction(lines: string[], action: Gate1RunAction): void {
  lines.push(`### ${action.priority} ${action.title}`);
  lines.push("");
  lines.push(`- ID: ${action.action_id}`);
  lines.push(`- Kind: ${action.kind}`);
  lines.push(`- Rationale: ${action.rationale}`);
  if (action.command_hint !== null) lines.push(`- Command: \`${action.command_hint}\``);
  lines.push(`- Refs: ${action.refs.length === 0 ? "none" : action.refs.join(", ")}`);
  lines.push("");
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
