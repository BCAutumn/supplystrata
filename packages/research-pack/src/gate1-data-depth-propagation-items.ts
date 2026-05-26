import type {
  Gate1DataDepthCommandHint,
  Gate1DataDepthPriority,
  Gate1DataDepthReviewDecision,
  Gate1DataDepthSourceTargetRef,
  Gate1DataDepthWorkbenchItem
} from "./gate1-data-depth-workbench-definitions.js";
import type {
  AiComputePropagationLayer,
  AiComputePropagationLayerStatus,
  AiComputePropagationOfficialEvidenceGap
} from "./ai-compute-propagation-readiness.js";
import type { PropagationReadinessReport } from "./propagation-readiness.js";

const REVIEW_POLICY = "review_only_no_fact_mutation";

export function propagationWorkItems(report: PropagationReadinessReport): Gate1DataDepthWorkbenchItem[] {
  return [...propagationContextWorkItems(report), ...aiComputeLayerWorkItems(report.ai_compute_matrix.layers)];
}

function propagationContextWorkItems(report: PropagationReadinessReport): Gate1DataDepthWorkbenchItem[] {
  return report.items
    .filter((item) => item.status !== "ready")
    .map((item) =>
      workItem({
        item_id: `gate1-propagation:${item.context_kind}`,
        priority: item.status === "blocked" ? "P1" : "P2",
        title: item.title,
        rationale: item.rationale,
        recommended_action: item.action,
        recommended_decision: "keep_unknown_open",
        allowed_decisions: ["keep_unknown_open", "defer"],
        write_impact: "No write is recommended from this item; use it as propagation context until review-approved evidence or labels exist.",
        command_hints: [],
        refs: uniqueSorted([...item.observation_series_refs, ...item.source_plan_refs, ...item.component_dependency_refs, ...item.frontier_refs]),
        edge_ids: item.frontier_refs.map((ref) => ref.replace("supply_chain_frontier:", "")),
        component_ids: item.component_ids,
        source_adapters: [],
        source_targets: []
      })
    );
}

function aiComputeLayerWorkItems(layers: readonly AiComputePropagationLayer[]): Gate1DataDepthWorkbenchItem[] {
  return layers
    .filter((layer) => layer.status !== "covered_fact" || layer.official_evidence_gaps.length > 0)
    .map((layer) =>
      workItem({
        item_id: `gate1-ai-compute-propagation:${layer.layer_id}`,
        priority: priorityForLayer(layer),
        title: titleForLayer(layer),
        rationale: `${layer.question} Current status is ${layer.status}: ${layer.status_reason} Missing official evidence: ${formatSentenceList(
          layer.missing_official_evidence
        )} Official evidence gaps: ${formatEvidenceGapList(
          layer.official_evidence_gaps.map((gap) => `${gap.gap_kind} ${gap.target_kind}:${gap.target_id}`)
        )} Unknown/backlog seed: ${formatUnknownSeedList(layer.unknown_backlog_seeds.map((seed) => `${seed.seed_id} ${seed.recommended_review_action}`))}`,
        recommended_action: recommendedActionForLayer(layer),
        recommended_decision: decisionForLayer(layer),
        allowed_decisions: allowedDecisionsForLayer(layer),
        write_impact:
          "No fact-layer write is authorized from this item. Use the refs as frontend/AI research input; only review-approved evidence may later create fact edges or close unknowns.",
        command_hints: sourcePlanCommandHints(sourceAdaptersForLayer(layer)),
        refs: layerRefs(layer),
        edge_ids: layer.fact_edge_refs.map((ref) => ref.replace("edge:", "")),
        component_ids: layer.component_ids,
        source_adapters: sourceAdaptersForLayer(layer),
        source_targets: sourceTargetsForLayer(layer),
        evidence_layer_summary: layer.evidence_layer_summary
      })
    );
}

