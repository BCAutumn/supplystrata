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
  Gate1ReviewDecision,
  Gate1ReviewItem,
  Gate1ReviewItemKind,
  Gate1ReviewPolicy,
  Gate1ReviewWorkbench,
  Gate1SourcePathProgressLedger
} from "./gate1-run-ledger-definitions.js";
import { gate1DataProgressActions, gate1SourcePathActions } from "./gate1-run-ledger-actions.js";
import { buildGate1MonitoringConfig, gate1SourcePathProgressFromCoverage } from "./gate1-run-ledger-monitoring.js";
import { defaultGate1Namespace, safeGate1Segment } from "./gate1-run-ledger-names.js";
import type { Gate1EntityAffiliationContext } from "./gate1-entity-affiliation-context.js";
import type { OfficialDisclosureReadinessReport } from "./official-disclosure-readiness.js";
import type { SourceTargetCoverageReport } from "./source-target-coverage.js";
import type { SourceTargetPreflightReport } from "./source-target-preflight.js";
import type { SupplyChainExpansionPlan } from "./supply-chain-expansion-plan.js";

export type * from "./gate1-run-ledger-definitions.js";

const GATE1_FACT_EDGE_SCOPE = "research_pack_visible_target_profile_l4_l5_edges";

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
  entity_affiliation_contexts?: readonly Gate1EntityAffiliationContext[];
  source_target_coverage?: SourceTargetCoverageReport;
  source_target_preflight?: SourceTargetPreflightReport | null;
}

export function buildGate1RunLedger(input: Gate1RunLedgerInput): Gate1RunLedger {
  const scorecard = gate1RunScorecard(input.official_disclosure_readiness);
  const dataProgress = gate1DataProgress(input.official_disclosure_readiness);
  const sourcePathProgress = gate1SourcePathProgress(input.official_disclosure_readiness, input.source_target_coverage);
  const mainlinePhase = gate1MainlinePhase({ readiness: input.official_disclosure_readiness, dataProgress, sourcePathProgress });
  const companySwitching = gate1CompanySwitching(input);
  const monitoringConfig = buildGate1MonitoringConfig({
    namespace: input.research_input.sourceTargetNamespace ?? defaultGate1Namespace(input.company_id),
    dataProgress,
    sourcePathProgress,
    sourceTargetPreflight: input.source_target_preflight ?? null
  });
  const actionQueue = gate1RunActions({ input, dataProgress, sourcePathProgress, companySwitching });
  return {
    schema_version: "1.0.0",
    generated_at: input.generated_at,
    company_id: input.company_id,
    mainline_phase: mainlinePhase,
    phase_reason: phaseReason(mainlinePhase),
    scorecard,
    data_progress: dataProgress,
    source_path_progress: sourcePathProgress,
    monitoring_config: monitoringConfig,
    action_queue: actionQueue,
    review_workbench: gate1ReviewWorkbench({ input, actionQueue, companySwitching }),
    company_switching: companySwitching,
    guardrails: [
      "Official source paths and smoke results do not create fact edges.",
      "Observations, leads, and official disclosure signals must stay out of the fact layer until reviewed as evidence.",
      "Single-source silence must become an explicit disposition or unknown; it is not corroboration.",
      "Frontier company switching uses the same generic research run path; do not add company-specific supplier workflows."
    ]
  };
}

function gate1ReviewWorkbench(input: {
  input: Gate1RunLedgerInput;
  actionQueue: readonly Gate1RunAction[];
  companySwitching: Gate1CompanySwitchingLedger;
}): Gate1ReviewWorkbench {
  const items = [
    ...sourceTargetBatchReviewItems(input.actionQueue),
    ...edgeCorroborationReviewItems(input.input),
    ...officialSignalDispositionReviewItems(input.input),
    ...entityAffiliationDispositionReviewItems(input.input),
    ...frontierCompanyReviewItems(input.companySwitching)
  ].sort(compareReviewItems);
  return {
    summary: {
      total_items: items.length,
      source_target_batch_items: items.filter((item) => item.kind === "source_target_batch").length,
      edge_corroboration_items: items.filter((item) => item.kind === "edge_corroboration").length,
      official_signal_disposition_items: items.filter((item) => item.kind === "official_signal_disposition").length,
      entity_affiliation_disposition_items: items.filter((item) => item.kind === "entity_affiliation_disposition").length,
      frontier_company_research_items: items.filter((item) => item.kind === "frontier_company_research").length,
      auto_ranked_items: items.filter((item) => item.policy.automation_hint === "auto_rank_only").length,
      human_approval_required_items: items.filter((item) => item.policy.requires_human_approval).length
    },
    items
  };
}

