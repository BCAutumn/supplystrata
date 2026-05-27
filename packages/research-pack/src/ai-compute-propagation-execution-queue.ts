import type {
  AiComputePropagationExecutionAction,
  AiComputePropagationExecutionPriority,
  AiComputePropagationExecutionQueue,
  AiComputePropagationExecutionQueueItem,
  AiComputePropagationExecutionSourceTargetAction,
  AiComputePropagationLayerId,
  AiComputePropagationLayerStatus,
  AiComputePropagationNextResearchTarget,
  AiComputePropagationOfficialEvidenceGap,
  AiComputePropagationSourceTargetStatus,
  AiComputePropagationUnknownBacklogSeed
} from "./ai-compute-propagation-readiness-definitions.js";
import { isBlockedSourceTarget, isRunnableSourceTarget } from "./ai-compute-propagation-source-target-summary.js";

export function buildAiComputePropagationExecutionQueue(input: {
  layer_id: AiComputePropagationLayerId;
  layer_title: string;
  status: AiComputePropagationLayerStatus;
  source_target_statuses: readonly AiComputePropagationSourceTargetStatus[];
  official_evidence_gaps: readonly AiComputePropagationOfficialEvidenceGap[];
  unknown_refs: readonly string[];
  unknown_backlog_seeds: readonly AiComputePropagationUnknownBacklogSeed[];
  next_research_targets: readonly AiComputePropagationNextResearchTarget[];
}): AiComputePropagationExecutionQueue {
  const items = uniqueQueueItems([
    ...runSourceTargetItems(input),
    ...repairSourceTargetItems(input),
    ...reviewIntelligenceContextItems(input),
    ...keepUnknownOpenItems(input)
  ]).sort(compareQueueItems);
  return {
    schema_version: "1.0.0",
    summary: summarizeQueue(items),
    items
  };
}

function runSourceTargetItems(input: {
  layer_id: AiComputePropagationLayerId;
  layer_title: string;
  source_target_statuses: readonly AiComputePropagationSourceTargetStatus[];
}): AiComputePropagationExecutionQueueItem[] {
  const runnableStatuses = input.source_target_statuses.filter(isRunnableSourceTarget);
  if (runnableStatuses.length === 0) return [];
  return [
    queueItem({
      layerId: input.layer_id,
      action: "run_source_target",
      priority: "P1",
      title: `Run source targets for ${input.layer_title}`,
      reason: "A source target is runnable, but its output still needs review before it can affect evidence, unknowns, or facts.",
      sourceTargetStatuses: runnableStatuses,
      officialEvidenceGapRefs: [],
      unknownRefs: [],
      nextResearchRefs: []
    })
  ];
}

function repairSourceTargetItems(input: {
  layer_id: AiComputePropagationLayerId;
  layer_title: string;
  source_target_statuses: readonly AiComputePropagationSourceTargetStatus[];
}): AiComputePropagationExecutionQueueItem[] {
  const blocked = input.source_target_statuses.filter(isBlockedSourceTarget);
  if (blocked.length === 0) return [];
  return [
    queueItem({
      layerId: input.layer_id,
      action: "repair_source_target",
      priority: "P1",
      title: `Repair source targets for ${input.layer_title}`,
      reason: "A source target is blocked or degraded, so the layer cannot be deepened until the source path is repaired or explicitly deferred.",
      sourceTargetStatuses: blocked,
      officialEvidenceGapRefs: [],
      unknownRefs: [],
      nextResearchRefs: [],
      repairReason: repairReasonFor(blocked)
    })
  ];
}

function reviewIntelligenceContextItems(input: {
  layer_id: AiComputePropagationLayerId;
  layer_title: string;
  status: AiComputePropagationLayerStatus;
  official_evidence_gaps: readonly AiComputePropagationOfficialEvidenceGap[];
  next_research_targets: readonly AiComputePropagationNextResearchTarget[];
}): AiComputePropagationExecutionQueueItem[] {
  if (input.official_evidence_gaps.length === 0 && input.status === "covered_fact") return [];
  const gapRefs = input.official_evidence_gaps.map(officialEvidenceGapRef);
  const nextRefs = input.next_research_targets.map(nextResearchRef);
  if (gapRefs.length === 0 && nextRefs.length === 0) return [];
  return [
    queueItem({
      layerId: input.layer_id,
      action: "review_intelligence_context",
      priority: input.status === "blocked_source" ? "P1" : "P2",
      title: `Review intelligence context for ${input.layer_title}`,
      reason: "This layer has evidence gaps or next-research targets that should stay in the review queue instead of becoming automatic fact writes.",
      sourceTargetRefs: [],
      officialEvidenceGapRefs: gapRefs,
      unknownRefs: [],
      nextResearchRefs: nextRefs
    })
  ];
}

