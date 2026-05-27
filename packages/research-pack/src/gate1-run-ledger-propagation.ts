import type {
  AiComputePropagationExecutionQueueItem,
  AiComputePropagationExecutionSourceTargetAction,
  AiComputePropagationLayer
} from "./ai-compute-propagation-readiness-definitions.js";
import type { Gate1PropagationExecutionLedger, Gate1RunAction } from "./gate1-run-ledger-definitions.js";
import type { PropagationReadinessReport } from "./propagation-readiness.js";

type PropagationOperationalAction =
  | "sync_targets"
  | "run_due_targets"
  | "wait_for_scheduled_targets"
  | "review_observations"
  | "investigate_source_failures"
  | "record_single_source_disposition";

const SOURCE_TARGET_ACTION_BATCH_SIZE = 10;

export function buildGate1PropagationExecutionLedger(input: { propagation_readiness?: PropagationReadinessReport }): Gate1PropagationExecutionLedger {
  const layers =
    input.propagation_readiness?.ai_compute_matrix.layers.map((layer) => ({
      layer_id: layer.layer_id,
      title: layer.title,
      status: layer.status,
      queue_items: layer.execution_queue.summary.items,
      run_source_target: layer.execution_queue.summary.run_source_target,
      repair_source_target: layer.execution_queue.summary.repair_source_target,
      review_intelligence_context: layer.execution_queue.summary.review_intelligence_context,
      keep_unknown_open: layer.execution_queue.summary.keep_unknown_open,
      runnable_source_targets: layer.execution_queue.summary.runnable_source_targets,
      blocked_source_targets: layer.execution_queue.summary.blocked_source_targets,
      unknown_refs: layer.execution_queue.summary.unknown_refs,
      queue_item_refs: layer.execution_queue.items.map((item) => item.queue_item_id)
    })) ?? [];
  const summary = {
    layers: layers.length,
    queue_items: sum(layers.map((layer) => layer.queue_items)),
    run_source_target: sum(layers.map((layer) => layer.run_source_target)),
    repair_source_target: sum(layers.map((layer) => layer.repair_source_target)),
    review_intelligence_context: sum(layers.map((layer) => layer.review_intelligence_context)),
    keep_unknown_open: sum(layers.map((layer) => layer.keep_unknown_open)),
    runnable_source_targets: uniqueSorted(
      input.propagation_readiness?.ai_compute_matrix.layers.flatMap((layer) =>
        layer.execution_queue.items.filter((item) => item.action === "run_source_target").flatMap((item) => item.source_target_refs)
      ) ?? []
    ).length,
    blocked_source_targets: uniqueSorted(
      input.propagation_readiness?.ai_compute_matrix.layers.flatMap((layer) =>
        layer.execution_queue.items.filter((item) => item.action === "repair_source_target").flatMap((item) => item.source_target_refs)
      ) ?? []
    ).length,
    unknown_refs: uniqueSorted(
      input.propagation_readiness?.ai_compute_matrix.layers.flatMap((layer) => layer.execution_queue.items.flatMap((item) => item.unknown_refs)) ?? []
    ).length,
    p0: sum(
      input.propagation_readiness?.ai_compute_matrix.layers
        .flatMap((layer) => layer.execution_queue.items.filter((item) => item.priority === "P0"))
        .map(() => 1) ?? []
    ),
    p1: sum(
      input.propagation_readiness?.ai_compute_matrix.layers
        .flatMap((layer) => layer.execution_queue.items.filter((item) => item.priority === "P1"))
        .map(() => 1) ?? []
    ),
    p2: sum(
      input.propagation_readiness?.ai_compute_matrix.layers
        .flatMap((layer) => layer.execution_queue.items.filter((item) => item.priority === "P2"))
        .map(() => 1) ?? []
    )
  };
  return {
    summary,
    layers,
    next_focus: propagationNextFocus(summary),
    guardrails: [
      "Propagation execution queue is a review-only execution map.",
      "Running or repairing a source target can only produce monitor events, observations, review candidates, or dispositions.",
      "No propagation action can write fact edges, raise evidence_level, or close unknowns automatically."
    ]
  };
}

