import { buildSourceCheckTargetsFromPlan } from "@supplystrata/source-management";
import type { SourcePlanItem } from "@supplystrata/source-plan";
import type { DbClient } from "@supplystrata/db";
import { listSourceTargetCoverage, type SourceTargetCoverageItem, type SourceTargetCoverageState } from "@supplystrata/source-monitor";

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
    targets_with_observations: number;
  };
  items: SourceTargetCoverageItem[];
}

export interface BuildSourceTargetCoverageReportInput {
  client: DbClient;
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
  return {
    schema_version: "1.0.0",
    generated_at: input.generated_at,
    company_id: input.company_id,
    namespace,
    summary: {
      expected_targets: items.length,
      synced_targets: items.filter((item) => item.synced).length,
      not_synced: countState(items, "not_synced"),
      enabled_targets: items.filter((item) => item.target_enabled === true && item.policy_enabled === true).length,
      due_targets: countState(items, "due"),
      active_jobs: countState(items, "active_job"),
      retry_wait: countState(items, "retry_wait"),
      degraded_targets: countState(items, "degraded"),
      dead_targets: countState(items, "dead"),
      targets_with_observations: items.filter((item) => item.observations > 0).length
    },
    items
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
    `- Targets with observations: ${report.summary.targets_with_observations}`,
    "",
    "## Targets",
    ""
  ];
  for (const item of report.items) {
    lines.push(`- ${item.state} ${item.expected_target.source_adapter_id}/${item.expected_target.target_kind}`);
    lines.push(`  Expected target: ${item.expected_target.check_target_id}`);
    lines.push(`  Matched target: ${item.matched_check_target_id ?? "none"} (${item.match_kind})`);
    lines.push(`  Enabled: target=${boolOrUnknown(item.target_enabled)}, policy=${boolOrUnknown(item.policy_enabled)}`);
    lines.push(`  Next check: ${item.next_check_at ?? "n/a"}`);
    lines.push(`  Observations: ${item.observations}; latest observation: ${item.latest_observation_at ?? "n/a"}`);
    if (item.latest_job !== null) lines.push(`  Latest job: ${item.latest_job.status} ${item.latest_job.job_id}; attempts=${item.latest_job.attempts}`);
    if (item.latest_event !== null) lines.push(`  Latest event: ${item.latest_event.event_type} ${item.latest_event.event_id}`);
  }
  return lines.join("\n");
}

function defaultSourceTargetNamespace(companyId: string): string {
  return `research-${companyId.toLowerCase()}`;
}

function countState(items: readonly SourceTargetCoverageItem[], state: SourceTargetCoverageState): number {
  return items.filter((item) => item.state === state).length;
}

function boolOrUnknown(value: boolean | null): string {
  if (value === null) return "unknown";
  return value ? "true" : "false";
}
