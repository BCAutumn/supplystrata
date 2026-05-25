import type { OfficialDisclosureReadinessReport } from "./official-disclosure-readiness-definitions.js";

export function renderOfficialDisclosureReadinessMarkdown(report: OfficialDisclosureReadinessReport): string {
  const lines = [
    `# Official Disclosure Readiness ${report.company_id}`,
    "",
    `Generated at: ${report.generated_at}`,
    "",
    "This report measures whether the current research pack has enough auditable Level 4/5 official disclosure coverage. It does not create fact edges.",
    "",
    "## Summary",
    "",
    `- Target profile: ${report.target_profile === null ? "not selected" : `${report.target_profile.profile_id} (${report.target_profile.title})`}`,
    `- Gate 1 scorecard: ${report.scorecard.status.toUpperCase()} overall ${formatPercent(report.scorecard.overall_progress)}; data ${formatPercent(report.scorecard.data_progress)}; source paths ${formatPercent(report.scorecard.source_path_progress)}`,
    `- Visible research nodes: ${report.summary.visible_research_nodes}/${report.targets.core_nodes}`,
    `- Explicit target nodes: ${report.summary.target_research_nodes === 0 ? "not supplied" : `${report.summary.target_research_nodes} supplied; ${report.summary.target_nodes_missing_official_coverage} missing`}`,
    `- Profile expansion candidates: ${report.profile_expansion_candidates.length}`,
    `- Node coverage: ${report.summary.nodes_with_fact_edges} fact-covered; ${report.summary.nodes_with_runnable_official_targets} runnable official targets; ${report.summary.nodes_missing_official_coverage} missing`,
    `- Level 4/5 fact edges: ${report.summary.level_4_5_fact_edges}/${report.targets.level_4_5_fact_edges}`,
    `- Traceable edges: ${report.summary.traceable_edges}/${report.summary.level_4_5_fact_edges}`,
    `- Cross-source edges: ${report.summary.cross_source_edges}/${report.summary.level_4_5_fact_edges} (${formatPercent(report.summary.corroboration_ratio)})`,
    `- Corroboration/disposition coverage: ${report.summary.corroboration_or_disposition_edges}/${report.summary.level_4_5_fact_edges} (${formatPercent(report.summary.corroboration_or_disposition_ratio)})`,
    `- Single-source disposition: ${report.summary.corroboration_queue_with_recorded_disposition} recorded; ${report.summary.corroboration_queue_proposed_unknowns} proposed unknowns`,
    `- Intelligence context: ${report.summary.edges_with_strength} strength, ${report.summary.edges_with_freshness} freshness`,
    `- Explicit unknowns in pack: ${report.summary.explicit_unknowns}`,
    `- Official source-plan items: ${report.summary.official_source_plan_items}`,
    `- Expected official source links: ${report.summary.expected_official_source_links_with_coverage}/${report.summary.expected_official_source_links} covered; ${report.summary.expected_official_source_links_runnable} runnable paths; ${report.summary.expected_official_source_links_connector_available} connector-only; ${report.summary.expected_official_source_links_unimplemented} unimplemented; ${report.summary.expected_official_source_links_missing} missing`,
    `- Runnable official targets: ${report.summary.runnable_official_targets}; synced ${report.summary.synced_official_targets}; due ${report.summary.due_official_targets}; degraded ${report.summary.degraded_official_targets}; with observations ${report.summary.official_targets_with_observations}`
  ];
  lines.push(
    `- Official disclosure review signals: ${report.summary.official_disclosure_signal_review_candidates} total; ${report.summary.open_official_disclosure_signal_review_candidates} open`
  );
  lines.push(
    `- Official disclosure signal dispositions: ${report.summary.official_disclosure_signal_dispositions}; correlation hints ${report.summary.open_official_disclosure_signal_correlation_hints}/${report.summary.official_disclosure_signal_correlation_hints} open`
  );

  lines.push("", "## Gate 1 scorecard", "");
  for (const criterion of report.scorecard.criteria) {
    lines.push(
      `- ${criterion.status.toUpperCase()} ${criterion.criterion_id}: ${formatMeasured(criterion.measured)} / ${formatMeasured(criterion.target)} (${formatPercent(criterion.progress)})`
    );
    lines.push(`  ${criterion.rationale}`);
  }
  if (report.scorecard.next_actions.length > 0) {
    lines.push("", "### Next actions", "");
    for (const action of report.scorecard.next_actions) lines.push(`- ${action}`);
  }

  lines.push("", "## Gate status", "");
  for (const gate of report.gates) {
    lines.push(`- ${gate.status.toUpperCase()} ${gate.gate_id}: ${formatMeasured(gate.measured)} / ${formatMeasured(gate.target)}`);
    lines.push(`  ${gate.rationale}`);
  }

  lines.push("", "## Coverage gaps", "");
  if (report.gaps.length === 0) {
    lines.push("No official disclosure readiness gaps detected in this pack.");
  } else {
    for (const gap of report.gaps) {
      lines.push(`- ${gap.priority} ${gap.kind}: ${gap.title}`);
      lines.push(`  Why: ${gap.rationale}`);
      lines.push(`  Action: ${gap.action}`);
      if (gap.edge_ids.length > 0) lines.push(`  Edges: ${gap.edge_ids.slice(0, 10).join(", ")}`);
      if (gap.component_ids.length > 0) lines.push(`  Components: ${gap.component_ids.slice(0, 10).join(", ")}`);
      if (gap.source_plan_refs.length > 0) lines.push(`  Source plan: ${gap.source_plan_refs.slice(0, 10).join(", ")}`);
      if (gap.source_targets.length > 0) {
        lines.push(
          `  Runnable targets: ${gap.source_targets
            .slice(0, 10)
            .map((target) => `${target.source_adapter_id}/${target.target_kind}=${target.state ?? "planned"}`)
            .join(", ")}`
        );
      }
    }
  }

  lines.push("", "## Corroboration queue", "");
  if (report.corroboration_queue.length === 0) {
    lines.push("No single-source official edges require corroboration or disposition in this pack.");
  } else {
    for (const item of report.corroboration_queue.slice(0, 40)) {
      lines.push(`- ${item.priority} ${item.disposition} ${item.edge_id}: ${item.from_name} -> ${item.to_name}`);
      lines.push(`  Why: ${item.reason}`);
      lines.push(`  Action: ${item.action}`);
      lines.push(`  Existing sources: ${item.existing_source_adapters.length === 0 ? "none" : item.existing_source_adapters.join(", ")}`);
      if (item.candidate_source_ids.length > 0) lines.push(`  Candidate sources: ${item.candidate_source_ids.join(", ")}`);
      if (item.source_plan_refs.length > 0) lines.push(`  Source plan: ${item.source_plan_refs.slice(0, 10).join(", ")}`);
      if (item.source_targets.length > 0) {
        lines.push(
          `  Targets: ${item.source_targets
            .slice(0, 10)
            .map((target) => `${target.source_adapter_id}/${target.target_kind}=${target.state ?? "planned"}`)
            .join(", ")}`
        );
      }
      if (item.unknown_ids.length > 0) lines.push(`  Unknowns: ${item.unknown_ids.join(", ")}`);
      if (item.proposed_unknown !== null) {
        lines.push(`  Proposed unknown: ${item.proposed_unknown.unknown_id}`);
        lines.push(`  Unknown question: ${item.proposed_unknown.question}`);
      }
    }
  }

  lines.push("", "## Official disclosure review signals", "");
  if (report.official_disclosure_signals.length === 0) {
    lines.push("No official disclosure signal review candidates are visible in this pack.");
  } else {
    for (const signal of report.official_disclosure_signals.slice(0, 40)) {
      lines.push(`- ${signal.status} ${signal.review_id}: ${signal.signal_title}`);
      lines.push(
        `  Source: ${signal.source_adapter_id}; doc=${signal.doc_id ?? "unknown"}; L${signal.evidence_level_hint}; confidence=${signal.confidence.toFixed(2)}`
      );
      lines.push(`  Locator: ${signal.source_locator}`);
      lines.push(`  Text: ${signal.cite_text}`);
      for (const disposition of signal.dispositions.slice(0, 5)) {
        lines.push(`  Disposition: ${disposition.decision} for ${disposition.edge_id} by ${disposition.reviewer}`);
        lines.push(`  Disposition reason: ${disposition.reason}`);
      }
    }
  }

  lines.push("", "## Official disclosure signal correlation hints", "");
  if (report.official_disclosure_signal_correlation_hints.length === 0) {
    lines.push("No review-only signal correlation hints are visible in this pack.");
  } else {
    for (const hint of report.official_disclosure_signal_correlation_hints.slice(0, 40)) {
      lines.push(`- score=${hint.relevance_score.toFixed(2)} ${hint.review_id} -> ${hint.edge_id}: ${hint.edge_summary}`);
      lines.push(
        `  Policy: ${hint.review_policy}; disposition=${hint.disposition}; status=${hint.status}; review=${hint.disposition_status}${hint.recorded_decision === null ? "" : `/${hint.recorded_decision}`}`
      );
      lines.push(`  Reasons: ${hint.match_reasons.join(", ")}`);
      lines.push(`  Action: ${hint.action}`);
    }
  }

  lines.push("", "## Expected official source coverage", "");
  if (report.expected_source_coverage.length === 0) {
    lines.push("No explicit expected official source links were supplied by a target profile.");
  } else {
    for (const item of report.expected_source_coverage.slice(0, 60)) {
      lines.push(
        `- ${item.coverage_state} ${item.node_id}${item.node_name === null ? "" : ` (${item.node_name})`} via ${item.expected_source_id}: ${item.action}`
      );
      if (item.fact_edge_ids.length > 0) lines.push(`  Fact edges: ${item.fact_edge_ids.slice(0, 10).join(", ")}`);
      if (item.source_plan_refs.length > 0) lines.push(`  Source plan: ${item.source_plan_refs.slice(0, 10).join(", ")}`);
      if (item.source_targets.length > 0) {
        lines.push(
          `  Targets: ${item.source_targets
            .slice(0, 10)
            .map((target) => `${target.source_adapter_id}/${target.target_kind}=${target.state ?? "planned"}`)
            .join(", ")}`
        );
      }
    }
  }

  lines.push("", "## Node coverage", "");
  if (report.nodes.length === 0) {
    lines.push("No research nodes are visible in this pack.");
  } else {
    for (const node of report.nodes.slice(0, 40)) {
      lines.push(`- ${node.coverage_state} ${node.is_target_node ? "[target] " : ""}${node.node_id}${node.name === null ? "" : ` (${node.name})`}`);
      if (node.expected_source_ids.length > 0) lines.push(`  Expected sources: ${node.expected_source_ids.join(", ")}`);
      if (node.fact_edge_ids.length > 0) lines.push(`  Fact edges: ${node.fact_edge_ids.slice(0, 10).join(", ")}`);
      if (node.source_plan_refs.length > 0) lines.push(`  Source plan: ${node.source_plan_refs.slice(0, 10).join(", ")}`);
      if (node.source_targets.length > 0) {
        lines.push(
          `  Targets: ${node.source_targets
            .slice(0, 10)
            .map((target) => `${target.source_adapter_id}/${target.target_kind}=${target.state ?? "planned"}`)
            .join(", ")}`
        );
      }
    }
  }

  lines.push("", "## Profile expansion candidates", "");
  if (report.profile_expansion_candidates.length === 0) {
    lines.push("No discovered nodes need profile expansion review in this pack.");
  } else {
    for (const candidate of report.profile_expansion_candidates.slice(0, 25)) {
      lines.push(`- ${candidate.suggested_priority} ${candidate.node_id}${candidate.name === null ? "" : ` (${candidate.name})`}: ${candidate.reason}`);
      if (candidate.fact_edge_ids.length > 0) lines.push(`  Fact edges: ${candidate.fact_edge_ids.slice(0, 10).join(", ")}`);
      if (candidate.source_plan_refs.length > 0) lines.push(`  Source plan: ${candidate.source_plan_refs.slice(0, 10).join(", ")}`);
      if (candidate.source_adapters.length > 0) lines.push(`  Sources: ${candidate.source_adapters.slice(0, 10).join(", ")}`);
    }
  }

  lines.push("", "## Official source plan", "");
  if (report.source_plan_items.length === 0) {
    lines.push("No official disclosure source-plan items are visible in this pack.");
  } else {
    for (const item of report.source_plan_items) {
      lines.push(`- ${item.source_id}: ${item.source_name}`);
      lines.push(`  Policy: ${item.expected_output_layer}/${item.relation_policy}; priority ${item.priority}`);
      lines.push(`  Components: ${item.component_ids.length === 0 ? "none" : item.component_ids.join(", ")}`);
      if (item.source_targets.length === 0) {
        lines.push("  Runnable targets: none");
      } else {
        lines.push(
          `  Runnable targets: ${item.source_targets
            .map((target) => `${target.source_adapter_id}/${target.target_kind}=${target.state ?? "planned"}`)
            .join(", ")}`
        );
      }
    }
  }

  lines.push("", "## Edge sample", "");
  for (const edge of report.edges.slice(0, 20)) {
    lines.push(`- ${edge.edge_id}: ${edge.from_name} -> ${edge.to_name} ${edge.relation} [L${edge.evidence_level}]`);
    lines.push(`  Traceability: ${edge.traceability_state}; corroboration: ${edge.corroboration_state}`);
    lines.push(`  Sources: ${edge.source_adapters.length === 0 ? "none" : edge.source_adapters.join(", ")}`);
    lines.push(`  Intelligence: strength=${edge.has_strength ? "yes" : "no"}, freshness=${edge.has_freshness ? "yes" : "no"}`);
    if (edge.unknown_ids.length > 0) lines.push(`  Unknowns: ${edge.unknown_ids.join(", ")}`);
  }
  return lines.join("\n");
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMeasured(value: number): string {
  return value <= 1 && value >= 0 ? formatPercent(value) : String(value);
}
