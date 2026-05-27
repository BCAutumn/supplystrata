import type { SourceTargetCoverageItem } from "@supplystrata/source-monitor";
import type { Gate1DataDepthSourceTargetRef, Gate1DataDepthWorkbenchItem } from "./gate1-data-depth-workbench-definitions.js";
import type { SourceTargetCoverageReport } from "./source-target-coverage.js";
import { commandHint, nonEmpty, uniqueSorted, workItem } from "./gate1-data-depth-workbench-item-shared.js";

export function sourceBlockerItems(report: SourceTargetCoverageReport): Gate1DataDepthWorkbenchItem[] {
  const blockers = report.items.filter(isSourceBlocked);
  if (blockers.length === 0) return [];
  const grouped = new Map<string, SourceTargetCoverageItem[]>();
  for (const item of blockers) {
    const key = `${item.expected_target.source_adapter_id}:${item.latest_job?.failure_kind ?? item.state}`;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return [...grouped.entries()].map(([key, items]) => {
    const [sourceAdapter, reason] = key.split(":");
    const sourceAdapterId = sourceAdapter ?? "unknown-source";
    const blockerReason = reason ?? "unknown";
    return workItem({
      item_id: `gate1-source-blocker:${sourceAdapterId}:${blockerReason}`,
      workstream: "source_blocker",
      priority: blockerReason === "missing_credentials" || blockerReason === "source_unreachable" ? "P0" : "P1",
      frontend_action_kind: "repair_source_target",
      title: `Resolve source blocker for ${sourceAdapterId}`,
      rationale: `${items.length} expected source target(s) are blocked by ${blockerReason}; without fixing this path, official observations cannot improve corroboration or data depth.`,
      recommended_action:
        "Fix the source policy or credential/configuration surface, then rerun the source target sync/check path. Keep resulting observations in review paths until evidence is approved.",
      recommended_decision:
        blockerReason === "missing_credentials" || blockerReason === "target_config_invalid" ? "sync_or_enable_source_target" : "rerun_source_check",
      allowed_decisions: ["sync_or_enable_source_target", "rerun_source_check", "defer"],
      write_impact: "May update source policy or source_check_targets/jobs only; does not create evidence or fact edges.",
      command_hints: sourceBlockerCommandHints(items),
      refs: items.map((item) => `source_target:${item.matched_check_target_id ?? item.expected_target.check_target_id}`).sort(),
      edge_ids: [],
      component_ids: uniqueSorted(items.map((item) => targetConfigString(item, "component_id")).filter(nonEmpty)),
      source_adapters: [sourceAdapterId],
      source_targets: items.map(toCoverageSourceTargetRef)
    });
  });
}

function sourceBlockerCommandHints(items: readonly SourceTargetCoverageItem[]) {
  const checkTargetIds = uniqueSorted(items.map((item) => item.matched_check_target_id ?? item.expected_target.check_target_id));
  const checkTargetFlag = checkTargetIds.length === 0 ? "<check-target-id>" : checkTargetIds.join(",");
  return [
    commandHint("Inspect blocked targets", `pnpm --silent cli sources due --check-target-id ${checkTargetFlag} --format markdown`, false, true),
    commandHint("Rerun blocked targets", `pnpm --silent cli sources run-due --check-target-id ${checkTargetFlag} --format markdown`, true, true),
    commandHint("Run one configured check", "pnpm --silent cli sources check --config-file <target-config.json>", true, true)
  ];
}

function isSourceBlocked(item: SourceTargetCoverageItem): boolean {
  return (
    item.state === "retry_wait" ||
    item.state === "degraded" ||
    item.state === "dead" ||
    (item.latest_job !== null && item.latest_job.failure_kind !== null) ||
    item.latest_event?.event_type === "SOURCE_FAILED"
  );
}

function toCoverageSourceTargetRef(item: SourceTargetCoverageItem): Gate1DataDepthSourceTargetRef {
  return {
    check_target_id: item.matched_check_target_id ?? item.expected_target.check_target_id,
    expected_check_target_id: item.expected_target.check_target_id,
    matched_check_target_id: item.matched_check_target_id,
    match_kind: item.match_kind,
    source_adapter_id: item.expected_target.source_adapter_id,
    target_kind: item.expected_target.target_kind,
    state: item.state,
    latest_event_type: item.latest_event?.event_type ?? null,
    failure_kind: item.latest_job?.failure_kind ?? null,
    observations: item.observations,
    target_entity_id: targetConfigString(item, "entity_id"),
    target_component_id: targetConfigString(item, "component_id")
  };
}

function targetConfigString(item: SourceTargetCoverageItem, key: string): string | null {
  const value = item.expected_target.target_config[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