function priorityForLayer(layer: AiComputePropagationLayer): Gate1DataDepthPriority {
  const highestGapPriority = highestOfficialEvidenceGapPriority(layer.official_evidence_gaps);
  if (highestGapPriority !== null) return highestGapPriority;
  return priorityForLayerStatus(layer.status);
}

function priorityForLayerStatus(status: AiComputePropagationLayerStatus): Gate1DataDepthPriority {
  if (status === "blocked_source" || status === "unknown_open") return "P1";
  if (status === "official_target_runnable") return "P1";
  return "P2";
}

function titleForLayer(layer: AiComputePropagationLayer): string {
  if (layer.status === "covered_fact" && layer.official_evidence_gaps.length > 0) return `Close partial AI compute evidence gaps: ${layer.title}`;
  return `Close AI compute propagation layer: ${layer.title}`;
}

function recommendedActionForLayer(layer: AiComputePropagationLayer): string {
  const gapAction = recommendedActionForOfficialEvidenceGaps(layer.official_evidence_gaps);
  if (gapAction !== null) return gapAction;
  return layer.next_actions.join(" ");
}

function decisionForLayer(layer: AiComputePropagationLayer): Gate1DataDepthReviewDecision {
  const gapDecision = decisionForOfficialEvidenceGaps(layer.official_evidence_gaps);
  if (gapDecision !== null) return gapDecision;
  if (layer.status === "blocked_source") return "rerun_source_check";
  if (layer.status === "official_target_runnable") return "sync_or_enable_source_target";
  return "keep_unknown_open";
}

function allowedDecisionsForLayer(layer: AiComputePropagationLayer): Gate1DataDepthReviewDecision[] {
  if (layer.official_evidence_gaps.some((gap) => gap.gap_kind === "official_source_blocked")) {
    return ["rerun_source_check", "sync_or_enable_source_target", "keep_unknown_open", "defer"];
  }
  if (layer.official_evidence_gaps.some((gap) => gap.gap_kind === "official_source_not_reviewed")) {
    return ["sync_or_enable_source_target", "rerun_source_check", "keep_unknown_open", "defer"];
  }
  if (layer.status === "blocked_source") return ["rerun_source_check", "sync_or_enable_source_target", "keep_unknown_open", "defer"];
  if (layer.status === "official_target_runnable") return ["sync_or_enable_source_target", "rerun_source_check", "keep_unknown_open", "defer"];
  return ["keep_unknown_open", "defer"];
}

function highestOfficialEvidenceGapPriority(gaps: readonly AiComputePropagationOfficialEvidenceGap[]): Gate1DataDepthPriority | null {
  if (gaps.some((gap) => gap.gap_kind === "official_source_blocked")) return "P1";
  if (gaps.some((gap) => gap.gap_kind === "official_source_not_reviewed")) return "P1";
  if (gaps.some((gap) => gap.gap_kind === "component_without_l4_l5_fact" || gap.gap_kind === "material_or_process_without_l4_l5_fact")) return "P2";
  if (gaps.some((gap) => gap.gap_kind === "observation_only")) return "P2";
  return null;
}

function decisionForOfficialEvidenceGaps(gaps: readonly AiComputePropagationOfficialEvidenceGap[]): Gate1DataDepthReviewDecision | null {
  if (gaps.some((gap) => gap.gap_kind === "official_source_blocked")) return "rerun_source_check";
  if (gaps.some((gap) => gap.gap_kind === "official_source_not_reviewed")) return "sync_or_enable_source_target";
  if (gaps.length > 0) return "keep_unknown_open";
  return null;
}

function recommendedActionForOfficialEvidenceGaps(gaps: readonly AiComputePropagationOfficialEvidenceGap[]): string | null {
  if (gaps.length === 0) return null;
  const topActions = uniquePreserveOrder(gaps.map((gap) => gap.recommended_action)).slice(0, 3);
  return topActions.join(" ");
}

