import type { CorroborationSourcePlan } from "./corroboration-source-plan.js";
import type { ResearchPackInput } from "./definitions.js";
import type {
  Gate1CompanyResearchTarget,
  Gate1CompanySwitchingLedger,
  Gate1DataProgressLedger,
  Gate1MainlinePhase,
  Gate1RunAction,
  Gate1RunLedger,
  Gate1RunScorecard,
  Gate1SourcePathProgressLedger
} from "./gate1-run-ledger-definitions.js";
import type { OfficialDisclosureReadinessReport } from "./official-disclosure-readiness.js";
import type { SupplyChainExpansionPlan } from "./supply-chain-expansion-plan.js";

export type * from "./gate1-run-ledger-definitions.js";

export interface Gate1RunLedgerInput {
  generated_at: string;
  company_id: string;
  research_input: Pick<
    ResearchPackInput,
    "company" | "depth" | "officialDisclosureYear" | "researchTargetProfileId" | "sourceTargetNamespace" | "supplyChainExpansionMaxDepth"
  >;
  official_disclosure_readiness: OfficialDisclosureReadinessReport;
  corroboration_source_plan: CorroborationSourcePlan;
  supply_chain_expansion_plan: SupplyChainExpansionPlan;
}

export function buildGate1RunLedger(input: Gate1RunLedgerInput): Gate1RunLedger {
  const scorecard = gate1RunScorecard(input.official_disclosure_readiness);
  const dataProgress = gate1DataProgress(input.official_disclosure_readiness);
  const sourcePathProgress = gate1SourcePathProgress(input.official_disclosure_readiness);
  const mainlinePhase = gate1MainlinePhase({ readiness: input.official_disclosure_readiness, dataProgress, sourcePathProgress });
  const companySwitching = gate1CompanySwitching(input);
  return {
    schema_version: "1.0.0",
    generated_at: input.generated_at,
    company_id: input.company_id,
    mainline_phase: mainlinePhase,
    phase_reason: phaseReason(mainlinePhase),
    scorecard,
    data_progress: dataProgress,
    source_path_progress: sourcePathProgress,
    action_queue: gate1RunActions({ input, dataProgress, sourcePathProgress, companySwitching }),
    company_switching: companySwitching,
    guardrails: [
      "Official source paths and smoke results do not create fact edges.",
      "Observations, leads, and official disclosure signals must stay out of the fact layer until reviewed as evidence.",
      "Single-source silence must become an explicit disposition or unknown; it is not corroboration.",
      "Frontier company switching uses the same generic research run path; do not add company-specific supplier workflows."
    ]
  };
}

function gate1RunScorecard(report: OfficialDisclosureReadinessReport): Gate1RunScorecard {
  return {
    status: report.scorecard.status,
    overall_progress: report.scorecard.overall_progress,
    data_progress: report.scorecard.data_progress,
    source_path_progress: report.scorecard.source_path_progress,
    l4_l5_fact_edges: report.summary.level_4_5_fact_edges,
    l4_l5_fact_edge_target: criterionTarget(report, "level_4_5_fact_edge_coverage"),
    cross_source_ratio: report.summary.corroboration_ratio,
    cross_source_target: criterionTarget(report, "cross_source_corroboration"),
    traceable_edges: report.summary.traceable_edges,
    traceable_edge_target: criterionTarget(report, "fact_edge_traceability")
  };
}

function gate1DataProgress(report: OfficialDisclosureReadinessReport): Gate1DataProgressLedger {
  const l4l5Target = criterionTarget(report, "level_4_5_fact_edge_coverage");
  return {
    l4_l5_fact_edges: report.summary.level_4_5_fact_edges,
    l4_l5_fact_edge_target: l4l5Target,
    fact_edge_gap: Math.max(0, l4l5Target - report.summary.level_4_5_fact_edges),
    cross_source_edges: report.summary.cross_source_edges,
    single_source_edges: report.summary.single_source_edges,
    corroboration_queue_items: report.summary.corroboration_queue_items,
    corroboration_queue_with_runnable_targets: report.summary.corroboration_queue_with_runnable_targets,
    corroboration_queue_needing_disposition: report.summary.corroboration_queue_needing_disposition,
    corroboration_queue_recorded_disposition: report.summary.corroboration_queue_with_recorded_disposition,
    proposed_single_source_unknowns: report.summary.corroboration_queue_proposed_unknowns,
    next_focus: dataProgressFocus(report)
  };
}

