import type { PropagationReadinessReport } from "./propagation-readiness-definitions.js";

export function renderPropagationReadinessMarkdown(report: PropagationReadinessReport): string {
  const lines = [
    `# Propagation Readiness ${report.company_id}`,
    "",
    `Generated at: ${report.generated_at}`,
    "",
    "This report prepares structured reasoning inputs for future AI/frontend research. It does not create fact edges, evidence, claims, observations, or unknowns.",
    "",
    "## Summary",
    "",
    `- Contexts: ${report.summary.contexts_total}`,
    `- Ready: ${report.summary.ready}; partial: ${report.summary.partial}; blocked: ${report.summary.blocked}`,
    `- With observations: ${report.summary.contexts_with_observations}`,
    `- With source-plan paths: ${report.summary.contexts_with_source_plan}`,
    `- With component leads: ${report.summary.contexts_with_component_leads}`,
    `- Reasoning inputs: ${report.summary.reasoning_inputs}`,
    `- Policy: ${report.summary.no_fact_mutation_policy}`,
    "",
    "## AI Compute Propagation Matrix",
    "",
    `- Matrix: ${report.ai_compute_matrix.matrix_id}`,
    `- Layers: ${report.ai_compute_matrix.summary.layers_total}`,
    `- Status: covered_fact ${report.ai_compute_matrix.summary.covered_fact}; observation_ready ${report.ai_compute_matrix.summary.observation_ready}; official_target_runnable ${report.ai_compute_matrix.summary.official_target_runnable}; lead_only ${report.ai_compute_matrix.summary.lead_only}; unknown_open ${report.ai_compute_matrix.summary.unknown_open}; blocked_source ${report.ai_compute_matrix.summary.blocked_source}`,
    `- Layers with facts: ${report.ai_compute_matrix.summary.layers_with_fact_refs}`,
    `- Layers with observations: ${report.ai_compute_matrix.summary.layers_with_observation_refs}`,
    `- Layers with source targets: ${report.ai_compute_matrix.summary.layers_with_source_targets}`,
    `- Policy: ${report.ai_compute_matrix.policy}`,
    "",
    "### Layers",
    ""
  ];

  for (const layer of report.ai_compute_matrix.layers) {
    lines.push(`- ${layer.status} ${layer.layer_id}: ${layer.title}`);
    lines.push(`  Question: ${layer.question}`);
    lines.push(`  Why: ${layer.status_reason}`);
    lines.push(`  Components: ${formatList(layer.component_ids)}`);
    lines.push(`  Materials/process: ${formatList(layer.material_or_process_refs)}`);
    lines.push(`  Facts: ${formatList(layer.fact_edge_refs)}`);
    lines.push(`  Observations: ${formatList([...layer.observation_refs, ...layer.observation_series_refs])}`);
    lines.push(`  Source targets: ${formatList(layer.source_target_refs)}`);
    lines.push(`  Source target groups: ${formatList(layer.source_target_groups.map(formatSourceTargetGroup))}`);
    lines.push(`  Source target states: ${formatList(layer.source_target_statuses.map(formatSourceTargetStatus))}`);
    lines.push(`  Next research targets: ${formatList(layer.next_research_targets.map(formatNextResearchTarget))}`);
    lines.push(`  Source plan: ${formatList(layer.source_plan_refs)}`);
    lines.push(`  Leads/frontier: ${formatList([...layer.component_dependency_refs, ...layer.frontier_refs])}`);
    lines.push(`  Unknowns: ${formatList(layer.unknown_refs)}`);
    lines.push(`  Unknown/backlog seeds: ${formatList(layer.unknown_backlog_seeds.map(formatUnknownBacklogSeed))}`);
    lines.push(`  Missing official evidence: ${formatList(layer.missing_official_evidence)}`);
    lines.push(`  Allowed outputs: ${formatList(layer.allowed_research_outputs)}`);
    lines.push(`  Prohibited writes: ${formatList(layer.prohibited_truth_store_writes)}`);
    lines.push(`  Next: ${formatList(layer.next_actions)}`);
  }

  lines.push("", "## Contexts", "");

  for (const item of report.items) {
    lines.push(`- ${item.status} ${item.context_kind}: ${item.title}`);
    lines.push(`  Question: ${item.question}`);
    lines.push(`  Confidence: ${item.confidence.toFixed(2)}`);
    lines.push(`  Policy: ${item.policy}`);
    lines.push(`  Ready signals: ${formatList(item.ready_signals)}`);
    lines.push(`  Missing: ${formatList(item.missing_requirements)}`);
    lines.push(`  Observation types: ${formatList(item.observation_types)}`);
    lines.push(`  Source plan: ${formatList(item.source_plan_refs)}`);
    lines.push(`  Component leads: ${formatList(item.component_dependency_refs)}`);
    lines.push(`  Frontier: ${formatList(item.frontier_refs)}`);
    lines.push(`  Components: ${formatList(item.component_ids)}`);
    lines.push(`  Materials/process: ${formatList(item.material_or_process_refs)}`);
    lines.push(`  Action: ${item.action}`);
    lines.push(`  Why: ${item.rationale}`);
  }

  return lines.join("\n");
}

function formatList(values: readonly string[]): string {
  return values.length === 0 ? "(none)" : values.slice(0, 20).join(", ");
}

function formatSourceTargetStatus(value: { ref: string; failure_kind: string | null; latest_event_type: string | null }): string {
  const failure = value.failure_kind === null ? "" : ` failure=${value.failure_kind}`;
  const event = value.latest_event_type === null ? "" : ` event=${value.latest_event_type}`;
  return `${value.ref}${failure}${event}`;
}

function formatSourceTargetGroup(value: {
  group_kind: string;
  source_plan_refs: readonly string[];
  source_target_refs: readonly string[];
  source_adapters: readonly string[];
  target_kinds: readonly string[];
  states: readonly string[];
  failure_kinds: readonly string[];
}): string {
  const plans = value.source_plan_refs.length === 0 ? "" : ` plans=${value.source_plan_refs.length}`;
  const targets = value.source_target_refs.length === 0 ? "" : ` targets=${value.source_target_refs.length}`;
  const adapters = value.source_adapters.length === 0 ? "" : ` adapters=${value.source_adapters.join("|")}`;
  const targetKinds = value.target_kinds.length === 0 ? "" : ` kinds=${value.target_kinds.join("|")}`;
  const states = value.states.length === 0 ? "" : ` states=${value.states.join("|")}`;
  const failures = value.failure_kinds.length === 0 ? "" : ` failures=${value.failure_kinds.join("|")}`;
  return `${value.group_kind}${plans}${targets}${adapters}${targetKinds}${states}${failures}`;
}

function formatUnknownBacklogSeed(value: { seed_id: string; recommended_review_action: string; question: string }): string {
  return `${value.seed_id} action=${value.recommended_review_action} question="${value.question}"`;
}

function formatNextResearchTarget(value: { target_kind: string; target_id: string; label: string; action: string }): string {
  return `${value.target_kind}:${value.target_id} label="${value.label}" action="${value.action}"`;
}
