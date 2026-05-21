import type { SourcePlanCheckTargetSuggestion, SourcePlanItem } from "@supplystrata/source-plan";
import type { InvestigationBacklog, InvestigationBacklogItem, InvestigationBacklogSourceTargetCoverage } from "./investigation-backlog.js";

export interface CorroborationSourcePlanTargetRef {
  backlog_id: string;
  edge_ids: string[];
  unknown_ids: string[];
  source_adapter_id: string;
  target_kind: string;
  target_config: Record<string, string | number | boolean | string[]>;
  coverage_state: InvestigationBacklogSourceTargetCoverage["state"] | null;
  check_target_id: string | null;
  preflight_status: InvestigationBacklogSourceTargetCoverage["preflight_status"];
  preflight_issue_kind: InvestigationBacklogSourceTargetCoverage["preflight_issue_kind"];
  preflight_missing_credential_env_keys: readonly string[];
}

export interface CorroborationSourcePlan {
  schema_version: "1.0.0";
  generated_at: string;
  company_id: string;
  summary: {
    review_edges: number;
    disposition_only_edges: number;
    source_plan_items: number;
    runnable_targets: number;
    targets_need_sync: number;
    targets_need_enable: number;
    targets_due: number;
    targets_failed_preflight: number;
    targets_missing_credentials: number;
    by_source: Record<string, number>;
  };
  target_refs: CorroborationSourcePlanTargetRef[];
  source_plan: SourcePlanItem[];
}

export interface CorroborationSourcePlanInput {
  generated_at: string;
  company_id: string;
  source_plan: readonly SourcePlanItem[];
  investigation_backlog: InvestigationBacklog;
}

export function buildCorroborationSourcePlan(input: CorroborationSourcePlanInput): CorroborationSourcePlan {
  const reviews = input.investigation_backlog.items.filter((item) => item.kind === "corroboration_review");
  const targetRefs = buildTargetRefs(reviews);
  const targetKeys = new Set(targetRefs.map((target) => sourceTargetKey(target)));
  const sourcePlan = filterSourcePlan(input.source_plan, targetKeys);
  return {
    schema_version: "1.0.0",
    generated_at: input.generated_at,
    company_id: input.company_id,
    summary: {
      review_edges: uniqueSorted(reviews.flatMap((item) => item.target.edge_ids)).length,
      disposition_only_edges: reviews.filter((item) => item.runnable_check_targets.length === 0).length,
      source_plan_items: sourcePlan.length,
      runnable_targets: targetRefs.length,
      targets_need_sync: targetRefs.filter((target) => target.coverage_state === "not_synced").length,
      targets_need_enable: targetRefs.filter((target) => target.coverage_state === "disabled").length,
      targets_due: targetRefs.filter((target) => target.coverage_state === "due").length,
      targets_failed_preflight: targetRefs.filter((target) => target.preflight_status === "failed").length,
      targets_missing_credentials: targetRefs.filter((target) => target.preflight_issue_kind === "missing_credentials").length,
      by_source: countBy(targetRefs, (target) => target.source_adapter_id)
    },
    target_refs: targetRefs,
    source_plan: sourcePlan
  };
}

export function renderCorroborationSourcePlanMarkdown(plan: CorroborationSourcePlan): string {
  const lines = [
    `# Corroboration Source Plan ${plan.company_id}`,
    "",
    `Generated at: ${plan.generated_at}`,
    "",
    "This file is a filtered source-plan for edge-level corroboration reviews. It is executable by the existing source target commands, but it does not fetch sources, write observations, or create fact edges by itself.",
    "",
    "## Summary",
    "",
    `- Review edges: ${plan.summary.review_edges}`,
    `- Disposition-only edges: ${plan.summary.disposition_only_edges}`,
    `- Source-plan items: ${plan.summary.source_plan_items}`,
    `- Runnable targets: ${plan.summary.runnable_targets}`,
    `- Need sync: ${plan.summary.targets_need_sync}`,
    `- Need enable: ${plan.summary.targets_need_enable}`,
    `- Due: ${plan.summary.targets_due}`,
    `- Failed preflight: ${plan.summary.targets_failed_preflight}`,
    `- Missing credentials: ${plan.summary.targets_missing_credentials}`,
    `- By source: ${formatCountMap(plan.summary.by_source)}`,
    "",
    "## Targets",
    ""
  ];
  if (plan.target_refs.length === 0) {
    lines.push("No runnable corroboration source targets. Record explicit single-source disposition for disposition-only edges.");
    return lines.join("\n");
  }
  for (const target of plan.target_refs) {
    const coverage = target.coverage_state === null ? "no coverage" : target.coverage_state;
    const preflight =
      target.preflight_status === null
        ? "no preflight"
        : `${target.preflight_status}${target.preflight_issue_kind === null ? "" : `/${target.preflight_issue_kind}`}`;
    lines.push(`- ${target.source_adapter_id}/${target.target_kind}: ${coverage}; ${preflight}`);
    lines.push(
      `  Backlog: ${target.backlog_id}; edges=${target.edge_ids.join(",")}; unknowns=${target.unknown_ids.length === 0 ? "none" : target.unknown_ids.join(",")}`
    );
    if (target.check_target_id !== null) lines.push(`  Source target: ${target.check_target_id}`);
    if (target.preflight_missing_credential_env_keys.length > 0) {
      lines.push(`  Missing credentials: ${target.preflight_missing_credential_env_keys.join(", ")}`);
    }
  }
  return lines.join("\n");
}

