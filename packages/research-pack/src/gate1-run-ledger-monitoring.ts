import type {
  Gate1DataProgressLedger,
  Gate1MonitoringBatch,
  Gate1MonitoringConfigLedger,
  Gate1MonitoringCurrentState,
  Gate1MonitoringOperationalAction,
  Gate1MonitoringStateCounts,
  Gate1ReviewDecision,
  Gate1SourcePathProgressLedger
} from "./gate1-run-ledger-definitions.js";
import type { SourceTargetCoverageReport } from "./source-target-coverage.js";
import type { SourceTargetPreflightIssueKind, SourceTargetPreflightReport } from "./source-target-preflight.js";

export const GATE1_MONITORING_TARGET_SCHEDULE_DEFAULTS = {
  enabled_on_sync: false,
  enable_after_review: true,
  check_cadence_minutes: 10_080,
  jitter_minutes: 120,
  max_attempts: 3,
  backoff_base_minutes: 2,
  backoff_max_minutes: 120,
  next_check_at: null
} as const;

export function buildGate1MonitoringConfig(input: {
  namespace: string;
  sourcePathProgress: Gate1SourcePathProgressLedger;
  dataProgress: Gate1DataProgressLedger;
  sourceTargetPreflight: SourceTargetPreflightReport | null;
}): Gate1MonitoringConfigLedger {
  return {
    config_surface: "source_policy_config",
    namespace: input.namespace,
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
    batches: monitoringBatches(input),
    guardrails: [
      "Syncing a target writes source_check_targets only; it does not fetch documents.",
      "Enabling a target starts scheduled monitoring only after review; it does not create fact edges.",
      "Smoke runs stay no-database and should happen before syncing or enabling uncertain corroboration targets.",
      "Cadence, jitter, retry, backoff, and next_check_at are configuration fields for source policy/target state, not research conclusions."
    ]
  };
}

export function gate1SourcePathProgressFromCoverage(
  progress: Omit<Gate1SourcePathProgressLedger, "enabled_targets" | "active_jobs" | "retry_wait_targets" | "dead_targets" | "source_failed_targets">,
  coverage: SourceTargetCoverageReport | undefined
): Gate1SourcePathProgressLedger {
  return {
    ...progress,
    synced_targets: coverage?.summary.synced_targets ?? progress.synced_targets,
    enabled_targets: coverage?.summary.enabled_targets ?? progress.synced_targets,
    due_targets: coverage?.summary.due_targets ?? progress.due_targets,
    active_jobs: coverage?.summary.active_jobs ?? 0,
    retry_wait_targets: coverage?.summary.retry_wait ?? 0,
    degraded_targets: coverage?.summary.degraded_targets ?? progress.degraded_targets,
    dead_targets: coverage?.summary.dead_targets ?? 0,
    source_failed_targets: coverage?.items.filter((item) => item.latest_event?.event_type === "SOURCE_FAILED").length ?? 0,
    targets_with_observations: coverage?.summary.targets_with_observations ?? progress.targets_with_observations
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
  sourceTargetPreflight: SourceTargetPreflightReport | null;
}): Gate1MonitoringBatch[] {
  return [
    monitoringBatch({
      batch_id: "official_source_path",
      source_plan_ref: "source-plan.json",
      target_count: input.sourcePathProgress.runnable_targets,
      state_counts: sourcePathStateCounts(input.sourcePathProgress, input.sourceTargetPreflight),
      namespace: input.namespace
    }),
    monitoringBatch({
      batch_id: "edge_corroboration",
      source_plan_ref:
        input.dataProgress.corroboration_queue_with_runnable_targets > 0 ? "corroboration-source-plan-smoke.json" : "corroboration-source-plan.json",
      target_count: input.dataProgress.corroboration_queue_with_runnable_targets,
      state_counts: corroborationStateCounts(input.dataProgress, input.sourceTargetPreflight),
      namespace: input.namespace,
      ...(input.dataProgress.corroboration_queue_with_runnable_targets > 0 &&
      (input.sourceTargetPreflight === null || input.sourceTargetPreflight.summary.failed_targets === 0)
        ? { force_state: "smoke_first" as const }
        : {})
    })
  ];
}

function monitoringBatch(input: {
  batch_id: Gate1MonitoringBatch["batch_id"];
  source_plan_ref: string;
  target_count: number;
  state_counts: Gate1MonitoringStateCounts;
  namespace: string;
  force_state?: Gate1MonitoringCurrentState;
}): Gate1MonitoringBatch {
  const currentState = input.force_state ?? currentStateForCounts(input.state_counts);
  const operationalAction = operationalActionForState(currentState);
  return {
    batch_id: input.batch_id,
    source_plan_ref: input.source_plan_ref,
    target_count: input.target_count,
    current_state: currentState,
    recommended_next_decision: reviewDecisionForOperationalAction(operationalAction),
    recommended_operational_action: operationalAction,
    state_counts: input.state_counts,
    attention_hint: attentionHint(input.state_counts),
    preview_command_hint: sourcePolicyCommand("preview-plan-targets", input.source_plan_ref, input.namespace),
    sync_command_hint: sourcePolicyCommand("sync-plan-targets", input.source_plan_ref, input.namespace),
    enable_command_hint: sourcePolicyCommand("enable-plan-targets", input.source_plan_ref, input.namespace),
    run_due_command_hint: `supplystrata sources run-due --source-plan ${input.source_plan_ref} --namespace ${input.namespace}`
  };
}