function sourceTargetBatchReviewItems(actions: readonly Gate1RunAction[]): Gate1ReviewItem[] {
  return actions
    .filter(
      (action) => action.kind === "smoke_targets" || action.kind === "sync_targets" || action.kind === "enable_targets" || action.kind === "run_due_targets"
    )
    .map((action) => {
      const recommended = sourceTargetDecision(action.kind);
      return reviewItem({
        review_item_id: `${action.action_id}:review`,
        kind: "source_target_batch",
        priority: action.priority,
        title: action.title,
        rationale: action.rationale,
        recommended_decision: recommended,
        allowed_decisions: [recommended, "defer"],
        write_effect: action.kind === "smoke_targets" ? "none" : "source_target_state_change",
        policy: reviewPolicy("auto_prepare_command_only", true),
        command_hint: action.command_hint,
        refs: action.refs
      });
    });
}

function edgeCorroborationReviewItems(input: Gate1RunLedgerInput): Gate1ReviewItem[] {
  return input.official_disclosure_readiness.corroboration_queue.slice(0, 80).map((item) => {
    const proposedUnknownId = item.proposed_unknown?.unknown_id ?? null;
    return reviewItem({
      review_item_id: `gate1:edge-corroboration:${item.edge_id}`,
      kind: "edge_corroboration",
      priority: item.priority,
      title: `Resolve corroboration for ${item.from_name} -> ${item.to_name}`,
      rationale: item.reason,
      recommended_decision: item.disposition === "needs_explicit_single_source_disposition" ? "record_single_source_unknown" : "needs_more_evidence",
      allowed_decisions: edgeCorroborationDecisions(item.disposition),
      write_effect: proposedUnknownId === null ? "review_change_only" : "unknown_materialization_after_review",
      policy: reviewPolicy(proposedUnknownId === null ? "auto_rank_only" : "auto_materialize_after_recorded_disposition", true),
      command_hint: edgeCorroborationDispositionCommand(item, proposedUnknownId),
      refs: [item.edge_id, ...item.source_plan_refs, ...item.unknown_ids, ...(proposedUnknownId === null ? [] : [proposedUnknownId])],
      edge_id: item.edge_id,
      unknown_id: proposedUnknownId
    });
  });
}

function edgeCorroborationDispositionCommand(
  item: Gate1RunLedgerInput["official_disclosure_readiness"]["corroboration_queue"][number],
  proposedUnknownId: string | null
): string {
  const decision =
    item.disposition === "needs_explicit_single_source_disposition" || item.latest_disposition?.decision === "record_single_source_unknown"
      ? "record_single_source_unknown"
      : "needs_more_evidence";
  const firstTarget = item.source_targets[0];
  const checkTargetFlag =
    firstTarget?.check_target_id === undefined || firstTarget.check_target_id === null ? "" : ` --check-target ${firstTarget.check_target_id}`;
  const unknownFlag = proposedUnknownId === null ? "" : ` --unknown ${proposedUnknownId}`;
  return (
    `pnpm --silent cli review edge-corroboration-disposition ${item.edge_id}` +
    ` --decision ${decision}` +
    " --reviewer <reviewer>" +
    ' --reason "<why the second-source review is or is not enough>"' +
    checkTargetFlag +
    unknownFlag
  );
}

