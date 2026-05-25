import { buildSourceCheckTargetsFromPlan } from "@supplystrata/source-management";
import type { SourcePlanItem } from "@supplystrata/source-plan";
import { listObservationCalibrationLabels, type DbClient, type ObservationCalibrationLabelRecord } from "@supplystrata/db/read";
import {
  listSourceTargetCoverage,
  type SourceTargetCoverageItem,
  type SourceTargetCoverageState,
  type SourceTargetFailureKind
} from "@supplystrata/source-monitor";
import {
  buildSourceTargetObservationReview,
  summarizeSourceTargetObservationMetrics,
  type SourceTargetObservationCalibrationExistingLabel,
  type SourceTargetObservationReview
} from "./source-target-observation-review.js";

export interface SourceTargetCoverageReport {
  schema_version: "1.0.0";
  generated_at: string;
  company_id: string;
  namespace: string;
  summary: {
    expected_targets: number;
    synced_targets: number;
    not_synced: number;
    enabled_targets: number;
    due_targets: number;
    active_jobs: number;
    retry_wait: number;
    degraded_targets: number;
    dead_targets: number;
    source_failed_targets: number;
    source_failure_kinds: Record<SourceTargetFailureKind, number>;
    targets_with_observations: number;
    total_observations: number;
    observed_subject_entities: number;
    observations_by_source: Record<string, number>;
    observations_by_target_kind: Record<string, number>;
    observations_by_metric: Record<string, number>;
  };
  observation_review: SourceTargetObservationReview;
  items: SourceTargetCoverageItem[];
}

export interface BuildSourceTargetCoverageReportInput {
  client: DbClient;
  generated_at: string;
  company_id: string;
  source_plan: readonly SourcePlanItem[];
  namespace?: string;
}

export interface BuildExpectedSourceTargetCoverageReportInput {
  generated_at: string;
  company_id: string;
  source_plan: readonly SourcePlanItem[];
  namespace?: string;
}

export async function buildSourceTargetCoverageReport(input: BuildSourceTargetCoverageReportInput): Promise<SourceTargetCoverageReport> {
  const namespace = input.namespace ?? defaultSourceTargetNamespace(input.company_id);
  const expectedTargets = buildSourceCheckTargetsFromPlan({
    source_plan: input.source_plan,
    namespace
  });
  const items =
    expectedTargets.length === 0
      ? []
      : await listSourceTargetCoverage(input.client, {
          expected_targets: expectedTargets,
          now: input.generated_at
        });
  const observationCalibrationLabels = await listObservationCalibrationLabels(input.client, {
    observation_ids: sourceTargetObservationIds(items),
    limit: sourceTargetObservationLabelLimit(items)
  });
  return buildSourceTargetCoverageReportFromItems({
    generated_at: input.generated_at,
    company_id: input.company_id,
    namespace,
    items,
    observation_calibration_labels: observationCalibrationLabels.map(toObservationReviewExistingLabel)
  });
}

export function buildExpectedSourceTargetCoverageReport(input: BuildExpectedSourceTargetCoverageReportInput): SourceTargetCoverageReport {
  const namespace = input.namespace ?? defaultSourceTargetNamespace(input.company_id);
  const items = buildSourceCheckTargetsFromPlan({
    source_plan: input.source_plan,
    namespace
  }).map(toUnsyncedCoverageItem);
  return buildSourceTargetCoverageReportFromItems({
    generated_at: input.generated_at,
    company_id: input.company_id,
    namespace,
    items,
    observation_calibration_labels: []
  });
}

