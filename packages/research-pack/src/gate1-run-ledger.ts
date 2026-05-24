import type { CorroborationSourcePlan } from "./corroboration-source-plan.js";
import type { ResearchPackInput } from "./definitions.js";
import type {
  Gate1CompanyResearchTarget,
  Gate1CompanySwitchingLedger,
  Gate1DataProgressLedger,
  Gate1MainlinePhase,
  Gate1MonitoringBatch,
  Gate1MonitoringConfigLedger,
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
  const monitoringConfig = gate1MonitoringConfig({ input, dataProgress, sourcePathProgress });
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

const GATE1_MONITORING_TARGET_SCHEDULE_DEFAULTS = {
  enabled_on_sync: false,
  enable_after_review: true,
  check_cadence_minutes: 10_080,
  jitter_minutes: 120,
  max_attempts: 3,
  backoff_base_minutes: 2,
  backoff_max_minutes: 120,
  next_check_at: null
} as const;

function gate1MonitoringConfig(input: {
  input: Gate1RunLedgerInput;
  dataProgress: Gate1DataProgressLedger;
  sourcePathProgress: Gate1SourcePathProgressLedger;
}): Gate1MonitoringConfigLedger {
  const namespace = input.input.research_input.sourceTargetNamespace ?? defaultNamespace(input.input.company_id);
  return {
    config_surface: "source_policy_config",
    namespace,
    target_schedule_defaults: GATE1_MONITORING_TARGET_SCHEDULE_DEFAULTS,
    configurable_fields: [
      monitoringField("check_cadence_minutes", "Check cadence", "minutes", 1, GATE1_MONITORING_TARGET_SCHEDULE_DEFAULTS.check_cadence_minutes, "number_input"),
      monitoringField("jitter_minutes", "Jitter", "minutes", 0, GATE1_MONITORING_TARGET_SCHEDULE_DEFAULTS.jitter_minutes, "number_input"),
      monitoringField("max_attempts", "Retry attempts", "count", 1, GATE1_MONITORING_TARGET_SCHEDULE_DEFAULTS.max_attempts, "number_input"),
      monitoringField(
        "backoff_base_minutes",
        "Retry backoff base",
        "minutes",
        1,
        GATE1_MONITORING_TARGET_SCHEDULE_DEFAULTS.backoff_base_minutes,
        "number_input"
      ),
      monitoringField("backoff_max_minutes", "Retry backoff max", "minutes", 1, GATE1_MONITORING_TARGET_SCHEDULE_DEFAULTS.backoff_max_minutes, "number_input"),
      monitoringField("next_check_at", "Initial next check", "iso_datetime_or_null", null, null, "datetime_input")
    ],
    batches: monitoringBatches({
      namespace,
      sourcePathProgress: input.sourcePathProgress,
      dataProgress: input.dataProgress
    }),
    guardrails: [
      "Syncing a target writes source_check_targets only; it does not fetch documents.",
      "Enabling a target starts scheduled monitoring only after review; it does not create fact edges.",
      "Smoke runs stay no-database and should happen before syncing or enabling uncertain corroboration targets.",
      "Cadence, jitter, retry, backoff, and next_check_at are configuration fields for source policy/target state, not research conclusions."
    ]
  };
}

function monitoringField(
  field: Gate1MonitoringConfigLedger["configurable_fields"][number]["field"],
  label: string,
  unit: Gate1MonitoringConfigLedger["configurable_fields"][number]["unit"],
  min: number | null,
  recommended: number | null,
  frontendControl: Gate1MonitoringConfigLedger["configurable_fields"][number]["frontend_control"]
): Gate1MonitoringConfigLedger["configurable_fields"][number] {
  return { field, label, unit, min, recommended, frontend_control: frontendControl };
}

function monitoringBatches(input: {
  namespace: string;
  sourcePathProgress: Gate1SourcePathProgressLedger;
  dataProgress: Gate1DataProgressLedger;
}): Gate1MonitoringBatch[] {
  return [
    monitoringBatch({
      batch_id: "official_source_path",
      source_plan_ref: "source-plan.json",
      target_count: input.sourcePathProgress.runnable_targets,
      current_state:
        input.sourcePathProgress.synced_targets === 0
          ? "not_synced"
          : input.sourcePathProgress.due_targets > 0
            ? "due"
            : input.sourcePathProgress.targets_with_observations > 0
              ? "observing"
              : "synced",
      recommended_next_decision: input.sourcePathProgress.synced_targets === 0 ? "approve_sync" : "approve_run_due",
      namespace: input.namespace
    }),
    monitoringBatch({
      batch_id: "edge_corroboration",
      source_plan_ref:
        input.dataProgress.corroboration_queue_with_runnable_targets > 0 ? "corroboration-source-plan-smoke.json" : "corroboration-source-plan.json",
      target_count: input.dataProgress.corroboration_queue_with_runnable_targets,
      current_state: input.dataProgress.corroboration_queue_with_runnable_targets > 0 ? "smoke_first" : "not_synced",
      recommended_next_decision: "approve_smoke",
      namespace: input.namespace
    })
  ];
}

function monitoringBatch(input: {
  batch_id: Gate1MonitoringBatch["batch_id"];
  source_plan_ref: string;
  target_count: number;
  current_state: Gate1MonitoringBatch["current_state"];
  recommended_next_decision: Gate1MonitoringBatch["recommended_next_decision"];
  namespace: string;
}): Gate1MonitoringBatch {
  const scheduleFlags = [
    `--check-cadence-minutes ${String(GATE1_MONITORING_TARGET_SCHEDULE_DEFAULTS.check_cadence_minutes)}`,
    `--jitter-minutes ${String(GATE1_MONITORING_TARGET_SCHEDULE_DEFAULTS.jitter_minutes)}`,
    `--max-attempts ${String(GATE1_MONITORING_TARGET_SCHEDULE_DEFAULTS.max_attempts)}`,
    `--backoff-base-minutes ${String(GATE1_MONITORING_TARGET_SCHEDULE_DEFAULTS.backoff_base_minutes)}`,
    `--backoff-max-minutes ${String(GATE1_MONITORING_TARGET_SCHEDULE_DEFAULTS.backoff_max_minutes)}`
  ].join(" ");
  return {
    batch_id: input.batch_id,
    source_plan_ref: input.source_plan_ref,
    target_count: input.target_count,
    current_state: input.current_state,
    recommended_next_decision: input.recommended_next_decision,
    preview_command_hint: `supplystrata sources policy preview-plan-targets --source-plan ${input.source_plan_ref} --namespace ${input.namespace} ${scheduleFlags}`,
    sync_command_hint: `supplystrata sources policy sync-plan-targets --source-plan ${input.source_plan_ref} --namespace ${input.namespace} ${scheduleFlags}`,
    enable_command_hint: `supplystrata sources policy enable-plan-targets --source-plan ${input.source_plan_ref} --namespace ${input.namespace} ${scheduleFlags}`,
    run_due_command_hint: `supplystrata sources run-due --source-plan ${input.source_plan_ref} --namespace ${input.namespace}`
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
    ...frontierCompanyReviewItems(input.companySwitching)
  ].sort(compareReviewItems);
  return {
    summary: {
      total_items: items.length,
      source_target_batch_items: items.filter((item) => item.kind === "source_target_batch").length,
      edge_corroboration_items: items.filter((item) => item.kind === "edge_corroboration").length,
      official_signal_disposition_items: items.filter((item) => item.kind === "official_signal_disposition").length,
      frontier_company_research_items: items.filter((item) => item.kind === "frontier_company_research").length,
      auto_ranked_items: items.filter((item) => item.policy.automation_hint === "auto_rank_only").length,
      human_approval_required_items: items.filter((item) => item.policy.requires_human_approval).length
    },
    items
  };
}

function sourceTargetBatchReviewItems(actions: readonly Gate1RunAction[]): Gate1ReviewItem[] {
  return actions
    .filter((action) => action.kind === "smoke_targets" || action.kind === "sync_targets" || action.kind === "run_due_targets")
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
      command_hint: null,
      refs: [item.edge_id, ...item.source_plan_refs, ...item.unknown_ids, ...(proposedUnknownId === null ? [] : [proposedUnknownId])],
      edge_id: item.edge_id,
      unknown_id: proposedUnknownId
    });
  });
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
        command_hint: null,
        refs: [hint.review_id, hint.edge_id, hint.source_adapter_id],
        edge_id: hint.edge_id,
        review_id: hint.review_id
      })
    );
}

function frontierCompanyReviewItems(companySwitching: Gate1CompanySwitchingLedger): Gate1ReviewItem[] {
  return companySwitching.next_research_targets.slice(0, 10).map((target, index) =>
    reviewItem({
      review_item_id: `gate1:frontier-review:${safeSegment(target.company_id)}:${safeSegment(target.component_id)}:${index + 1}`,
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

function sourceTargetDecision(kind: Gate1RunAction["kind"]): Gate1ReviewDecision {
  if (kind === "smoke_targets") return "approve_smoke";
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
  return 3;
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

function safeSegment(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (cleaned.length === 0) throw new Error(`Cannot create a file segment from empty value: ${value}`);
  return cleaned;
}