function officialSignalDispositionReviewItems(input: Gate1RunLedgerInput): Gate1ReviewItem[] {
  return input.official_disclosure_readiness.official_disclosure_signal_correlation_hints
    .filter((hint) => hint.disposition_status === "open")
    .slice(0, 80)
    .map((hint) =>
      reviewItem({
        review_item_id: `gate1:official-signal:${hint.review_id}:${hint.edge_id}`,
        kind: "official_signal_disposition",
        priority: "P1",
        title: `Record official signal disposition for ${hint.edge_summary}`,
        rationale: `${hint.action} Match reasons: ${hint.match_reasons.join(", ")}.`,
        recommended_decision: hint.disposition === "needs_explicit_single_source_disposition" ? "record_single_source_unknown" : "needs_more_evidence",
        allowed_decisions: [
          "supports_existing_edge",
          "needs_more_evidence",
          "not_relevant",
          "record_single_source_unknown",
          "create_counterparty_source_target",
          "defer"
        ],
        write_effect: "review_change_only",
        policy: reviewPolicy("auto_rank_only", true),
        command_hint: officialSignalDispositionCommand(hint),
        refs: [hint.review_id, hint.edge_id, hint.source_adapter_id],
        edge_id: hint.edge_id,
        review_id: hint.review_id
      })
    );
}

function officialSignalDispositionCommand(
  hint: Gate1RunLedgerInput["official_disclosure_readiness"]["official_disclosure_signal_correlation_hints"][number]
): string {
  const decision = hint.disposition === "needs_explicit_single_source_disposition" ? "record_single_source_unknown" : "needs_more_evidence";
  return (
    `pnpm --silent cli review signal-disposition ${hint.review_id}` +
    ` --edge ${hint.edge_id}` +
    ` --decision ${decision}` +
    " --reviewer <reviewer>" +
    ' --reason "<why this official signal is or is not enough for the edge>"'
  );
}

function entityAffiliationDispositionReviewItems(input: Gate1RunLedgerInput): Gate1ReviewItem[] {
  return (input.entity_affiliation_contexts ?? [])
    .filter((context) => context.latest_disposition === null)
    .slice(0, 40)
    .map((context) => {
      const parentName = context.parent_name ?? context.parent_entity_id;
      return reviewItem({
        review_item_id: `gate1:entity-affiliation:${safeGate1Segment(context.subject_entity_id)}:${safeGate1Segment(context.parent_entity_id)}`,
        kind: "entity_affiliation_disposition",
        priority: context.parent_unknown_ids.length > 0 ? "P0" : "P1",
        title: `Record entity affiliation disposition for ${context.subject_name}`,
        rationale:
          `${context.subject_name} is modeled as ${context.subject_kind} under ${parentName}. ` +
          "Record the reviewed research scope before using parent legal-entity source paths for recursive expansion.",
        recommended_decision: "review_entity_affiliation",
        allowed_decisions: ["research_parent_entity", "research_child_entity", "research_both_scopes", "keep_unknown_open", "not_relevant", "defer"],
        write_effect: "review_change_only",
        policy: reviewPolicy("auto_rank_only", true),
        command_hint: entityAffiliationDispositionCommand(context),
        refs: uniqueSorted([
          context.context_id,
          context.subject_entity_id,
          context.parent_entity_id,
          ...context.edge_ids,
          ...context.component_ids,
          ...context.parent_unknown_ids
        ]),
        edge_id: context.edge_ids[0] ?? null,
        unknown_id: context.parent_unknown_ids[0] ?? null
      });
    });
}

function frontierCompanyReviewItems(companySwitching: Gate1CompanySwitchingLedger): Gate1ReviewItem[] {
  return companySwitching.next_research_targets.slice(0, 10).map((target, index) =>
    reviewItem({
      review_item_id: `gate1:frontier-review:${safeGate1Segment(target.company_id)}:${safeGate1Segment(target.component_id)}:${index + 1}`,
      kind: "frontier_company_research",
      priority: "P2",
      title: `Open frontier research for ${target.company_name}`,
      rationale: target.rationale,
      recommended_decision: "open_frontier_research_pack",
      allowed_decisions: ["open_frontier_research_pack", "defer"],
      write_effect: "none",
      policy: reviewPolicy("auto_prepare_command_only", false),
      command_hint: target.command_hint,
      refs: [target.seed_edge_id, ...target.unknown_ids],
      edge_id: target.seed_edge_id
    })
  );
}