export function gate1PropagationExecutionActions(input: {
  propagation_readiness?: PropagationReadinessReport;
  source_target_namespace: string;
}): Gate1RunAction[] {
  return (
    input.propagation_readiness?.ai_compute_matrix.layers.flatMap((layer) =>
      layer.execution_queue.items.flatMap((item) => propagationActionsForItem({ layer, item, source_target_namespace: input.source_target_namespace }))
    ) ?? []
  );
}

function propagationActionsForItem(input: {
  layer: AiComputePropagationLayer;
  item: AiComputePropagationExecutionQueueItem;
  source_target_namespace: string;
}): Gate1RunAction[] {
  if (input.item.source_target_actions.length > 0) {
    return propagationActionsFromSourceTargetActions(input.layer, input.item, input.source_target_namespace);
  }

  const statusesByRef = new Map(input.layer.source_target_statuses.map((status) => [status.ref, status]));
  if (input.item.action === "run_source_target") {
    return [
      ...propagationActionsForRefGroups(
        input.layer,
        input.item,
        "sync_targets",
        refsForStates(input.item.source_target_refs, statusesByRef, ["not_synced"]),
        input.source_target_namespace
      ),
      ...propagationActionsForRefGroups(
        input.layer,
        input.item,
        "run_due_targets",
        refsForStates(input.item.source_target_refs, statusesByRef, ["due"]),
        input.source_target_namespace
      ),
      ...propagationActionsForRefGroups(
        input.layer,
        input.item,
        "wait_for_scheduled_targets",
        refsForStates(input.item.source_target_refs, statusesByRef, ["scheduled"]),
        input.source_target_namespace
      ),
      ...propagationActionsForRefGroups(
        input.layer,
        input.item,
        "review_observations",
        refsForStates(input.item.source_target_refs, statusesByRef, ["succeeded"]),
        input.source_target_namespace
      )
    ];
  }
  const operationalAction = operationalActionForQueueItem(input.item);
  return propagationActionsForRefGroups(input.layer, input.item, operationalAction, input.item.source_target_refs, input.source_target_namespace);
}

function propagationActionsFromSourceTargetActions(
  layer: AiComputePropagationLayer,
  item: AiComputePropagationExecutionQueueItem,
  sourceTargetNamespace: string
): Gate1RunAction[] {
  const actionGroups = new Map<PropagationOperationalAction, AiComputePropagationExecutionSourceTargetAction[]>();
  for (const sourceTargetAction of item.source_target_actions) {
    const operationalAction = operationalActionForSourceTargetAction(item, sourceTargetAction);
    const existing = actionGroups.get(operationalAction);
    if (existing === undefined) {
      actionGroups.set(operationalAction, [sourceTargetAction]);
    } else {
      existing.push(sourceTargetAction);
    }
  }
  return [...actionGroups.entries()].flatMap(([operationalAction, sourceTargetActions]) =>
    propagationActionsForSourceTargetActionGroups(layer, item, operationalAction, sourceTargetActions, sourceTargetNamespace)
  );
}

function operationalActionForSourceTargetAction(
  item: AiComputePropagationExecutionQueueItem,
  sourceTargetAction: AiComputePropagationExecutionSourceTargetAction
): PropagationOperationalAction {
  if (item.action === "repair_source_target") return "investigate_source_failures";
  if (item.action === "review_intelligence_context") return "review_observations";
  if (item.action !== "run_source_target") return "record_single_source_disposition";

  if (sourceTargetAction.state === "not_synced") return "sync_targets";
  if (sourceTargetAction.state === "due") return "run_due_targets";
  if (sourceTargetAction.state === "scheduled") return "wait_for_scheduled_targets";
  if (sourceTargetAction.state === "succeeded") return "review_observations";
  if (
    sourceTargetAction.state === "retry_wait" ||
    sourceTargetAction.state === "degraded" ||
    sourceTargetAction.state === "dead" ||
    sourceTargetAction.state === "source_failed" ||
    sourceTargetAction.failure_kind !== null
  ) {
    return "investigate_source_failures";
  }
  return "wait_for_scheduled_targets";
}

function propagationActionsForSourceTargetActionGroups(
  layer: AiComputePropagationLayer,
  item: AiComputePropagationExecutionQueueItem,
  operationalAction: PropagationOperationalAction,
  sourceTargetActions: readonly AiComputePropagationExecutionSourceTargetAction[],
  sourceTargetNamespace: string
): Gate1RunAction[] {
  return sourceTargetActionGroups(sourceTargetActions).flatMap(
    (group) => propagationActionForItem(layer, item, operationalAction, group, sourceTargetNamespace) ?? []
  );
}

