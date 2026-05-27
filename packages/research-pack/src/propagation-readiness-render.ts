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
    lines.push(`  Evidence layer summary: ${formatList(layer.evidence_layer_summary.map(formatEvidenceLayerSummary))}`);
    lines.push(`  Facts: ${formatList(layer.fact_edge_refs)}`);
    lines.push(`  Observations: ${formatList([...layer.observation_refs, ...layer.observation_series_refs])}`);
    lines.push(`  Source targets: ${formatList(layer.source_target_refs)}`);
    lines.push(`  Source target groups: ${formatList(layer.source_target_groups.map(formatSourceTargetGroup))}`);
    lines.push(`  Source target status summary: ${formatSourceTargetStatusSummary(layer.source_target_status_summary)}`);
    lines.push(`  Readiness answers: ${formatReadinessAnswers(layer.readiness_answers)}`);
    lines.push(`  Execution queue: ${formatExecutionQueue(layer.execution_queue)}`);
    const executionSourceTargetActions = layer.execution_queue.items.flatMap((item) => item.source_target_actions);
    lines.push(`  Execution source-target actions: ${formatList(executionSourceTargetActions.map(formatExecutionSourceTargetAction))}`);
    lines.push(`  Source target states: ${formatList(layer.source_target_statuses.map(formatSourceTargetStatus))}`);
    lines.push(`  Next research targets: ${formatList(layer.next_research_targets.map(formatNextResearchTarget))}`);
    lines.push(`  Source plan: ${formatList(layer.source_plan_refs)}`);
    lines.push(`  Leads/frontier: ${formatList([...layer.component_dependency_refs, ...layer.frontier_refs])}`);
    lines.push(`  Unknowns: ${formatList(layer.unknown_refs)}`);
    lines.push(`  Unknown/backlog seeds: ${formatList(layer.unknown_backlog_seeds.map(formatUnknownBacklogSeed))}`);
    lines.push(`  Unknown/backlog summary: ${formatUnknownBacklogSummary(layer.unknown_backlog_summary)}`);
    lines.push(`  Official evidence gaps: ${formatList(layer.official_evidence_gaps.map(formatOfficialEvidenceGap))}`);
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

function formatCountMap(counts: Record<string, number>): string {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  if (entries.length === 0) return "none";
  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}=${count}`)
    .join(",");
}

function formatSourceTargetStatus(value: { ref: string; failure_kind: string | null; latest_event_type: string | null }): string {
  const failure = value.failure_kind === null ? "" : ` failure=${value.failure_kind}`;
  const event = value.latest_event_type === null ? "" : ` event=${value.latest_event_type}`;
  return `${value.ref}${failure}${event}`;
}

function formatSourceTargetStatusSummary(value: {
  targets: number;
  runnable_targets: number;
  blocked_targets: number;
  degraded_targets: number;
  missing_credentials: number;
  source_failed_targets: number;
  by_state: Record<string, number>;
  by_failure_kind: Record<string, number>;
}): string {
  return [
    `targets=${value.targets}`,
    `runnable=${value.runnable_targets}`,
    `blocked=${value.blocked_targets}`,
    `degraded=${value.degraded_targets}`,
    `missing_credentials=${value.missing_credentials}`,
    `source_failed=${value.source_failed_targets}`,
    `by_state=${formatCountMap(value.by_state)}`,
    `by_failure=${formatCountMap(value.by_failure_kind)}`
  ].join("; ");
}

function formatReadinessAnswers(value: {
  fact_edges: { count: number };
  non_fact_inputs: { observation_refs: readonly string[]; lead_refs: readonly string[] };
  official_evidence: { gaps: number; by_gap_kind: Record<string, number> };
  unknowns: { existing_unknowns: number; seeds: number; by_recommended_review_action: Record<string, number> };
  next_research: { by_target_kind: Record<string, number> };
  source_targets: { targets: number; runnable_targets: number; blocked_targets: number; missing_credentials: number };
  output_policy: { truth_store_write_policy: string };
}): string {
  return [
    `facts=${value.fact_edges.count}`,
    `non_fact_inputs=${value.non_fact_inputs.observation_refs.length + value.non_fact_inputs.lead_refs.length}`,
    `official_gaps=${value.official_evidence.gaps}(${formatCountMap(value.official_evidence.by_gap_kind)})`,
    `unknowns=${value.unknowns.existing_unknowns}+${value.unknowns.seeds}(${formatCountMap(value.unknowns.by_recommended_review_action)})`,
    `next=${formatCountMap(value.next_research.by_target_kind)}`,
    `targets=${value.source_targets.targets}/runnable=${value.source_targets.runnable_targets}/blocked=${value.source_targets.blocked_targets}/missing_credentials=${value.source_targets.missing_credentials}`,
    `policy=${value.output_policy.truth_store_write_policy}`
  ].join("; ");
}

function formatExecutionQueue(value: {
  summary: {
    items: number;
    run_source_target: number;
    repair_source_target: number;
    review_intelligence_context: number;
    keep_unknown_open: number;
    runnable_source_targets: number;
    blocked_source_targets: number;
    unknown_refs: number;
  };
}): string {
  return [
    `items=${value.summary.items}`,
    `run=${value.summary.run_source_target}`,
    `repair=${value.summary.repair_source_target}`,
    `review=${value.summary.review_intelligence_context}`,
    `keep_unknown=${value.summary.keep_unknown_open}`,
    `runnable_targets=${value.summary.runnable_source_targets}`,
    `blocked_targets=${value.summary.blocked_source_targets}`,
    `unknown_refs=${value.summary.unknown_refs}`
  ].join("; ");
}

function formatExecutionSourceTargetAction(value: {
  check_target_id: string | null;
  source_adapter_id: string;
  target_kind: string | null;
  state: string | null;
  failure_kind: string | null;
  recommended_cli_command: string | null;
  writes_truth_store: boolean;
}): string {
  return `${value.source_adapter_id}/${value.target_kind ?? "unknown"} target=${value.check_target_id ?? "n/a"} state=${value.state ?? "n/a"} failure=${value.failure_kind ?? "none"} writes=${String(value.writes_truth_store)} command="${value.recommended_cli_command ?? "n/a"}"`;
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

function formatUnknownBacklogSummary(value: {
  existing_unknowns: number;
  seeds: number;
  by_recommended_review_action: Record<string, number>;
  truth_store_write_policy: string;
}): string {
  return [
    `existing=${value.existing_unknowns}`,
    `seeds=${value.seeds}`,
    `by_action=${formatCountMap(value.by_recommended_review_action)}`,
    `policy=${value.truth_store_write_policy}`
  ].join("; ");
}

function formatNextResearchTarget(value: { target_kind: string; target_id: string; label: string; action: string }): string {
  return `${value.target_kind}:${value.target_id} label="${value.label}" action="${value.action}"`;
}

function formatOfficialEvidenceGap(value: { gap_kind: string; target_kind: string; target_id: string; recommended_action: string }): string {
  return `${value.gap_kind}:${value.target_kind}:${value.target_id} action="${value.recommended_action}"`;
}

function formatEvidenceLayerSummary(value: { layer_kind: string; count: number; interpretation: string }): string {
  return `${value.layer_kind}=${value.count} "${value.interpretation}"`;
}