function gate1SourcePathProgress(report: OfficialDisclosureReadinessReport): Gate1SourcePathProgressLedger {
  return {
    expected_source_links: report.summary.expected_official_source_links,
    expected_source_links_with_coverage: report.summary.expected_official_source_links_with_coverage,
    expected_source_links_gap: Math.max(0, report.summary.expected_official_source_links - report.summary.expected_official_source_links_with_coverage),
    runnable_targets: report.summary.runnable_official_targets,
    synced_targets: report.summary.synced_official_targets,
    due_targets: report.summary.due_official_targets,
    degraded_targets: report.summary.degraded_official_targets,
    targets_with_observations: report.summary.official_targets_with_observations,
    next_focus: sourcePathFocus(report)
  };
}

function gate1MainlinePhase(input: {
  readiness: OfficialDisclosureReadinessReport;
  dataProgress: Gate1DataProgressLedger;
  sourcePathProgress: Gate1SourcePathProgressLedger;
}): Gate1MainlinePhase {
  if (input.readiness.scorecard.status === "pass") return "gate1_complete";
  if (input.dataProgress.fact_edge_gap > 0 && input.sourcePathProgress.targets_with_observations > 0) return "increase_l4_l5_fact_edges";
  if (input.dataProgress.corroboration_queue_items > 0) return "resolve_corroboration";
  if (input.sourcePathProgress.due_targets > 0) return "run_official_source_targets";
  if (input.sourcePathProgress.runnable_targets > input.sourcePathProgress.synced_targets) return "sync_official_source_targets";
  if (input.sourcePathProgress.expected_source_links_gap > 0) return "wire_expected_source_paths";
  return "expand_frontier_companies";
}

function phaseReason(phase: Gate1MainlinePhase): string {
  switch (phase) {
    case "gate1_complete":
      return "Gate 1 scorecard has passed all tracked criteria.";
    case "increase_l4_l5_fact_edges":
      return "Official observations or review signals exist; convert only validated evidence into L4/L5 fact candidates.";
    case "resolve_corroboration":
      return "Single-source L4/L5 edges remain unresolved; check counterparty official sources or record explicit disposition.";
    case "run_official_source_targets":
      return "Some official source targets are due and should run through the source monitor before more planning.";
    case "sync_official_source_targets":
      return "Runnable official targets exist but are not yet synced into source_check_targets.";
    case "wire_expected_source_paths":
      return "Target-profile expected official sources still need concrete source-plan paths.";
    case "expand_frontier_companies":
      return "Current company frontier can seed the next generic company research run.";
  }
}

function gate1RunActions(input: {
  input: Gate1RunLedgerInput;
  dataProgress: Gate1DataProgressLedger;
  sourcePathProgress: Gate1SourcePathProgressLedger;
  companySwitching: Gate1CompanySwitchingLedger;
}): Gate1RunAction[] {
  return [
    ...sourcePathActions(input.input, input.sourcePathProgress),
    ...dataProgressActions(input.input, input.dataProgress),
    ...companySwitchingActions(input.companySwitching)
  ].sort(compareActions);
}

