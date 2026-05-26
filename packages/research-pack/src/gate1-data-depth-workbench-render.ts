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
    `- Fact edge scope: ${workbench.summary.fact_edge_scope}`,
    `- L4/L5 fact edges: ${workbench.summary.l4_l5_fact_edges}/${workbench.summary.fact_edge_target}; gap ${workbench.summary.fact_edge_gap_to_target}`,
    `- Cross-source edges: ${workbench.summary.cross_source_edges}`,
    `- Corroboration or disposition edges: ${workbench.summary.corroboration_or_disposition_edges}`,
    `- Adjacent official facts: ${workbench.summary.adjacent_official_fact_edges} edges across ${workbench.summary.adjacent_official_fact_companies} companies`,
    `- Source blockers: ${workbench.summary.source_blockers}`,
    `- Entity affiliation context items: ${workbench.summary.entity_context_items}`,
    `- Strength missing edges: ${workbench.summary.strength_missing_edges}`,
    `- Next observation labeling batch: ${workbench.summary.observation_labeling_batch}`,
    `- Propagation contexts not ready: ${workbench.summary.propagation_contexts_not_ready}`,
    `- Ranking calibration candidates: ${workbench.summary.ranking_calibration_candidates}; labeled ${workbench.summary.ranking_labeled_candidates}; unlabeled ${workbench.summary.ranking_unlabeled_candidates}; persisted labels ${formatCountMap(workbench.summary.ranking_labels_by_persisted_label)}`,
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
    if (item.ranking_contexts.length > 0) {
      lines.push("- Ranking contexts:");
      for (const context of item.ranking_contexts) {
        lines.push(
          `  - ${context.ranking_kind}: context=${context.context_id}; model=${context.model_version}; policy=${context.policy}; calibration=${context.calibration_status}; needs_label=${String(
            context.needs_label
          )}`
        );
        for (const candidate of context.candidates.slice(0, 5)) {
          lines.push(
            `    - #${candidate.rank} ${candidate.entity_name} (${candidate.entity_id}); candidate=${candidate.candidate_id}: ${candidate.ranking_reason}; features=${formatRankingFeatures(
              candidate.score_breakdown
            )}`
          );
          lines.push(`      Review: ${candidate.review_status}; latest=${formatLatestRankingLabel(candidate.latest_label)}`);
        }
        lines.push("    - Labels: useful_target, wrong_direction, brand_center_bias, needs_more_context, not_relevant");
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

function formatLatestRankingLabel(label: { label: string; reviewer: string; reviewed_at: string } | null): string {
  if (label === null) return "none";
  return `${label.reviewer}=${label.label}@${label.reviewed_at}`;
}

function formatRankingFeatures(features: {
  component_relevance: number;
  upstream_role_edges: number;
  max_evidence_level: number;
  max_confidence: number;
  edge_frequency_tiebreaker: number;
}): string {
  return [
    `component_relevance=${features.component_relevance}`,
    `upstream_role_edges=${features.upstream_role_edges}`,
    `max_evidence_level=${features.max_evidence_level}`,
    `max_confidence=${features.max_confidence.toFixed(2)}`,
    `edge_frequency_tiebreaker=${features.edge_frequency_tiebreaker}`
  ].join(", ");
}
