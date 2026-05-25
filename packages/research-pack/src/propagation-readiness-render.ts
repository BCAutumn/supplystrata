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
    "## Contexts",
    ""
  ];

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