function sourcePathActions(input: Gate1RunLedgerInput, progress: Gate1SourcePathProgressLedger): Gate1RunAction[] {
  const sourcePlanRef = "source-plan.json";
  const namespace = input.research_input.sourceTargetNamespace ?? defaultNamespace(input.company_id);
  const actions: Gate1RunAction[] = [];
  if (progress.runnable_targets > progress.synced_targets) {
    actions.push({
      action_id: "gate1:source-targets:sync",
      kind: "sync_targets",
      priority: "P0",
      title: "Sync runnable official source targets",
      rationale: `${progress.runnable_targets - progress.synced_targets} runnable official targets are not yet synced into source_check_targets.`,
      command_hint: `supplystrata sources policy sync-plan-targets --source-plan ${sourcePlanRef} --namespace ${namespace}`,
      refs: [sourcePlanRef, "source-target-coverage.json"]
    });
  }
  if (progress.due_targets > 0) {
    actions.push({
      action_id: "gate1:source-targets:run-due",
      kind: "run_due_targets",
      priority: "P0",
      title: "Run due official source targets",
      rationale: `${progress.due_targets} official source targets are due in the current coverage report.`,
      command_hint: `supplystrata sources run-due --source-plan ${sourcePlanRef} --namespace ${namespace}`,
      refs: [sourcePlanRef, "source-target-coverage.json"]
    });
  }
  if (progress.targets_with_observations > 0) {
    actions.push({
      action_id: "gate1:observations:review",
      kind: "review_observations",
      priority: "P1",
      title: "Review official observations before fact writes",
      rationale: `${progress.targets_with_observations} official targets already produced observations; useful disclosures should become reviewable evidence candidates, not automatic edges.`,
      command_hint: null,
      refs: ["source-target-coverage.json", "official-disclosure-readiness.json"]
    });
  }
  return actions;
}

function dataProgressActions(input: Gate1RunLedgerInput, progress: Gate1DataProgressLedger): Gate1RunAction[] {
  const actions: Gate1RunAction[] = [];
  if (progress.corroboration_queue_with_runnable_targets > 0) {
    actions.push({
      action_id: "gate1:corroboration:smoke",
      kind: "smoke_targets",
      priority: "P0",
      title: "Smoke counterparty corroboration targets",
      rationale: `${progress.corroboration_queue_with_runnable_targets} single-source edges have runnable counterparty paths; smoke/sync them before recording final disposition.`,
      command_hint: "supplystrata sources policy smoke-plan-targets --source-plan corroboration-source-plan-smoke.json",
      refs: ["corroboration-source-plan.json", "official-disclosure-readiness.json"]
    });
  }
  if (progress.proposed_single_source_unknowns > 0) {
    actions.push({
      action_id: "gate1:corroboration:single-source-disposition",
      kind: "record_single_source_disposition",
      priority: "P1",
      title: "Materialize explicit single-source unknowns",
      rationale: `${progress.proposed_single_source_unknowns} proposed single-source unknowns are ready for controlled materialization if review confirms no second-source path.`,
      command_hint: "supplystrata intelligence single-source-unknowns --readiness official-disclosure-readiness.json",
      refs: ["official-disclosure-readiness.json"]
    });
  }
  if (progress.fact_edge_gap > 0) {
    actions.push({
      action_id: "gate1:facts:l4-l5-candidates",
      kind: "create_fact_edge_candidates",
      priority: "P1",
      title: "Increase reviewed L4/L5 fact edge coverage",
      rationale: `Gate 1 still needs ${progress.fact_edge_gap} additional L4/L5 fact edges; only traceable official evidence should enter review/apply.`,
      command_hint: null,
      refs: ["investigation-backlog.json", "official-disclosure-readiness.json"]
    });
  }
  return actions;
}

function companySwitchingActions(companySwitching: Gate1CompanySwitchingLedger): Gate1RunAction[] {
  return companySwitching.next_research_targets.slice(0, 5).map((target, index) => ({
    action_id: `gate1:frontier:${safeSegment(target.company_id)}:${safeSegment(target.component_id)}:${index + 1}`,
    kind: "expand_frontier_company",
    priority: "P2",
    title: `Run generic research pack for ${target.company_name}`,
    rationale: target.rationale,
    command_hint: target.command_hint,
    refs: [target.seed_edge_id, ...target.unknown_ids]
  }));
}