function sourcePathStateCounts(progress: Gate1SourcePathProgressLedger, preflight: SourceTargetPreflightReport | null): Gate1MonitoringStateCounts {
  const notSynced = Math.max(0, progress.runnable_targets - progress.synced_targets);
  const disabled = Math.max(0, progress.synced_targets - progress.enabled_targets);
  return {
    not_synced: notSynced,
    disabled,
    synced: progress.synced_targets,
    enabled: progress.enabled_targets,
    due: progress.due_targets,
    active_jobs: progress.active_jobs,
    retry_wait: progress.retry_wait_targets,
    degraded: progress.degraded_targets,
    dead: progress.dead_targets,
    source_failed: progress.source_failed_targets,
    targets_with_observations: progress.targets_with_observations,
    ...preflightIssueCounts(preflight)
  };
}

function corroborationStateCounts(progress: Gate1DataProgressLedger, preflight: SourceTargetPreflightReport | null): Gate1MonitoringStateCounts {
  return {
    not_synced: progress.corroboration_queue_with_runnable_targets,
    disabled: 0,
    synced: 0,
    enabled: 0,
    due: 0,
    active_jobs: 0,
    retry_wait: 0,
    degraded: 0,
    dead: 0,
    source_failed: 0,
    targets_with_observations: 0,
    ...preflightIssueCounts(preflight)
  };
}

function preflightIssueCounts(
  preflight: SourceTargetPreflightReport | null
): Pick<Gate1MonitoringStateCounts, "preflight_failed" | "missing_credentials" | "invalid_config" | "source_unreachable"> {
  return {
    preflight_failed: preflight?.summary.failed_targets ?? 0,
    missing_credentials: countPreflightIssue(preflight, "missing_credentials"),
    invalid_config: countPreflightIssue(preflight, "target_config_invalid") + countPreflightIssue(preflight, "connector_unsupported"),
    source_unreachable: countPreflightIssue(preflight, "source_unreachable") + countPreflightIssue(preflight, "source_response_error")
  };
}

function currentStateForCounts(counts: Gate1MonitoringStateCounts): Gate1MonitoringCurrentState {
  if (counts.missing_credentials > 0 || counts.invalid_config > 0 || counts.source_unreachable > 0) return "retry_wait";
  if (counts.retry_wait > 0 || counts.source_failed > 0) return "retry_wait";
  if (counts.dead > 0) return "dead";
  if (counts.degraded > 0) return "degraded";
  if (counts.active_jobs > 0) return "active_job";
  if (counts.not_synced > 0) return "not_synced";
  if (counts.disabled > 0) return "disabled";
  if (counts.due > 0) return "due";
  if (counts.targets_with_observations > 0) return "observing";
  return "synced";
}

function operationalActionForState(state: Gate1MonitoringCurrentState): Gate1MonitoringOperationalAction {
  switch (state) {
    case "smoke_first":
      return "smoke_targets";
    case "not_synced":
      return "sync_targets";
    case "disabled":
      return "enable_targets";
    case "due":
      return "run_due_targets";
    case "active_job":
      return "wait_for_jobs";
    case "retry_wait":
    case "degraded":
    case "dead":
      return "investigate_source_failure";
    case "observing":
      return "review_observations";
    case "synced":
      return "none";
  }
}

function reviewDecisionForOperationalAction(action: Gate1MonitoringOperationalAction): Gate1ReviewDecision {
  switch (action) {
    case "smoke_targets":
      return "approve_smoke";
    case "sync_targets":
      return "approve_sync";
    case "enable_targets":
      return "approve_enable";
    case "run_due_targets":
      return "approve_run_due";
    case "wait_for_jobs":
    case "investigate_source_failure":
    case "review_observations":
    case "none":
      return "defer";
  }
}

function attentionHint(counts: Gate1MonitoringStateCounts): string | null {
  if (counts.missing_credentials > 0) return `${counts.missing_credentials} targets need credentials before they can produce monitoring data.`;
  if (counts.source_failed > 0) return `${counts.source_failed} targets have latest SOURCE_FAILED events; inspect job errors before retrying.`;
  if (counts.dead > 0) return `${counts.dead} targets exhausted retry attempts and need operator investigation before rescheduling.`;
  if (counts.degraded > 0) return `${counts.degraded} targets are degraded; cached or partial source data must not be treated as full success.`;
  if (counts.disabled > 0) return `${counts.disabled} synced targets are disabled and need cadence/retry approval before running.`;
  if (counts.targets_with_observations > 0) return `${counts.targets_with_observations} targets produced observations that require review before fact writes.`;
  return null;
}

function sourcePolicyCommand(command: string, sourcePlanRef: string, namespace: string): string {
  return `supplystrata sources policy ${command} --source-plan ${sourcePlanRef} --namespace ${namespace} ${scheduleFlags()}`;
}

function scheduleFlags(): string {
  return [
    `--check-cadence-minutes ${String(GATE1_MONITORING_TARGET_SCHEDULE_DEFAULTS.check_cadence_minutes)}`,
    `--jitter-minutes ${String(GATE1_MONITORING_TARGET_SCHEDULE_DEFAULTS.jitter_minutes)}`,
    `--max-attempts ${String(GATE1_MONITORING_TARGET_SCHEDULE_DEFAULTS.max_attempts)}`,
    `--backoff-base-minutes ${String(GATE1_MONITORING_TARGET_SCHEDULE_DEFAULTS.backoff_base_minutes)}`,
    `--backoff-max-minutes ${String(GATE1_MONITORING_TARGET_SCHEDULE_DEFAULTS.backoff_max_minutes)}`
  ].join(" ");
}

function countPreflightIssue(preflight: SourceTargetPreflightReport | null, issue: SourceTargetPreflightIssueKind): number {
  if (preflight === null) return 0;
  return Object.values(preflight.summary.by_source_status).reduce((count, source) => count + (source.issue_kinds[issue] ?? 0), 0);
}