function propagationActionsForRefGroups(
  layer: AiComputePropagationLayer,
  item: AiComputePropagationExecutionQueueItem,
  operationalAction: PropagationOperationalAction,
  sourceTargetRefs: readonly string[],
  sourceTargetNamespace: string
): Gate1RunAction[] {
  return sourceTargetRefGroups(sourceTargetRefs).flatMap(
    (group) => propagationActionForItem(layer, item, operationalAction, group, sourceTargetNamespace) ?? []
  );
}

function propagationActionForItem(
  layer: AiComputePropagationLayer,
  item: AiComputePropagationExecutionQueueItem,
  operationalAction: PropagationOperationalAction,
  sourceTargetGroup: SourceTargetRefGroup,
  sourceTargetNamespace: string
): Gate1RunAction | null {
  const refs = uniqueSorted([...sourceTargetGroup.refs, ...item.official_evidence_gap_refs, ...item.unknown_refs, ...item.next_research_refs]);
  if (refs.length === 0) return null;
  return {
    action_id: `gate1:propagation:${safeActionSegment(layer.layer_id)}:${item.action}:${operationalAction}:${sourceTargetGroup.group_id}`,
    kind: operationalAction,
    priority: item.priority,
    title: `${actionTitle(item, operationalAction)}: ${layer.title} (${sourceTargetGroup.label})`,
    rationale: actionRationale(item, operationalAction),
    command_hint: commandHintFor(operationalAction, sourceTargetGroup.refs, sourceTargetNamespace),
    refs
  };
}

function operationalActionForQueueItem(item: AiComputePropagationExecutionQueueItem): PropagationOperationalAction {
  if (item.action === "repair_source_target") return "investigate_source_failures";
  if (item.action === "review_intelligence_context") return "review_observations";
  return "record_single_source_disposition";
}

function actionTitle(item: AiComputePropagationExecutionQueueItem, operationalAction: PropagationOperationalAction): string {
  if (item.action === "run_source_target" && operationalAction === "sync_targets") return "Sync propagation source targets";
  if (item.action === "run_source_target" && operationalAction === "run_due_targets") return "Run due propagation source targets";
  if (item.action === "run_source_target" && operationalAction === "wait_for_scheduled_targets") return "Wait for scheduled propagation source targets";
  if (item.action === "run_source_target" && operationalAction === "review_observations") return "Review produced propagation observations";
  if (item.action === "repair_source_target") return "Repair propagation source targets";
  if (item.action === "review_intelligence_context") return "Review propagation intelligence context";
  return "Keep propagation unknown boundary open";
}

function actionRationale(item: AiComputePropagationExecutionQueueItem, operationalAction: PropagationOperationalAction): string {
  const operationalReason =
    operationalAction === "sync_targets"
      ? " These source targets are not synced yet, so they must enter source_check_targets before a worker can run them."
      : operationalAction === "wait_for_scheduled_targets"
        ? " These source targets are scheduled but not due yet; keep them visible without presenting them as runnable work."
        : operationalAction === "review_observations"
          ? " These source targets already produced monitor output; review the observations or disposition before touching the truth store."
          : "";
  const repairReason = item.repair_reason === null ? "" : ` Repair reason: ${item.repair_reason}.`;
  return `${item.reason}${operationalReason}${repairReason}`;
}

function commandHintFor(operationalAction: PropagationOperationalAction, sourceTargetRefs: readonly string[], sourceTargetNamespace: string): string | null {
  const checkTargetIds = sourceTargetRefsToCheckTargetIds(sourceTargetRefs);
  if (checkTargetIds.length === 0) return null;
  if (operationalAction === "sync_targets") {
    return `supplystrata sources policy sync-plan-targets --source-plan source-plan.json --namespace ${sourceTargetNamespace} --check-target-id ${checkTargetIds.join(",")}`;
  }
  if (operationalAction === "run_due_targets") {
    return `supplystrata sources run-due --check-target-id ${checkTargetIds.join(",")} --format markdown`;
  }
  if (operationalAction === "wait_for_scheduled_targets") {
    return `supplystrata sources due --check-target-id ${checkTargetIds.join(",")} --format markdown`;
  }
  if (operationalAction === "investigate_source_failures") {
    return `supplystrata sources due --check-target-id ${checkTargetIds.join(",")} --format markdown`;
  }
  return null;
}