function reviewItem(input: {
  review_item_id: string;
  kind: Gate1ReviewItemKind;
  priority: Gate1ReviewItem["priority"];
  title: string;
  rationale: string;
  recommended_decision: Gate1ReviewDecision;
  allowed_decisions: Gate1ReviewDecision[];
  write_effect: Gate1ReviewItem["write_effect"];
  policy: Gate1ReviewPolicy;
  command_hint: string | null;
  refs: string[];
  edge_id?: string | null;
  review_id?: string | null;
  unknown_id?: string | null;
  check_target_id?: string | null;
}): Gate1ReviewItem {
  return {
    review_item_id: input.review_item_id,
    kind: input.kind,
    priority: input.priority,
    title: input.title,
    rationale: input.rationale,
    recommended_decision: input.recommended_decision,
    allowed_decisions: uniqueDecisions(input.allowed_decisions),
    write_effect: input.write_effect,
    policy: input.policy,
    command_hint: input.command_hint,
    refs: uniqueSorted(input.refs),
    edge_id: input.edge_id ?? null,
    review_id: input.review_id ?? null,
    unknown_id: input.unknown_id ?? null,
    check_target_id: input.check_target_id ?? null
  };
}

function entityAffiliationDispositionCommand(context: Gate1EntityAffiliationContext): string {
  const edgeFlag = context.edge_ids.length === 0 ? "" : ` --edge ${context.edge_ids.join(",")}`;
  const componentFlag = context.component_ids.length === 0 ? "" : ` --component ${context.component_ids.join(",")}`;
  const unknownFlag = context.parent_unknown_ids.length === 0 ? "" : ` --unknown ${context.parent_unknown_ids.join(",")}`;
  return (
    `pnpm --silent cli review entity-affiliation-disposition ${context.context_id}` +
    ` --subject ${context.subject_entity_id}` +
    ` --parent ${context.parent_entity_id}` +
    ' --decision research_parent_entity --reviewer <reviewer> --reason "<why this entity scope is appropriate>"' +
    edgeFlag +
    componentFlag +
    unknownFlag
  );
}

function gate1RunScorecard(report: OfficialDisclosureReadinessReport): Gate1RunScorecard {
  return {
    status: report.scorecard.status,
    overall_progress: report.scorecard.overall_progress,
    data_progress: report.scorecard.data_progress,
    source_path_progress: report.scorecard.source_path_progress,
    fact_edge_scope: GATE1_FACT_EDGE_SCOPE,
    l4_l5_fact_edges: report.summary.level_4_5_fact_edges,
    l4_l5_fact_edge_target: criterionTarget(report, "level_4_5_fact_edge_coverage"),
    cross_source_ratio: report.summary.corroboration_ratio,
    cross_source_target: criterionTarget(report, "corroboration_or_disposition_coverage"),
    traceable_edges: report.summary.traceable_edges,
    traceable_edge_target: criterionTarget(report, "fact_edge_traceability")
  };
}

function gate1DataProgress(report: OfficialDisclosureReadinessReport): Gate1DataProgressLedger {
  const l4l5Target = criterionTarget(report, "level_4_5_fact_edge_coverage");
  return {
    fact_edge_scope: GATE1_FACT_EDGE_SCOPE,
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
    official_signal_correlation_hints: report.summary.official_disclosure_signal_correlation_hints,
    open_official_signal_correlation_hints: report.summary.open_official_disclosure_signal_correlation_hints,
    next_focus: dataProgressFocus(report)
  };
}