function sourcePlanCommandHints(sourceAdapters: readonly string[]): Gate1DataDepthCommandHint[] {
  if (sourceAdapters.length === 0) return [];
  const sourceFlag = ` --source ${uniqueSorted(sourceAdapters).join(",")}`;
  return [
    commandHint(
      "Preview AI compute layer source targets",
      `pnpm --silent cli sources policy preview-plan-targets --source-plan <source-plan.json> --namespace <namespace>${sourceFlag}`,
      false,
      false
    ),
    commandHint(
      "Sync AI compute layer source targets",
      `pnpm --silent cli sources policy sync-plan-targets --source-plan <source-plan.json> --namespace <namespace>${sourceFlag}`,
      true,
      true
    ),
    commandHint("Run due AI compute layer targets", `pnpm --silent cli sources run-due${sourceFlag} --limit 10`, true, true)
  ];
}

function sourceAdaptersForLayer(layer: AiComputePropagationLayer): string[] {
  return uniqueSorted([
    ...layer.source_plan_refs.map((ref) => ref.replace("source_plan:", "")).filter((value) => value.length > 0),
    ...layer.source_target_groups.flatMap((group) => group.source_adapters),
    ...layer.source_target_statuses.map((item) => item.source_adapter_id)
  ]);
}

function sourceTargetsForLayer(layer: AiComputePropagationLayer): Gate1DataDepthSourceTargetRef[] {
  return uniqueSourceTargets(
    layer.source_target_statuses.map((status) => ({
      check_target_id: checkTargetIdFromSourceTargetRef(status.ref),
      source_adapter_id: status.source_adapter_id,
      target_kind: status.target_kind ?? "unknown",
      state: status.state,
      latest_event_type: status.latest_event_type,
      failure_kind: status.failure_kind,
      observations: null,
      target_entity_id: null,
      target_component_id: null
    }))
  ).slice(0, 40);
}

function checkTargetIdFromSourceTargetRef(ref: string): string | null {
  if (!ref.startsWith("source_target:")) return null;
  const body = ref.slice("source_target:".length);
  const lastSeparator = body.lastIndexOf(":");
  if (lastSeparator <= 0) return body.length === 0 ? null : body;
  return body.slice(0, lastSeparator);
}

function uniqueSourceTargets(values: readonly Gate1DataDepthSourceTargetRef[]): Gate1DataDepthSourceTargetRef[] {
  const byKey = new Map<string, Gate1DataDepthSourceTargetRef>();
  for (const value of values) {
    const key = `${value.check_target_id ?? "planned"}:${value.source_adapter_id}:${value.target_kind}:${value.state ?? "none"}`;
    const existing = byKey.get(key);
    byKey.set(key, existing === undefined ? value : mergeSourceTarget(existing, value));
  }
  return [...byKey.values()].sort((left, right) => sourceTargetSortKey(left).localeCompare(sourceTargetSortKey(right)));
}

function mergeSourceTarget(left: Gate1DataDepthSourceTargetRef, right: Gate1DataDepthSourceTargetRef): Gate1DataDepthSourceTargetRef {
  return {
    ...left,
    latest_event_type: left.latest_event_type ?? right.latest_event_type,
    failure_kind: left.failure_kind ?? right.failure_kind,
    observations: left.observations ?? right.observations,
    target_entity_id: left.target_entity_id ?? right.target_entity_id,
    target_component_id: left.target_component_id ?? right.target_component_id
  };
}

function sourceTargetSortKey(value: Gate1DataDepthSourceTargetRef): string {
  return `${sourceTargetPriority(value)}:${value.source_adapter_id}:${value.target_kind}:${value.check_target_id ?? "planned"}`;
}

function sourceTargetPriority(value: Gate1DataDepthSourceTargetRef): number {
  if (value.failure_kind !== null) return 0;
  if (value.latest_event_type === "SOURCE_FAILED") return 1;
  if (value.state === "retry_wait" || value.state === "degraded" || value.state === "dead") return 2;
  if (value.state === "due" || value.state === "not_synced" || value.state === "scheduled") return 3;
  return 4;
}