function buildSourceTargetCoverageReportFromItems(input: {
  generated_at: string;
  company_id: string;
  namespace: string;
  items: readonly SourceTargetCoverageItem[];
  observation_calibration_labels: readonly SourceTargetObservationCalibrationExistingLabel[];
}): SourceTargetCoverageReport {
  const observationReview = buildSourceTargetObservationReview(input.items, input.observation_calibration_labels);
  return {
    schema_version: "1.0.0",
    generated_at: input.generated_at,
    company_id: input.company_id,
    namespace: input.namespace,
    summary: {
      expected_targets: input.items.length,
      synced_targets: input.items.filter((item) => item.synced).length,
      not_synced: countState(input.items, "not_synced"),
      enabled_targets: input.items.filter((item) => item.target_enabled === true && item.policy_enabled === true).length,
      due_targets: countState(input.items, "due"),
      active_jobs: countState(input.items, "active_job"),
      retry_wait: countState(input.items, "retry_wait"),
      degraded_targets: countState(input.items, "degraded"),
      dead_targets: countState(input.items, "dead"),
      source_failed_targets: countLatestEvent(input.items, "SOURCE_FAILED"),
      source_failure_kinds: countFailureKinds(input.items),
      targets_with_observations: input.items.filter((item) => item.observations > 0).length,
      total_observations: countObservations(input.items),
      observed_subject_entities: countObservedSubjectEntities(input.items),
      observations_by_source: sumObservationsBy(input.items, (item) => item.expected_target.source_adapter_id),
      observations_by_target_kind: sumObservationsBy(input.items, (item) => `${item.expected_target.source_adapter_id}/${item.expected_target.target_kind}`),
      observations_by_metric: summarizeSourceTargetObservationMetrics(input.items)
    },
    observation_review: observationReview,
    items: [...input.items]
  };
}