function gate1CompanySwitching(input: Gate1RunLedgerInput): Gate1CompanySwitchingLedger {
  const targets = input.supply_chain_expansion_plan.frontier
    .filter(
      (item) => item.expansion_state === "expand_candidate" && item.next_company_id !== null && item.next_company_name !== null && item.component_id !== null
    )
    .map((item): Gate1CompanyResearchTarget => {
      const companyId = item.next_company_id;
      const companyName = item.next_company_name;
      const componentId = item.component_id;
      if (companyId === null || companyName === null || componentId === null) {
        throw new Error("expand_candidate frontier item must include company and component context");
      }
      return {
        company_id: companyId,
        company_name: companyName,
        component_id: componentId,
        seed_edge_id: item.edge_id,
        suggested_company_query: companyId,
        suggested_components: [componentId],
        command_hint: frontierResearchCommand(input, companyId, componentId),
        rationale: item.rationale,
        unknown_ids: [...item.unknown_ids]
      };
    });
  return {
    frontier_companies: input.supply_chain_expansion_plan.summary.frontier_companies,
    next_research_targets: dedupeCompanyTargets(targets).slice(0, 20),
    next_focus:
      targets.length === 0
        ? "No component-scoped frontier company is ready for generic switching."
        : "Use the same research run entrypoint for frontier counterparties; do not create company-specific supplier workflows."
  };
}

function frontierResearchCommand(input: Gate1RunLedgerInput, companyId: string, componentId: string): string {
  const parts = [
    "supplystrata research run",
    `--company ${companyId}`,
    `--component ${componentId}`,
    `--depth ${String(input.research_input.depth ?? 3)}`,
    `--source-target-namespace ${defaultNamespace(companyId)}`,
    `--out reports/${safeSegment(companyId)}-${safeSegment(componentId)}-research-pack`
  ];
  if (input.research_input.officialDisclosureYear !== undefined) parts.splice(4, 0, `--official-year ${input.research_input.officialDisclosureYear}`);
  if (input.research_input.researchTargetProfileId !== undefined) parts.splice(4, 0, `--target-profile ${input.research_input.researchTargetProfileId}`);
  return parts.join(" ");
}

function criterionTarget(report: OfficialDisclosureReadinessReport, criterionId: string): number {
  return report.scorecard.criteria.find((criterion) => criterion.criterion_id === criterionId)?.target ?? 0;
}

function dataProgressFocus(report: OfficialDisclosureReadinessReport): string {
  if (report.summary.level_4_5_fact_edges < criterionTarget(report, "level_4_5_fact_edge_coverage")) {
    return "Increase reviewed L4/L5 fact edge coverage from official evidence.";
  }
  if (report.summary.corroboration_ratio < criterionTarget(report, "cross_source_corroboration")) {
    return "Resolve single-source edges through counterparty official checks or explicit disposition.";
  }
  return "Data progress meets the current Gate 1 thresholds.";
}

function sourcePathFocus(report: OfficialDisclosureReadinessReport): string {
  if (report.summary.expected_official_source_links_with_coverage < report.summary.expected_official_source_links) {
    return "Wire remaining expected official source links into concrete source-plan targets.";
  }
  if (report.summary.synced_official_targets < report.summary.runnable_official_targets) {
    return "Sync runnable official targets into source_check_targets.";
  }
  if (report.summary.due_official_targets > 0) return "Run due official targets through the source monitor.";
  return "Source paths are ready; focus on reviewed data progress.";
}

function defaultNamespace(companyId: string): string {
  return `research-${companyId.toLowerCase()}`;
}

function compareActions(left: Gate1RunAction, right: Gate1RunAction): number {
  return priorityOrder(left.priority) - priorityOrder(right.priority) || left.action_id.localeCompare(right.action_id);
}

function priorityOrder(priority: Gate1RunAction["priority"]): number {
  if (priority === "P0") return 0;
  if (priority === "P1") return 1;
  if (priority === "P2") return 2;
  return 3;
}

function dedupeCompanyTargets(targets: readonly Gate1CompanyResearchTarget[]): Gate1CompanyResearchTarget[] {
  const seen = new Set<string>();
  const deduped: Gate1CompanyResearchTarget[] = [];
  for (const target of targets) {
    const key = `${target.company_id}:${target.component_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(target);
  }
  return deduped;
}

function safeSegment(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (cleaned.length === 0) throw new Error(`Cannot create a file segment from empty value: ${value}`);
  return cleaned;
}