function buildTargetRefs(reviews: readonly InvestigationBacklogItem[]): CorroborationSourcePlanTargetRef[] {
  const byKey = new Map<string, CorroborationSourcePlanTargetRef>();
  for (const review of reviews) {
    for (const target of review.runnable_check_targets) {
      const coverage = coverageForTarget(review.source_target_coverage, target);
      const ref: CorroborationSourcePlanTargetRef = {
        backlog_id: review.backlog_id,
        edge_ids: review.target.edge_ids,
        unknown_ids: review.target.unknown_ids,
        source_adapter_id: target.source_adapter_id,
        target_kind: target.target_kind,
        target_config: copyTargetConfig(target.target_config),
        coverage_state: coverage?.state ?? null,
        check_target_id: coverage?.check_target_id ?? null,
        preflight_status: coverage?.preflight_status ?? null,
        preflight_issue_kind: coverage?.preflight_issue_kind ?? null,
        preflight_missing_credential_env_keys: coverage?.preflight_missing_credential_env_keys ?? []
      };
      byKey.set(sourceTargetKey(ref), mergeTargetRef(byKey.get(sourceTargetKey(ref)), ref));
    }
  }
  return [...byKey.values()].sort(compareTargetRefs);
}

function mergeTargetRef(left: CorroborationSourcePlanTargetRef | undefined, right: CorroborationSourcePlanTargetRef): CorroborationSourcePlanTargetRef {
  if (left === undefined) return right;
  return {
    ...left,
    edge_ids: uniqueSorted([...left.edge_ids, ...right.edge_ids]),
    unknown_ids: uniqueSorted([...left.unknown_ids, ...right.unknown_ids]),
    preflight_missing_credential_env_keys: uniqueSorted([...left.preflight_missing_credential_env_keys, ...right.preflight_missing_credential_env_keys])
  };
}

function filterSourcePlan(sourcePlan: readonly SourcePlanItem[], targetKeys: ReadonlySet<string>): SourcePlanItem[] {
  return sourcePlan
    .map((item) => ({
      ...item,
      suggested_check_targets: item.suggested_check_targets.filter((target) => target.runnable && targetKeys.has(sourceTargetKey(target)))
    }))
    .filter((item) => item.suggested_check_targets.length > 0)
    .sort((left, right) => left.source_id.localeCompare(right.source_id));
}

function coverageForTarget(
  coverage: readonly InvestigationBacklogSourceTargetCoverage[],
  target: SourcePlanCheckTargetSuggestion
): InvestigationBacklogSourceTargetCoverage | undefined {
  const targetKey = sourceTargetKey(target);
  return coverage.find((item) => sourceTargetKey(item) === targetKey);
}

function sourceTargetKey(target: { source_adapter_id: string; target_kind: string; target_config: Record<string, unknown> }): string {
  return `${target.source_adapter_id}:${target.target_kind}:${stableConfigKey(target.target_config)}`;
}

function copyTargetConfig(config: Record<string, string | number | boolean | string[]>): Record<string, string | number | boolean | string[]> {
  const output: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(config).sort(([left], [right]) => left.localeCompare(right))) {
    output[key] = Array.isArray(value) ? [...value] : value;
  }
  return output;
}

function stableConfigKey(config: Record<string, unknown>): string {
  return Object.entries(config)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${stableConfigValue(value)}`)
    .join(";");
}

function stableConfigValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableConfigValue).join(",")}]`;
  if (isRecord(value)) return `{${stableConfigKey(value)}}`;
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareTargetRefs(left: CorroborationSourcePlanTargetRef, right: CorroborationSourcePlanTargetRef): number {
  return (
    left.source_adapter_id.localeCompare(right.source_adapter_id) ||
    left.target_kind.localeCompare(right.target_kind) ||
    stableConfigKey(left.target_config).localeCompare(stableConfigKey(right.target_config))
  );
}

function countBy<T>(items: readonly T[], keyFn: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const sorted: Record<string, number> = {};
  for (const [key, count] of Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))) sorted[key] = count;
  return sorted;
}

function formatCountMap(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) return "none";
  return entries.map(([key, count]) => `${key}=${count}`).join(", ");
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
