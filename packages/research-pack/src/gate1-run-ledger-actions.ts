import type { ResearchPackInput } from "./definitions.js";
import type { CorroborationSourcePlan } from "./corroboration-source-plan.js";
import type { CorroborationSourcePlanNextAction } from "./corroboration-source-plan-definitions.js";
import type { Gate1DataProgressLedger, Gate1RunAction, Gate1SourcePathProgressLedger } from "./gate1-run-ledger-definitions.js";
import { defaultGate1Namespace } from "./gate1-run-ledger-names.js";

interface SourcePathActionInput {
  company_id: string;
  research_input: Pick<ResearchPackInput, "sourceTargetNamespace">;
}

interface DataProgressActionInput {
  company_id: string;
  research_input: Pick<ResearchPackInput, "sourceTargetNamespace">;
  corroboration_source_plan: CorroborationSourcePlan;
}

export function gate1SourcePathActions(input: SourcePathActionInput, progress: Gate1SourcePathProgressLedger): Gate1RunAction[] {
  const sourcePlanRef = "source-plan.json";
  const namespace = input.research_input.sourceTargetNamespace ?? defaultGate1Namespace(input.company_id);
  const actions: Gate1RunAction[] = [];
  if (progress.source_failed_targets > 0 || progress.retry_wait_targets > 0 || progress.dead_targets > 0) {
    actions.push({
      action_id: "gate1:source-failures:triage",
      kind: "investigate_source_failures",
      priority: "P0",
      title: "Triage failed official source targets",
      rationale: sourceFailureActionRationale(progress),
      command_hint: `supplystrata sources due --source-plan ${sourcePlanRef} --namespace ${namespace} --format markdown`,
      refs: ["source-target-coverage.json", "gate1-run-ledger.json"]
    });
  }
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
  if (progress.synced_targets > progress.enabled_targets) {
    actions.push({
      action_id: "gate1:source-targets:enable",
      kind: "enable_targets",
      priority: "P0",
      title: "Enable synced official source targets",
      rationale: `${progress.synced_targets - progress.enabled_targets} synced official targets are disabled; approve cadence and retry policy before due processing.`,
      command_hint: `supplystrata sources policy enable-plan-targets --source-plan ${sourcePlanRef} --namespace ${namespace}`,
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
      command_hint:
        'supplystrata intelligence observation-calibration-label <OBS-id> --label useful_signal --reviewer <name> --rationale "Reviewed official observation; keep as signal unless separately converted through evidence review."',
      refs: ["source-target-coverage.json", "official-disclosure-readiness.json"]
    });
  }
  return actions;
}

export function gate1DataProgressActions(input: DataProgressActionInput, progress: Gate1DataProgressLedger): Gate1RunAction[] {
  const actions: Gate1RunAction[] = [...corroborationSourcePlanActions(input, input.corroboration_source_plan)];
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
  if (progress.open_official_signal_correlation_hints > 0) {
    actions.push({
      action_id: "gate1:official-signals:disposition",
      kind: "record_official_signal_dispositions",
      priority: "P1",
      title: "Record official signal dispositions",
      rationale: `${progress.open_official_signal_correlation_hints} official disclosure signal correlation hint(s) need review-only disposition before they can become evidence, unknown, or source-target follow-up context.`,
      command_hint: 'supplystrata review signal-disposition <REV-id> --edge <EDGE-id> --decision needs_more_evidence --reviewer <name> --reason "..."',
      refs: ["official-disclosure-readiness.json", "gate1-run-ledger.json"]
    });
  }
  if (progress.fact_edge_gap > 0) {
    actions.push({
      action_id: "gate1:facts:l4-l5-candidates",
      kind: "create_fact_edge_candidates",
      priority: "P1",
      title: "Increase reviewed L4/L5 fact edge coverage",
      rationale: `Gate 1 still needs ${progress.fact_edge_gap} additional L4/L5 fact edges; only traceable official evidence should enter review/apply.`,
      command_hint: "supplystrata review gate1-supplier-list-batch --limit 50",
      refs: ["investigation-backlog.json", "official-disclosure-readiness.json"]
    });
  }
  return actions;
}

function sourceFailureActionRationale(progress: Gate1SourcePathProgressLedger): string {
  const failureKinds = Object.entries(progress.source_failure_kinds)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, count]) => `${kind}:${count}`)
    .join(", ");
  const details = failureKinds.length === 0 ? "unclassified" : failureKinds;
  return `${progress.source_failed_targets} official source targets have latest SOURCE_FAILED events; retry_wait=${progress.retry_wait_targets}, dead=${progress.dead_targets}, failure kinds ${details}. Resolve credentials, config, source reachability, rate limits, or adapter errors before rerunning.`;
}

