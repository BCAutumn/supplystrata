import type { SourcePlanCheckTargetSuggestion, SourcePlanItem } from "@supplystrata/source-plan";
import type { WorkbenchUnknownItem } from "@supplystrata/workbench-export";
import type { InvestigationBacklogInput, InvestigationBacklogSourceTargetCoverage } from "./investigation-backlog-definitions.js";
import type { OfficialDisclosureCorroborationQueueItem } from "./official-disclosure-readiness.js";
import type { SourceTargetPreflightIssueKind, SourceTargetPreflightItem } from "./source-target-preflight.js";

export function runnableTargetsForRefs(sourcePlan: readonly SourcePlanItem[], refs: readonly string[]): SourcePlanCheckTargetSuggestion[] {
  return runnableTargetsForSources(sourcePlan, sourceIdsFromRefs(refs));
}

export function runnableTargetsForSources(sourcePlan: readonly SourcePlanItem[], sourceIds: readonly string[]): SourcePlanCheckTargetSuggestion[] {
  const sourceIdSet = new Set(sourceIds);
  return sourcePlan.flatMap((item) => (sourceIdSet.has(item.source_id) ? item.suggested_check_targets.filter((target) => target.runnable) : []));
}

export function runnableTargetsByKey(sourcePlan: readonly SourcePlanItem[]): ReadonlyMap<string, SourcePlanCheckTargetSuggestion> {
  const byKey = new Map<string, SourcePlanCheckTargetSuggestion>();
  for (const item of sourcePlan) {
    for (const target of item.suggested_check_targets) {
      if (target.runnable) byKey.set(runnableTargetKey(target), target);
    }
  }
  return byKey;
}

export function runnableTargetsForCorroborationQueueItem(
  queueItem: OfficialDisclosureCorroborationQueueItem,
  sourcePlanTargetsByKey: ReadonlyMap<string, SourcePlanCheckTargetSuggestion>
): SourcePlanCheckTargetSuggestion[] {
  const targets = queueItem.source_targets.flatMap((target) => {
    const runnableTarget = sourcePlanTargetsByKey.get(target.target_key);
    return runnableTarget === undefined ? [] : [runnableTarget];
  });
  return dedupeRunnableTargets(targets);
}

export function sourceIdsForUnknown(sourcePlan: readonly SourcePlanItem[], unknown: WorkbenchUnknownItem): string[] {
  const sourceIds = new Set<string>();
  const haystack = [...unknown.blocking_data_sources, ...unknown.proxies, unknown.question, unknown.why_unknown].join(" ").toLowerCase();
  for (const item of sourcePlan) {
    if (haystack.includes(item.source_id.toLowerCase()) || haystack.includes(item.source_name.toLowerCase())) sourceIds.add(item.source_id);
  }
  return [...sourceIds].sort();
}

export function dedupeRunnableTargets(targets: readonly SourcePlanCheckTargetSuggestion[]): SourcePlanCheckTargetSuggestion[] {
  const byKey = new Map<string, SourcePlanCheckTargetSuggestion>();
  for (const target of targets) byKey.set(`${target.source_adapter_id}:${target.target_kind}:${JSON.stringify(target.target_config)}`, target);
  return [...byKey.values()].sort(
    (left, right) => left.source_adapter_id.localeCompare(right.source_adapter_id) || left.target_kind.localeCompare(right.target_kind)
  );
}

export function coverageByRunnableTarget(input: InvestigationBacklogInput): Map<string, InvestigationBacklogSourceTargetCoverage> {
  const coverageByTarget = new Map<string, InvestigationBacklogSourceTargetCoverage>();
  const preflightByCheckTargetId = sourceTargetPreflightByCheckTargetId(input.source_target_preflight);
  for (const item of input.source_target_coverage?.items ?? []) {
    const checkTargetId = item.matched_check_target_id ?? item.expected_target.check_target_id;
    const preflight = preflightByCheckTargetId.get(checkTargetId) ?? preflightByCheckTargetId.get(item.expected_target.check_target_id);
    coverageByTarget.set(runnableTargetKey(item.expected_target), {
      source_adapter_id: item.expected_target.source_adapter_id,
      target_kind: item.expected_target.target_kind,
      target_config: copyTargetConfig(item.expected_target.target_config),
      check_target_id: checkTargetId,
      state: item.state,
      synced: item.synced,
      observations: item.observations,
      latest_job_id: item.latest_job?.job_id ?? null,
      latest_job_status: item.latest_job?.status ?? null,
      latest_event_id: item.latest_event?.event_id ?? null,
      latest_event_type: item.latest_event?.event_type ?? null,
      ...preflightFields(preflight)
    });
  }
  return coverageByTarget;
}

export function coverageForTargets(
  coverageByTarget: ReadonlyMap<string, InvestigationBacklogSourceTargetCoverage>,
  targets: readonly SourcePlanCheckTargetSuggestion[]
): InvestigationBacklogSourceTargetCoverage[] {
  const coverage: InvestigationBacklogSourceTargetCoverage[] = [];
  for (const target of targets) {
    const item = coverageByTarget.get(runnableTargetKey(target));
    if (item !== undefined) coverage.push(item);
  }
  return dedupeCoverageRefs(coverage);
}

export function coverageAwareAction(action: string, coverage: readonly InvestigationBacklogSourceTargetCoverage[]): string {
  if (coverage.length === 0) return action;
  const prefix = coverageActionPrefix(coverage);
  return `${prefix} ${action}`;
}

export function coverageSupportingRefs(coverage: readonly InvestigationBacklogSourceTargetCoverage[]): string[] {
  return coverage.flatMap((item) => [
    `source_target:${item.check_target_id}`,
    ...(item.preflight_status === null ? [] : [`source_preflight:${item.check_target_id}`]),
    ...(item.latest_job_id === null ? [] : [`source_job:${item.latest_job_id}`]),
    ...(item.latest_event_id === null ? [] : [`source_event:${item.latest_event_id}`])
  ]);
}