function refsForStates(refs: readonly string[], statusesByRef: ReadonlyMap<string, { state: string | null }>, states: readonly string[]): string[] {
  const stateSet = new Set(states);
  return refs.filter((ref) => stateSet.has(statusesByRef.get(ref)?.state ?? ""));
}

interface SourceTargetRefGroup {
  group_id: string;
  label: string;
  refs: string[];
}

function sourceTargetActionGroups(sourceTargetActions: readonly AiComputePropagationExecutionSourceTargetAction[]): SourceTargetRefGroup[] {
  return sourceTargetRefGroups(sourceTargetActions.map((action) => action.source_target_ref));
}

function sourceTargetRefGroups(refs: readonly string[]): SourceTargetRefGroup[] {
  if (refs.length === 0) return [{ group_id: "no-source-target", label: "no source target refs", refs: [] }];
  const groups = new Map<string, SourceTargetRefGroup>();
  for (const ref of refs) {
    const identity = sourceTargetGroupIdentity(ref);
    const existing = groups.get(identity.group_id);
    if (existing === undefined) {
      groups.set(identity.group_id, { ...identity, refs: [ref] });
    } else {
      existing.refs.push(ref);
    }
  }
  return [...groups.values()].flatMap(splitLargeSourceTargetGroup).sort((left, right) => left.group_id.localeCompare(right.group_id));
}

function splitLargeSourceTargetGroup(group: SourceTargetRefGroup): SourceTargetRefGroup[] {
  const refs = uniqueSorted(group.refs);
  if (refs.length <= SOURCE_TARGET_ACTION_BATCH_SIZE) return [{ ...group, refs }];
  const chunks: SourceTargetRefGroup[] = [];
  for (let index = 0; index < refs.length; index += SOURCE_TARGET_ACTION_BATCH_SIZE) {
    const batchNumber = chunks.length + 1;
    chunks.push({
      group_id: `${group.group_id}-batch-${batchNumber}`,
      label: `${group.label} batch ${batchNumber}`,
      refs: refs.slice(index, index + SOURCE_TARGET_ACTION_BATCH_SIZE)
    });
  }
  return chunks;
}

function sourceTargetGroupIdentity(ref: string): Pick<SourceTargetRefGroup, "group_id" | "label"> {
  const checkTargetId = sourceTargetRefsToCheckTargetIds([ref])[0];
  if (checkTargetId === undefined) return { group_id: "non-source-target", label: "non-source-target refs" };
  const parts = checkTargetId.split(":");
  if (parts[0] === "plan" && parts.length >= 5) {
    const sourceAdapterId = parts[2] ?? "unknown-source";
    const targetKind = parts[3] ?? "unknown-target";
    return {
      group_id: safeActionSegment(`${sourceAdapterId}:${targetKind}`),
      label: `${sourceAdapterId}/${targetKind}`
    };
  }
  return {
    group_id: "selected-source-targets",
    label: "selected source targets"
  };
}

function sourceTargetRefsToCheckTargetIds(refs: readonly string[]): string[] {
  return uniqueSorted(refs.flatMap(checkTargetIdFromSourceTargetRef));
}

function checkTargetIdFromSourceTargetRef(ref: string): string[] {
  const prefix = "source_target:";
  if (!ref.startsWith(prefix)) return [];
  const withoutPrefix = ref.slice(prefix.length);
  const lastSeparator = withoutPrefix.lastIndexOf(":");
  const checkTargetId = lastSeparator < 0 ? withoutPrefix : withoutPrefix.slice(0, lastSeparator);
  if (checkTargetId.trim().length === 0) return [];
  return [checkTargetId];
}

function propagationNextFocus(summary: Gate1PropagationExecutionLedger["summary"]): string {
  if (summary.repair_source_target > 0) return "Repair blocked propagation source targets before treating those layers as research-ready.";
  if (summary.run_source_target > 0) return "Run propagation source targets and review their outputs before adding evidence.";
  if (summary.review_intelligence_context > 0) return "Review official evidence gaps and next-research targets without mutating the truth store.";
  if (summary.keep_unknown_open > 0) return "Keep explicit unknown boundaries open until reviewed evidence closes them.";
  return "No propagation execution queue item is currently open.";
}

function safeActionSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
