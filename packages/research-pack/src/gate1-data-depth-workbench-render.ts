import type { Gate1DataDepthWorkbench } from "./gate1-data-depth-workbench-definitions.js";

export function renderGate1DataDepthWorkbenchMarkdown(workbench: Gate1DataDepthWorkbench): string {
  const lines = [
    `# Gate 1 Data Depth Workbench ${workbench.company_id}`,
    "",
    `Generated at: ${workbench.generated_at}`,
    "",
    "This workbench ranks the next data-depth moves for Gate 1. It is review-only: it does not create fact edges, close unknowns, or mutate evidence.",
    "",
    "## Summary",
    "",
    `- Items: ${workbench.summary.items} (${workbench.summary.p0} P0, ${workbench.summary.p1} P1, ${workbench.summary.p2} P2)`,
    `- Workstreams: ${formatCountMap(workbench.summary.by_workstream)}`,
    `- L4/L5 fact edges: ${workbench.summary.l4_l5_fact_edges}/${workbench.summary.fact_edge_target}; gap ${workbench.summary.fact_edge_gap_to_target}`,
    `- Cross-source edges: ${workbench.summary.cross_source_edges}`,
    `- Corroboration or disposition edges: ${workbench.summary.corroboration_or_disposition_edges}`,
    `- Source blockers: ${workbench.summary.source_blockers}`,
    `- Strength missing edges: ${workbench.summary.strength_missing_edges}`,
    `- Next observation labeling batch: ${workbench.summary.observation_labeling_batch}`,
    `- Propagation contexts not ready: ${workbench.summary.propagation_contexts_not_ready}`,
    "",
    "## Items",
    ""
  ];
  if (workbench.items.length === 0) {
    lines.push("No Gate 1 data-depth work items are open.");
    return lines.join("\n");
  }
  for (const item of workbench.items) {
    lines.push(`### ${item.priority} ${item.title}`);
    lines.push("");
    lines.push(`- ID: ${item.item_id}`);
    lines.push(`- Workstream: ${item.workstream}`);
    lines.push(`- Frontend action: ${item.frontend_action_kind}`);
    lines.push(`- Policy: ${item.review_policy}; automatic fact mutation: ${String(item.automatic_fact_mutation_allowed)}`);
    lines.push(`- Rationale: ${item.rationale}`);
    lines.push(`- Recommended action: ${item.recommended_action}`);
    lines.push(`- Recommended decision: ${item.recommended_decision}`);
    lines.push(`- Allowed decisions: ${item.allowed_decisions.join(", ")}`);
    lines.push(`- Write impact: ${item.write_impact}`);
    if (item.command_hints.length > 0) {
      lines.push("- Command hints:");
      for (const hint of item.command_hints) {
        lines.push(
          `  - ${hint.label}: \`${hint.command}\` (writes_truth_store=${String(hint.writes_truth_store)}; requires_database=${String(hint.requires_database)})`
        );
      }
    }
    lines.push(`- Edges: ${item.edge_ids.length === 0 ? "none" : item.edge_ids.join(", ")}`);
    lines.push(`- Components: ${item.component_ids.length === 0 ? "none" : item.component_ids.join(", ")}`);
    lines.push(`- Source adapters: ${item.source_adapters.length === 0 ? "none" : item.source_adapters.join(", ")}`);
    lines.push(`- Refs: ${item.refs.length === 0 ? "none" : item.refs.join(", ")}`);
    if (item.source_targets.length > 0) {
      lines.push("- Source targets:");
      for (const target of item.source_targets.slice(0, 12)) {
        lines.push(
          `  - ${target.source_adapter_id}/${target.target_kind}: state=${target.state ?? "n/a"}; observations=${target.observations ?? "n/a"}; failure=${target.failure_kind ?? "none"}; target=${target.check_target_id ?? "n/a"}`
        );
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

function formatCountMap(counts: Record<string, number>): string {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  if (entries.length === 0) return "none";
  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}=${count}`)
    .join(", ");
}