function keepUnknownOpenItems(input: {
  layer_id: AiComputePropagationLayerId;
  layer_title: string;
  unknown_refs: readonly string[];
  unknown_backlog_seeds: readonly AiComputePropagationUnknownBacklogSeed[];
}): AiComputePropagationExecutionQueueItem[] {
  const unknownRefs = uniqueSorted([...input.unknown_refs, ...input.unknown_backlog_seeds.flatMap((seed) => seed.existing_unknown_refs)]);
  const seedRefs = input.unknown_backlog_seeds.map((seed) => `unknown_seed:${seed.seed_id}`);
  if (unknownRefs.length === 0 && seedRefs.length === 0) return [];
  return [
    queueItem({
      layerId: input.layer_id,
      action: "keep_unknown_open",
      priority: "P2",
      title: `Keep unknown boundary open for ${input.layer_title}`,
      reason: "The layer is not proven by reviewed evidence yet; existing unknowns and deterministic unknown seeds must remain explicit.",
      sourceTargetRefs: uniqueSorted(input.unknown_backlog_seeds.flatMap((seed) => seed.source_target_refs)),
      officialEvidenceGapRefs: [],
      unknownRefs: uniqueSorted([...unknownRefs, ...seedRefs]),
      nextResearchRefs: []
    })
  ];
}

function queueItem(input: {
  layerId: AiComputePropagationLayerId;
  action: AiComputePropagationExecutionAction;
  priority: AiComputePropagationExecutionPriority;
  title: string;
  reason: string;
  sourceTargetRefs?: readonly string[];
  sourceTargetStatuses?: readonly AiComputePropagationSourceTargetStatus[];
  officialEvidenceGapRefs: readonly string[];
  unknownRefs: readonly string[];
  nextResearchRefs: readonly string[];
  repairReason?: string | null;
}): AiComputePropagationExecutionQueueItem {
  const sourceTargetActions = sourceTargetActionsForQueueItem(input.action, input.sourceTargetStatuses ?? []);
  return {
    queue_item_id: `ai-compute:${input.layerId}:${input.action}`,
    action: input.action,
    priority: input.priority,
    title: input.title,
    reason: input.reason,
    source_target_refs: uniqueSorted([...(input.sourceTargetRefs ?? []), ...sourceTargetActions.map((action) => action.source_target_ref)]),
    official_evidence_gap_refs: uniqueSorted(input.officialEvidenceGapRefs),
    unknown_refs: uniqueSorted(input.unknownRefs),
    next_research_refs: uniqueSorted(input.nextResearchRefs),
    source_target_actions: sourceTargetActions,
    repair_reason: input.repairReason ?? null,
    truth_store_write_policy: "review_only_no_automatic_write",
    automatic_fact_mutation_allowed: false
  };
}

function sourceTargetActionsForQueueItem(
  action: AiComputePropagationExecutionAction,
  statuses: readonly AiComputePropagationSourceTargetStatus[]
): AiComputePropagationExecutionSourceTargetAction[] {
  return statuses.map((status) => {
    const checkTargetId = checkTargetIdFromSourceTargetRef(status.ref);
    return {
      source_target_ref: status.ref,
      check_target_id: checkTargetId,
      source_adapter_id: status.source_adapter_id,
      target_kind: status.target_kind,
      state: status.state,
      failure_kind: status.failure_kind,
      latest_event_type: status.latest_event_type,
      recommended_cli_command: recommendedCliCommandForSourceTargetAction(action, checkTargetId),
      writes_truth_store: action === "run_source_target",
      requires_database: true
    };
  });
}