export function renderSourceTargetCoverageMarkdown(report: SourceTargetCoverageReport): string {
  const lines = [
    `# Source Target Coverage ${report.company_id}`,
    "",
    `Generated at: ${report.generated_at}`,
    `Namespace: ${report.namespace}`,
    "",
    "## Summary",
    "",
    `- Expected targets: ${report.summary.expected_targets}`,
    `- Synced targets: ${report.summary.synced_targets}`,
    `- Not synced: ${report.summary.not_synced}`,
    `- Enabled targets: ${report.summary.enabled_targets}`,
    `- Due targets: ${report.summary.due_targets}`,
    `- Active jobs: ${report.summary.active_jobs}`,
    `- Retry wait: ${report.summary.retry_wait}`,
    `- Degraded targets: ${report.summary.degraded_targets}`,
    `- Dead targets: ${report.summary.dead_targets}`,
    `- Source failed targets: ${report.summary.source_failed_targets}`,
    `- Source failure kinds: ${formatCountMap(report.summary.source_failure_kinds)}`,
    `- Targets with observations: ${report.summary.targets_with_observations}`,
    `- Total observations: ${report.summary.total_observations}`,
    `- Observed subject entities: ${report.summary.observed_subject_entities}`,
    `- Observations by source: ${formatCountMap(report.summary.observations_by_source)}`,
    `- Observations by target kind: ${formatCountMap(report.summary.observations_by_target_kind)}`,
    `- Observations by metric: ${formatCountMap(report.summary.observations_by_metric)}`,
    `- Observation review seeds: ${report.observation_review.summary.review_items} (${report.observation_review.summary.p0} P0, ${report.observation_review.summary.p1} P1, ${report.observation_review.summary.p2} P2)`,
    `- Observation calibration candidates: ${report.observation_review.summary.calibration_candidates}; labeled ${report.observation_review.summary.labeled_calibration_candidates}; unlabeled ${report.observation_review.summary.unlabeled_calibration_candidates}; recommended labels ${formatCountMap(report.observation_review.summary.by_recommended_label)}; persisted labels ${formatCountMap(report.observation_review.summary.by_persisted_label)}`,
    `- Next labeling batch: ${report.observation_review.summary.next_labeling_batch_candidates}; priority ${formatCountMap(report.observation_review.summary.next_labeling_batch_by_priority)}; metric ${formatCountMap(report.observation_review.summary.next_labeling_batch_by_metric)}`,
    "",
    "## Observation Review Seeds",
    ""
  ];
  if (report.observation_review.items.length === 0) {
    lines.push("No observation review seeds are available yet.");
  } else {
    for (const item of report.observation_review.items) {
      lines.push(`- ${item.priority} ${item.metric_name}: ${item.observations} observations; ${item.category}`);
      lines.push(`  Policy: ${item.review_policy}`);
      lines.push(`  Action: ${item.recommended_action}`);
      lines.push(`  Rationale: ${item.rationale}`);
      lines.push(`  Supporting refs: ${item.supporting_refs.join(", ")}`);
      for (const sample of item.sample_observations) {
        const value = sample.metric_value === null ? "n/a" : `${sample.metric_value}${sample.metric_unit === null ? "" : ` ${sample.metric_unit}`}`;
        lines.push(
          `  Sample: ${sample.observation_id}; value=${value}; window=${sample.time_window_start ?? "n/a"}..${sample.time_window_end ?? "n/a"}; doc=${sample.doc_id ?? "n/a"}`
        );
      }
    }
  }
  lines.push("", "## Observation Calibration Candidates", "");
  if (report.observation_review.calibration_candidates.length === 0) {
    lines.push("No observation calibration candidates are available yet.");
  } else {
    for (const candidate of report.observation_review.calibration_candidates) {
      const value = candidate.metric_value === null ? "n/a" : `${candidate.metric_value}${candidate.metric_unit === null ? "" : ` ${candidate.metric_unit}`}`;
      lines.push(`- ${candidate.priority} ${candidate.candidate_id}: ${candidate.recommended_label}`);
      lines.push(`  Observation: ${candidate.observation_id}; metric=${candidate.metric_name}; category=${candidate.category}`);
      lines.push(`  Policy: ${candidate.review_policy}`);
      lines.push(`  Rationale: ${candidate.rationale}`);
      lines.push(
        `  Sample: value=${value}; baseline=${candidate.baseline_value ?? "n/a"}; change=${formatPercent(candidate.change_percent)}; window=${candidate.time_window_start ?? "n/a"}..${candidate.time_window_end ?? "n/a"}; doc=${candidate.doc_id ?? "n/a"}`
      );
      lines.push(`  Existing labels: ${formatExistingObservationLabels(candidate.existing_labels)}`);
    }
  }
  lines.push("", "## Observation Calibration Labeling Plan", "");
  lines.push(`Strategy: ${report.observation_review.labeling_plan.strategy}`);
  lines.push(`Policy: ${report.observation_review.labeling_plan.review_policy}`);
  lines.push(`Batch size: ${report.observation_review.labeling_plan.batch_size}`);
  if (report.observation_review.labeling_plan.candidates.length === 0) {
    lines.push("No unlabeled observation calibration candidates are available.");
  } else {
    for (const candidate of report.observation_review.labeling_plan.candidates) {
      lines.push(`- ${candidate.priority} ${candidate.candidate_id}: ${candidate.recommended_label}`);
      lines.push(`  Selection: ${candidate.selection_reason}`);
      lines.push(
        `  Observation: ${candidate.observation_id}; metric=${candidate.metric_name}; category=${candidate.category}; doc=${candidate.doc_id ?? "n/a"}; source_item=${candidate.source_item_id ?? "n/a"}`
      );
    }
  }
  lines.push("", "## Targets", "");
  for (const item of report.items) {
    lines.push(`- ${item.state} ${item.expected_target.source_adapter_id}/${item.expected_target.target_kind}`);
    lines.push(`  Expected target: ${item.expected_target.check_target_id}`);
    lines.push(`  Matched target: ${item.matched_check_target_id ?? "none"} (${item.match_kind})`);
    lines.push(`  Enabled: target=${boolOrUnknown(item.target_enabled)}, policy=${boolOrUnknown(item.policy_enabled)}`);
    lines.push(`  Next check: ${item.next_check_at ?? "n/a"}`);
    lines.push(`  Observations: ${item.observations}; latest observation: ${item.latest_observation_at ?? "n/a"}`);
    lines.push(`  Observations by metric: ${formatCountMap(item.observations_by_metric)}`);
    if (item.latest_job !== null) {
      lines.push(
        `  Latest job: ${item.latest_job.status} ${item.latest_job.job_id}; attempts=${item.latest_job.attempts}; failure_kind=${item.latest_job.failure_kind ?? "none"}`
      );
      if (item.latest_job.last_error !== null) lines.push(`  Last error: ${item.latest_job.last_error}`);
    }
    if (item.latest_event !== null) lines.push(`  Latest event: ${item.latest_event.event_type} ${item.latest_event.event_id}`);
  }
  return lines.join("\n");
}