function corroborationSourcePlanActions(input: DataProgressActionInput, plan: CorroborationSourcePlan): Gate1RunAction[] {
  const namespace = input.research_input.sourceTargetNamespace ?? defaultGate1Namespace(input.company_id);
  const actions: Gate1RunAction[] = [];
  const smokeTargets = nextActionCount(plan, "smoke_target");
  if (smokeTargets > 0) {
    actions.push({
      action_id: "gate1:corroboration:smoke",
      kind: "smoke_targets",
      priority: "P0",
      title: "Smoke counterparty corroboration targets",
      rationale: `${smokeTargets} counterparty corroboration target(s) still need no-database smoke before sync or disposition.`,
      command_hint: "supplystrata sources policy smoke-plan-targets --source-plan corroboration-source-plan-smoke.json",
      refs: ["corroboration-source-plan.json", "corroboration-source-plan-smoke.json", "official-disclosure-readiness.json"]
    });
  }
  addSyncLikeCorroborationActions(actions, plan, namespace);
  const failedPreflight = plan.summary.targets_failed_preflight;
  if (failedPreflight > 0) {
    actions.push({
      action_id: "gate1:corroboration:preflight-triage",
      kind: "investigate_source_failures",
      priority: "P0",
      title: "Triage failed corroboration preflight targets",
      rationale: corroborationPreflightRationale(plan),
      command_hint: "supplystrata sources policy smoke-plan-targets --source-plan corroboration-source-plan-smoke.json --format markdown",
      refs: ["corroboration-source-plan.json", "source-target-preflight.json"]
    });
  }
  const observationTargets = nextActionCount(plan, "review_observations");
  if (observationTargets > 0) {
    actions.push({
      action_id: "gate1:corroboration:review-observations",
      kind: "review_observations",
      priority: "P0",
      title: "Review corroboration observations",
      rationale: `${observationTargets} counterparty corroboration target(s) produced normalized disclosures; review observations before any evidence or disposition write.`,
      command_hint: corroborationObservationReviewCommand(plan),
      refs: ["corroboration-source-plan.json", "source-target-preflight.json", "official-disclosure-readiness.json"]
    });
  }
  return actions;
}

function addSyncLikeCorroborationActions(actions: Gate1RunAction[], plan: CorroborationSourcePlan, namespace: string): void {
  const syncTargets = nextActionCount(plan, "sync_target");
  if (syncTargets > 0) {
    actions.push({
      action_id: "gate1:corroboration:sync",
      kind: "sync_targets",
      priority: "P0",
      title: "Sync smoke-cleared corroboration targets",
      rationale: `${syncTargets} counterparty corroboration target(s) passed preflight and are ready to sync into source_check_targets.`,
      command_hint: `supplystrata sources policy sync-plan-targets --source-plan corroboration-source-plan-sync.json --namespace ${namespace}`,
      refs: ["corroboration-source-plan.json", "corroboration-source-plan-sync.json", "source-target-preflight.json"]
    });
  }
  const enableTargets = nextActionCount(plan, "enable_target");
  if (enableTargets > 0) {
    actions.push({
      action_id: "gate1:corroboration:enable",
      kind: "enable_targets",
      priority: "P0",
      title: "Enable synced corroboration targets",
      rationale: `${enableTargets} counterparty corroboration target(s) are synced but disabled; approve cadence before due processing.`,
      command_hint: `supplystrata sources policy enable-plan-targets --source-plan corroboration-source-plan-enable.json --namespace ${namespace}`,
      refs: ["corroboration-source-plan.json", "corroboration-source-plan-enable.json", "source-target-coverage.json"]
    });
  }
  const dueTargets = nextActionCount(plan, "run_due_target");
  if (dueTargets > 0) {
    actions.push({
      action_id: "gate1:corroboration:run-due",
      kind: "run_due_targets",
      priority: "P0",
      title: "Run due corroboration targets",
      rationale: `${dueTargets} counterparty corroboration target(s) are due and should run through source monitor before edge disposition.`,
      command_hint: `supplystrata sources run-due --source-plan corroboration-source-plan-run-due.json --namespace ${namespace}`,
      refs: ["corroboration-source-plan.json", "corroboration-source-plan-run-due.json", "source-target-coverage.json"]
    });
  }
}

function nextActionCount(plan: CorroborationSourcePlan, action: CorroborationSourcePlanNextAction): number {
  return plan.summary.by_next_action[action] ?? 0;
}

function corroborationPreflightRationale(plan: CorroborationSourcePlan): string {
  const parts = [
    `failed_preflight=${plan.summary.targets_failed_preflight}`,
    `missing_credentials=${plan.summary.targets_missing_credentials}`,
    `retry_preflight=${nextActionCount(plan, "retry_preflight")}`,
    `configure_credentials=${nextActionCount(plan, "configure_credentials")}`,
    `fix_target_config=${nextActionCount(plan, "fix_target_config")}`,
    `investigate_source_failure=${nextActionCount(plan, "investigate_source_failure")}`
  ];
  return `Some counterparty corroboration targets failed smoke; resolve them before recording final single-source disposition. ${parts.join(", ")}.`;
}

function corroborationObservationReviewCommand(plan: CorroborationSourcePlan): string {
  const reviewTarget = plan.target_refs.find((target) => target.next_action === "review_observations");
  const edgeId = reviewTarget?.edge_ids[0] ?? "<EDGE-id>";
  const checkTargetFlag =
    reviewTarget?.check_target_id === undefined || reviewTarget.check_target_id === null ? "" : ` --check-target ${reviewTarget.check_target_id}`;
  return (
    `supplystrata review edge-corroboration-disposition ${edgeId}` +
    " --decision needs_more_evidence" +
    " --reviewer <name>" +
    ' --reason "Reviewed produced observations; not enough to promote into fact evidence yet."' +
    checkTargetFlag
  );
}