function recommendedCliCommandForSourceTargetAction(action: AiComputePropagationExecutionAction, checkTargetId: string | null): string | null {
  if (checkTargetId === null) return null;
  if (action === "run_source_target") return `pnpm --silent cli sources run-due --check-target-id ${checkTargetId} --format markdown`;
  if (action === "repair_source_target") return `pnpm --silent cli sources due --check-target-id ${checkTargetId} --format markdown`;
  return null;
}

function checkTargetIdFromSourceTargetRef(ref: string): string | null {
  if (!ref.startsWith("source_target:")) return null;
  const body = ref.slice("source_target:".length);
  const lastSeparator = body.lastIndexOf(":");
  if (lastSeparator <= 0) return body.length === 0 ? null : body;
  return body.slice(0, lastSeparator);
}

function summarizeQueue(items: readonly AiComputePropagationExecutionQueueItem[]): AiComputePropagationExecutionQueue["summary"] {
  return {
    items: items.length,
    run_source_target: countAction(items, "run_source_target"),
    repair_source_target: countAction(items, "repair_source_target"),
    review_intelligence_context: countAction(items, "review_intelligence_context"),
    keep_unknown_open: countAction(items, "keep_unknown_open"),
    p0: countPriority(items, "P0"),
    p1: countPriority(items, "P1"),
    p2: countPriority(items, "P2"),
    runnable_source_targets: uniqueSorted(items.filter((item) => item.action === "run_source_target").flatMap((item) => item.source_target_refs)).length,
    blocked_source_targets: uniqueSorted(items.filter((item) => item.action === "repair_source_target").flatMap((item) => item.source_target_refs)).length,
    unknown_refs: uniqueSorted(items.flatMap((item) => item.unknown_refs)).length
  };
}

function officialEvidenceGapRef(value: AiComputePropagationOfficialEvidenceGap): string {
  return `official_evidence_gap:${value.gap_kind}:${value.target_kind}:${value.target_id}`;
}

function nextResearchRef(value: AiComputePropagationNextResearchTarget): string {
  return `next_research_target:${value.target_kind}:${value.target_id}`;
}

function repairReasonFor(statuses: readonly AiComputePropagationSourceTargetStatus[]): string {
  const failureKinds = uniqueSorted(statuses.flatMap((status) => (status.failure_kind === null ? [] : [status.failure_kind])));
  const failedEvents = statuses.some((status) => status.latest_event_type === "SOURCE_FAILED");
  const states = uniqueSorted(statuses.flatMap((status) => (status.state === null ? [] : [status.state])));
  const parts = [
    failureKinds.length === 0 ? null : `failure_kind=${failureKinds.join(",")}`,
    failedEvents ? "latest_event_type=SOURCE_FAILED" : null,
    states.length === 0 ? null : `state=${states.join(",")}`
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? "blocked_source_target" : parts.join("; ");
}

function uniqueQueueItems(items: readonly AiComputePropagationExecutionQueueItem[]): AiComputePropagationExecutionQueueItem[] {
  const byId = new Map<string, AiComputePropagationExecutionQueueItem>();
  for (const item of items) byId.set(item.queue_item_id, item);
  return [...byId.values()];
}

function compareQueueItems(left: AiComputePropagationExecutionQueueItem, right: AiComputePropagationExecutionQueueItem): number {
  const priority = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
  if (priority !== 0) return priority;
  const action = ACTION_ORDER[left.action] - ACTION_ORDER[right.action];
  if (action !== 0) return action;
  return left.queue_item_id.localeCompare(right.queue_item_id);
}

function countAction(items: readonly AiComputePropagationExecutionQueueItem[], action: AiComputePropagationExecutionAction): number {
  return items.filter((item) => item.action === action).length;
}

function countPriority(items: readonly AiComputePropagationExecutionQueueItem[], priority: AiComputePropagationExecutionPriority): number {
  return items.filter((item) => item.priority === priority).length;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

const ACTION_ORDER: Record<AiComputePropagationExecutionAction, number> = {
  repair_source_target: 0,
  run_source_target: 1,
  review_intelligence_context: 2,
  keep_unknown_open: 3
};

const PRIORITY_ORDER: Record<AiComputePropagationExecutionPriority, number> = { P0: 0, P1: 1, P2: 2 };