function sourceTargetObservationIds(items: readonly SourceTargetCoverageItem[]): string[] {
  return [
    ...new Set(
      items
        .flatMap((item) => item.observation_samples)
        .map((sample) => sample.observation_id)
        .sort()
    )
  ];
}

function sourceTargetObservationLabelLimit(items: readonly SourceTargetCoverageItem[]): number {
  const observationIds = sourceTargetObservationIds(items);
  return Math.max(100, observationIds.length * 5);
}

function toObservationReviewExistingLabel(record: ObservationCalibrationLabelRecord): SourceTargetObservationCalibrationExistingLabel {
  return {
    label_id: record.label_id,
    observation_id: record.observation_id,
    ...(record.candidate_id === undefined ? {} : { candidate_id: record.candidate_id }),
    label: record.label,
    reviewer: record.reviewer,
    reviewed_at: record.reviewed_at,
    ...(record.rationale === undefined ? {} : { rationale: record.rationale })
  };
}

function formatExistingObservationLabels(labels: readonly SourceTargetObservationCalibrationExistingLabel[]): string {
  if (labels.length === 0) return "none";
  return labels.map((label) => `${label.reviewer}=${label.label}@${label.reviewed_at}`).join(", ");
}

function defaultSourceTargetNamespace(companyId: string): string {
  return `research-${companyId.toLowerCase()}`;
}

function toUnsyncedCoverageItem(expectedTarget: SourceTargetCoverageItem["expected_target"]): SourceTargetCoverageItem {
  return {
    expected_target: expectedTarget,
    synced: false,
    match_kind: "none",
    matched_check_target_id: null,
    state: "not_synced",
    target_enabled: null,
    policy_enabled: null,
    next_check_at: null,
    effective_check_cadence_minutes: null,
    effective_jitter_minutes: null,
    latest_job: null,
    latest_event: null,
    observations: 0,
    observations_by_metric: {},
    observation_samples: [],
    latest_observation_at: null
  };
}

function countState(items: readonly SourceTargetCoverageItem[], state: SourceTargetCoverageState): number {
  return items.filter((item) => item.state === state).length;
}

function countLatestEvent(items: readonly SourceTargetCoverageItem[], eventType: string): number {
  return items.filter((item) => item.latest_event?.event_type === eventType).length;
}

function countFailureKinds(items: readonly SourceTargetCoverageItem[]): Record<SourceTargetFailureKind, number> {
  const counts: Record<SourceTargetFailureKind, number> = {
    missing_credentials: 0,
    target_config_invalid: 0,
    source_unreachable: 0,
    source_response_error: 0,
    rate_limited: 0,
    adapter_error: 0,
    unknown_failure: 0
  };
  for (const item of items) {
    const failureKind = item.latest_job?.failure_kind ?? null;
    if (failureKind === null) continue;
    counts[failureKind] += 1;
  }
  return counts;
}

function countObservations(items: readonly SourceTargetCoverageItem[]): number {
  return items.reduce((sum, item) => sum + item.observations, 0);
}

function countObservedSubjectEntities(items: readonly SourceTargetCoverageItem[]): number {
  const subjectEntityIds = new Set<string>();
  for (const item of items) {
    if (item.observations <= 0 || item.expected_target.subject_entity_id === undefined) continue;
    subjectEntityIds.add(item.expected_target.subject_entity_id);
  }
  return subjectEntityIds.size;
}

function sumObservationsBy(items: readonly SourceTargetCoverageItem[], keyForItem: (item: SourceTargetCoverageItem) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    if (item.observations <= 0) continue;
    const key = keyForItem(item);
    counts[key] = (counts[key] ?? 0) + item.observations;
  }
  const sorted: Record<string, number> = {};
  for (const [key, count] of Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))) sorted[key] = count;
  return sorted;
}

function formatCountMap(counts: Record<string, number>): string {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  if (entries.length === 0) return "none";
  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}:${count}`)
    .join(", ");
}

function formatPercent(value: number | null): string {
  if (value === null) return "n/a";
  return `${value.toFixed(2)}%`;
}

function boolOrUnknown(value: boolean | null): string {
  if (value === null) return "unknown";
  return value ? "true" : "false";
}