function gate1SourcePathProgress(
  report: OfficialDisclosureReadinessReport,
  sourceTargetCoverage: SourceTargetCoverageReport | undefined
): Gate1SourcePathProgressLedger {
  return gate1SourcePathProgressFromCoverage(
    {
      expected_source_links: report.summary.expected_official_source_links,
      expected_source_links_with_coverage: report.summary.expected_official_source_links_with_coverage,
      expected_source_links_gap: Math.max(0, report.summary.expected_official_source_links - report.summary.expected_official_source_links_with_coverage),
      runnable_targets: report.summary.runnable_official_targets,
      synced_targets: report.summary.synced_official_targets,
      due_targets: report.summary.due_official_targets,
      degraded_targets: report.summary.degraded_official_targets,
      targets_with_observations: report.summary.official_targets_with_observations,
      next_focus: sourcePathFocus(report)
    },
    sourceTargetCoverage
  );
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

function sourceTargetDecision(kind: Gate1RunAction["kind"]): Gate1ReviewDecision {
  if (kind === "smoke_targets") return "approve_smoke";
  if (kind === "enable_targets") return "approve_enable";
  if (kind === "run_due_targets") return "approve_run_due";
  return "approve_sync";
}

function edgeCorroborationDecisions(disposition: string): Gate1ReviewDecision[] {
  if (disposition === "needs_explicit_single_source_disposition") return ["record_single_source_unknown", "needs_more_evidence", "defer"];
  if (disposition === "needs_counterparty_source_target") return ["create_counterparty_source_target", "needs_more_evidence", "defer"];
  if (disposition === "single_source_disposition_recorded") return ["needs_more_evidence", "defer"];
  if (disposition === "needs_traceability_backfill") return ["needs_more_evidence", "defer"];
  return ["needs_more_evidence", "record_single_source_unknown", "defer"];
}

function reviewPolicy(automationHint: Gate1ReviewPolicy["automation_hint"], requiresHumanApproval: boolean): Gate1ReviewPolicy {
  return {
    review_policy: "review_only_no_fact_mutation",
    automatic_fact_mutation_allowed: false,
    allowed_edge_mutation: "none",
    requires_human_approval: requiresHumanApproval,
    automation_hint: automationHint
  };
}

function gate1RunActions(input: {
  input: Gate1RunLedgerInput;
  dataProgress: Gate1DataProgressLedger;
  sourcePathProgress: Gate1SourcePathProgressLedger;
  companySwitching: Gate1CompanySwitchingLedger;
}): Gate1RunAction[] {
  return [
    ...gate1SourcePathActions(input.input, input.sourcePathProgress),
    ...gate1DataProgressActions(input.input, input.dataProgress),
    ...companySwitchingActions(input.companySwitching)
  ].sort(compareActions);
}

function companySwitchingActions(companySwitching: Gate1CompanySwitchingLedger): Gate1RunAction[] {
  return companySwitching.next_research_targets.slice(0, 5).map((target, index) => ({
    action_id: `gate1:frontier:${safeGate1Segment(target.company_id)}:${safeGate1Segment(target.component_id)}:${index + 1}`,
    kind: "expand_frontier_company",
    priority: "P2",
    title: `Run generic research pack for ${target.company_name}`,
    rationale: target.rationale,
    command_hint: target.command_hint,
    refs: [target.seed_edge_id, ...target.unknown_ids]
  }));
}

function gate1CompanySwitching(input: Gate1RunLedgerInput): Gate1CompanySwitchingLedger {
  const directTargets = input.supply_chain_expansion_plan.frontier
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
        scope_kind: "direct_frontier_company",
        source_entity_id: companyId,
        source_entity_name: companyName,
        entity_context_id: null,
        suggested_company_query: companyId,
        suggested_components: [componentId],
        command_hint: frontierResearchCommand(input, companyId, componentId),
        rationale: item.rationale,
        unknown_ids: [...item.unknown_ids]
      };
    });
  const affiliationTargets = affiliationParentResearchTargets(input);
  const targets = [...affiliationTargets, ...directTargets];
  return {
    frontier_companies: input.supply_chain_expansion_plan.summary.frontier_companies,
    next_research_targets: dedupeCompanyTargets(targets).slice(0, 20),
    next_focus:
      targets.length === 0
        ? "No component-scoped frontier company is ready for generic switching."
        : "Use the same research run entrypoint for frontier counterparties or reviewed parent legal-entity scopes; do not create company-specific supplier workflows."
  };
}

function affiliationParentResearchTargets(input: Gate1RunLedgerInput): Gate1CompanyResearchTarget[] {
  return (input.entity_affiliation_contexts ?? []).filter(shouldOfferParentResearchTarget).flatMap((context) =>
    context.component_ids.map((componentId): Gate1CompanyResearchTarget => {
      const seedEdgeId = context.edge_ids[0] ?? context.context_id;
      return {
        company_id: context.parent_entity_id,
        company_name: context.parent_name ?? context.parent_entity_id,
        component_id: componentId,
        seed_edge_id: seedEdgeId,
        scope_kind: "affiliation_parent_entity",
        source_entity_id: context.subject_entity_id,
        source_entity_name: context.subject_name,
        entity_context_id: context.context_id,
        suggested_company_query: context.parent_entity_id,
        suggested_components: [componentId],
        command_hint: frontierResearchCommand(input, context.parent_entity_id, componentId),
        rationale: affiliationParentResearchRationale(context),
        unknown_ids: uniqueSorted([...unknownIdsForContext(input.official_disclosure_readiness, context.edge_ids), ...context.parent_unknown_ids])
      };
    })
  );
}