export function dedupeCoverageRefs(coverage: readonly InvestigationBacklogSourceTargetCoverage[]): InvestigationBacklogSourceTargetCoverage[] {
  const byTarget = new Map<string, InvestigationBacklogSourceTargetCoverage>();
  for (const item of coverage) byTarget.set(`${item.check_target_id}:${stableConfigKey(item.target_config)}`, item);
  return [...byTarget.values()].sort(
    (left, right) => left.source_adapter_id.localeCompare(right.source_adapter_id) || left.target_kind.localeCompare(right.target_kind)
  );
}

function sourceTargetPreflightByCheckTargetId(report: InvestigationBacklogInput["source_target_preflight"]): Map<string, SourceTargetPreflightItem> {
  const byCheckTargetId = new Map<string, SourceTargetPreflightItem>();
  for (const item of report?.items ?? []) byCheckTargetId.set(item.check_target_id, item);
  return byCheckTargetId;
}

function preflightFields(
  item: SourceTargetPreflightItem | undefined
): Pick<
  InvestigationBacklogSourceTargetCoverage,
  | "preflight_status"
  | "preflight_issue_kind"
  | "preflight_error_message"
  | "preflight_missing_credential_env_keys"
  | "preflight_normalized_documents"
  | "preflight_degraded_documents"
> {
  if (item === undefined) {
    return {
      preflight_status: null,
      preflight_issue_kind: null,
      preflight_error_message: null,
      preflight_missing_credential_env_keys: [],
      preflight_normalized_documents: 0,
      preflight_degraded_documents: 0
    };
  }
  return {
    preflight_status: item.status,
    preflight_issue_kind: item.issue_kind ?? null,
    preflight_error_message: item.error_message ?? null,
    preflight_missing_credential_env_keys: (item.missing_credentials ?? []).map((credential) => credential.env_key).sort(),
    preflight_normalized_documents: item.normalized_documents,
    preflight_degraded_documents: item.degraded_documents
  };
}

function coverageActionPrefix(coverage: readonly InvestigationBacklogSourceTargetCoverage[]): string {
  if (coverage.some((item) => item.state === "dead")) return "Investigate dead source-check jobs before expecting new evidence.";
  if (coverage.some((item) => item.state === "retry_wait"))
    return "Inspect failed source-check attempts and wait for configured retry or rerun after fixing the source issue.";
  if (coverage.some((item) => item.state === "degraded")) return "Inspect degraded source fetches before treating the latest check as usable evidence.";
  if (coverage.some((item) => item.preflight_issue_kind === "missing_credentials")) {
    const keys = uniqueSorted(coverage.flatMap((item) => item.preflight_missing_credential_env_keys));
    const suffix = keys.length === 0 ? "" : ` (${keys.join(", ")})`;
    return `Configure required source credentials${suffix} before syncing or enabling this source-plan target.`;
  }
  if (coverage.some((item) => item.preflight_issue_kind === "target_config_invalid"))
    return "Fix the source-plan target configuration before syncing or enabling this target.";
  if (coverage.some((item) => item.preflight_issue_kind === "connector_unsupported"))
    return "Register or implement the required source-check connector before syncing this target.";
  if (coverage.some((item) => item.preflight_issue_kind === "source_unreachable" || item.preflight_issue_kind === "source_response_error"))
    return "Verify source reachability and response format before treating this target as monitor-ready.";
  if (coverage.some((item) => item.preflight_status === "failed"))
    return "Fix source-plan preflight failures (credentials, target config, or source reachability) before syncing or enabling this target.";
  if (coverage.some((item) => item.preflight_status === "skipped"))
    return "Resolve unsupported source-plan preflight target or connector registration before syncing.";
  if (coverage.some((item) => item.preflight_degraded_documents > 0))
    return "Inspect degraded preflight fetches before treating the latest source path as healthy.";
  if (coverage.some((item) => item.state === "disabled")) return "Enable the synced source-check targets when the monitoring cadence is approved.";
  if (coverage.some((item) => item.state === "not_synced")) return "Sync runnable source-plan targets into source_check_targets first.";
  if (coverage.some((item) => item.state === "due")) return "Run due source-check targets through sources run-due or the worker.";
  if (coverage.some((item) => item.state === "active_job")) return "Wait for active source-check jobs to complete before changing conclusions.";
  if (coverage.some((item) => item.observations > 0)) return "Review produced observations and keep any fact-edge promotion behind review.";
  return "Inspect the latest source-check result; if it produced no useful observation, refine the target configuration.";
}

function runnableTargetKey(target: { source_adapter_id: string; target_kind: string; target_config: Record<string, unknown> }): string {
  return `${target.source_adapter_id}:${target.target_kind}:${stableConfigKey(target.target_config)}`;
}

function stableConfigKey(config: Record<string, unknown>): string {
  return Object.entries(config)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${stableConfigValue(value)}`)
    .join(";");
}

function copyTargetConfig(config: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config).sort(([left], [right]) => left.localeCompare(right))) {
    output[key] = copyConfigValue(value);
  }
  return output;
}

function copyConfigValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => copyConfigValue(item));
  if (isRecord(value)) return copyTargetConfig(value);
  return value;
}

function stableConfigValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableConfigValue).join(",")}]`;
  if (isRecord(value)) return `{${stableConfigKey(value)}}`;
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sourceIdsFromRefs(refs: readonly string[]): string[] {
  return refs.filter((ref) => ref.startsWith("source_plan:")).map((ref) => ref.slice("source_plan:".length));
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