function layerRefs(layer: AiComputePropagationLayer): string[] {
  return uniqueSorted([
    ...layer.fact_edge_refs,
    ...layer.observation_refs,
    ...layer.observation_series_refs,
    ...layer.source_plan_refs,
    ...layer.source_target_refs,
    ...layer.source_target_groups.map((group) => `source_target_group:${group.group_kind}`),
    ...layer.next_research_targets.flatMap((target) => [`next_research_target:${target.target_kind}:${target.target_id}`, ...target.refs]),
    ...layer.official_evidence_gaps.flatMap((gap) => [`official_evidence_gap:${gap.gap_kind}:${gap.target_kind}:${gap.target_id}`, ...gap.refs]),
    ...layer.component_dependency_refs,
    ...layer.frontier_refs,
    ...layer.unknown_refs,
    ...layer.unknown_backlog_seeds.map((seed) => `unknown_seed:${seed.seed_id}`),
    ...layer.material_or_process_refs.map((ref) => `material_or_process:${ref}`)
  ]);
}

function formatSentenceList(values: readonly string[]): string {
  return values.length === 0 ? "none." : values.join(" ");
}

function formatUnknownSeedList(values: readonly string[]): string {
  return values.length === 0 ? "none." : values.join("; ");
}

function formatEvidenceGapList(values: readonly string[]): string {
  return values.length === 0 ? "none." : values.join("; ");
}

function workItem(
  input: Omit<Gate1DataDepthWorkbenchItem, "workstream" | "frontend_action_kind" | "review_policy" | "automatic_fact_mutation_allowed" | "ranking_contexts">
): Gate1DataDepthWorkbenchItem {
  return {
    ...input,
    workstream: "propagation_context",
    frontend_action_kind: "review_intelligence_context",
    refs: prioritySortedRefs(input.refs).slice(0, 40),
    edge_ids: uniqueSorted(input.edge_ids).slice(0, 40),
    component_ids: uniqueSorted(input.component_ids).slice(0, 40),
    source_adapters: uniqueSorted(input.source_adapters).slice(0, 20),
    source_targets: input.source_targets.slice(0, 40),
    evidence_layer_summary: input.evidence_layer_summary ?? [],
    allowed_decisions: uniquePreserveOrder(input.allowed_decisions),
    command_hints: input.command_hints.slice(0, 8),
    ranking_contexts: [],
    review_policy: REVIEW_POLICY,
    automatic_fact_mutation_allowed: false
  };
}

function commandHint(label: string, command: string, writesTruthStore: boolean, requiresDatabase: boolean): Gate1DataDepthCommandHint {
  return { label, command, writes_truth_store: writesTruthStore, requires_database: requiresDatabase };
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function prioritySortedRefs(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => {
    const priority = refPriority(left) - refPriority(right);
    if (priority !== 0) return priority;
    return left.localeCompare(right);
  });
}

function refPriority(value: string): number {
  if (value.startsWith("official_evidence_gap:")) return 0;
  if (value.startsWith("unknown_seed:")) return 1;
  if (value.startsWith("source_target_group:")) return 2;
  if (value.startsWith("source_target:")) return 3;
  if (value.startsWith("source_plan:")) return 4;
  if (value.startsWith("next_research_target:")) return 5;
  if (value.startsWith("unknown:")) return 6;
  if (value.startsWith("component:") || value.startsWith("material_or_process:")) return 7;
  if (value.startsWith("edge:")) return 8;
  if (value.startsWith("observation:") || value.startsWith("observation_series:")) return 9;
  return 10;
}

function uniquePreserveOrder<T extends string>(values: readonly T[]): T[] {
  const seen = new Set<T>();
  const result: T[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
