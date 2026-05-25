import type { SupplyChainExpansionPlan } from "./supply-chain-expansion-definitions.js";

export function renderSupplyChainExpansionPlanMarkdown(plan: SupplyChainExpansionPlan): string {
  const lines = [
    `# Supply Chain Expansion Plan ${plan.company_id}`,
    "",
    `Generated at: ${plan.generated_at}`,
    `Max depth: ${plan.max_depth}`,
    "",
    "This plan is a deterministic research planner. It does not create fact edges, evidence, claims, observations, or unknowns.",
    "",
    "## Summary",
    "",
    `- Fact edges considered: ${plan.summary.fact_edges_considered}`,
    `- Frontier edges: ${plan.summary.frontier_edges}; companies ${plan.summary.frontier_companies}; blocked ${plan.summary.blocked_frontier_edges}`,
    `- Component dependency leads: ${plan.summary.component_dependency_leads}; fact-covered ${plan.summary.leads_with_fact_coverage}; source-path ${plan.summary.leads_with_source_path}; fact-capable paths ${plan.summary.leads_with_fact_capable_source_path}; observation paths ${plan.summary.leads_with_observation_source_path}; lead-only paths ${plan.summary.leads_with_lead_only_source_path}; lead-only ${plan.summary.lead_only_items}; observation-layer ${plan.summary.observation_layer_items}`,
    `- Stop conditions: ${plan.summary.stop_conditions}; explicit unknown refs ${plan.summary.explicit_unknown_refs}`,
    "",
    "## Frontier",
    ""
  ];
  appendFrontierSection(lines, plan);
  appendComponentLeadSection(lines, plan);
  appendStopConditionSection(lines, plan);
  return lines.join("\n");
}

function appendFrontierSection(lines: string[], plan: SupplyChainExpansionPlan): void {
  if (plan.frontier.length === 0) {
    lines.push("No Level 4/5 fact edge frontier is available for recursive expansion.");
    return;
  }
  for (const item of plan.frontier.slice(0, 60)) {
    lines.push(`- ${item.expansion_state} ${item.edge_id}: ${item.from_name} -> ${item.to_name}`);
    lines.push(`  Depth: ${item.path_depth}; component=${item.component_id ?? "missing"}; next=${item.next_company_name ?? "none"}`);
    lines.push(`  Action: ${item.action}`);
    lines.push(`  Why: ${item.rationale}`);
    if (item.unknown_ids.length > 0) lines.push(`  Unknowns: ${item.unknown_ids.join(", ")}`);
    if (item.source_plan_refs.length > 0) lines.push(`  Source plan: ${item.source_plan_refs.slice(0, 10).join(", ")}`);
  }
}

function appendComponentLeadSection(lines: string[], plan: SupplyChainExpansionPlan): void {
  lines.push("", "## Component Dependency Leads", "");
  if (plan.component_dependency_leads.length === 0) {
    lines.push("No component dependency taxonomy leads are available for the current frontier.");
    return;
  }
  for (const lead of plan.component_dependency_leads.slice(0, 80)) {
    lines.push(`- ${lead.state} ${lead.parent_component_id} -> ${lead.target_id} (${lead.target_name})`);
    lines.push(`  Category: ${lead.category}; tier=${lead.tier_depth}; confidence=${lead.confidence.toFixed(2)}`);
    lines.push(`  Source authority: ${lead.source_path_authority}`);
    if (lead.source_relation_policies.length > 0) lines.push(`  Source policies: ${lead.source_relation_policies.join(", ")}`);
    if (lead.source_output_layers.length > 0) lines.push(`  Output layers: ${lead.source_output_layers.join(", ")}`);
    lines.push(`  Policy: ${lead.expansion_policy}`);
    lines.push(`  Action: ${lead.action}`);
    lines.push(`  Why: ${lead.rationale}`);
    if (lead.supporting_edge_ids.length > 0) lines.push(`  Edges: ${lead.supporting_edge_ids.slice(0, 10).join(", ")}`);
    if (lead.source_plan_refs.length > 0) lines.push(`  Source plan: ${lead.source_plan_refs.slice(0, 10).join(", ")}`);
    if (lead.unknowns.length > 0) lines.push(`  Unknowns: ${lead.unknowns.join("; ")}`);
  }
}

function appendStopConditionSection(lines: string[], plan: SupplyChainExpansionPlan): void {
  lines.push("", "## Stop Conditions", "");
  if (plan.stop_conditions.length === 0) {
    lines.push("No deterministic stop condition was reached.");
    return;
  }
  for (const stop of plan.stop_conditions.slice(0, 80)) {
    lines.push(`- ${stop.reason} ${stop.scope_kind}:${stop.scope_id}`);
    lines.push(`  Why: ${stop.rationale}`);
    if (stop.refs.length > 0) lines.push(`  Refs: ${stop.refs.slice(0, 10).join(", ")}`);
  }
}