function shouldOfferParentResearchTarget(context: Gate1EntityAffiliationContext): boolean {
  const decision = context.latest_disposition?.decision ?? null;
  return decision === "research_parent_entity" || decision === "research_both_scopes";
}

function affiliationParentResearchRationale(context: Gate1EntityAffiliationContext): string {
  const parentName = context.parent_name ?? context.parent_entity_id;
  if (context.latest_disposition === null) throw new Error(`Cannot open parent research target without entity affiliation disposition: ${context.context_id}`);
  return `${context.subject_name} is attached to ${parentName}; latest disposition ${context.latest_disposition.change_id} chose ${context.latest_disposition.decision}, so this target follows the reviewed parent legal-entity scope.`;
}

function frontierResearchCommand(input: Gate1RunLedgerInput, companyId: string, componentId: string): string {
  const parts = [
    "supplystrata research run",
    `--company ${companyId}`,
    `--component ${componentId}`,
    `--depth ${String(input.research_input.depth ?? 3)}`,
    `--source-target-namespace ${defaultGate1Namespace(companyId)}`,
    `--out reports/${safeGate1Segment(companyId)}-${safeGate1Segment(componentId)}-research-pack`
  ];
  if (input.research_input.officialDisclosureYear !== undefined) parts.splice(4, 0, `--official-year ${input.research_input.officialDisclosureYear}`);
  if (input.research_input.researchTargetProfileId !== undefined) parts.splice(4, 0, `--target-profile ${input.research_input.researchTargetProfileId}`);
  return parts.join(" ");
}

function unknownIdsForContext(report: OfficialDisclosureReadinessReport, edgeIds: readonly string[]): string[] {
  const edgeIdSet = new Set(edgeIds);
  return uniqueSorted([
    ...report.edges.filter((edge) => edgeIdSet.has(edge.edge_id)).flatMap((edge) => edge.unknown_ids),
    ...report.corroboration_queue
      .filter((item) => edgeIdSet.has(item.edge_id))
      .flatMap((item) => [...item.unknown_ids, ...(item.proposed_unknown === null ? [] : [item.proposed_unknown.unknown_id])])
  ]);
}

function criterionTarget(report: OfficialDisclosureReadinessReport, criterionId: string): number {
  return report.scorecard.criteria.find((criterion) => criterion.criterion_id === criterionId)?.target ?? 0;
}

function dataProgressFocus(report: OfficialDisclosureReadinessReport): string {
  if (report.summary.level_4_5_fact_edges < criterionTarget(report, "level_4_5_fact_edge_coverage")) {
    return "Increase reviewed L4/L5 fact edge coverage from official evidence.";
  }
  if (report.summary.corroboration_or_disposition_ratio < criterionTarget(report, "corroboration_or_disposition_coverage")) {
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

function compareActions(left: Gate1RunAction, right: Gate1RunAction): number {
  return priorityOrder(left.priority) - priorityOrder(right.priority) || left.action_id.localeCompare(right.action_id);
}

function compareReviewItems(left: Gate1ReviewItem, right: Gate1ReviewItem): number {
  return (
    priorityOrder(left.priority) - priorityOrder(right.priority) ||
    reviewKindOrder(left.kind) - reviewKindOrder(right.kind) ||
    left.review_item_id.localeCompare(right.review_item_id)
  );
}

function reviewKindOrder(kind: Gate1ReviewItemKind): number {
  if (kind === "source_target_batch") return 0;
  if (kind === "edge_corroboration") return 1;
  if (kind === "official_signal_disposition") return 2;
  if (kind === "entity_affiliation_disposition") return 3;
  return 4;
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

function uniqueDecisions(decisions: readonly Gate1ReviewDecision[]): Gate1ReviewDecision[] {
  return [...new Set(decisions)];
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
