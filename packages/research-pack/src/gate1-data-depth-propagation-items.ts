import type {
  Gate1DataDepthCommandHint,
  Gate1DataDepthPriority,
  Gate1DataDepthReviewDecision,
  Gate1DataDepthWorkbenchItem
} from "./gate1-data-depth-workbench-definitions.js";
import type { AiComputePropagationLayer, AiComputePropagationLayerStatus } from "./ai-compute-propagation-readiness.js";
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
    .filter((layer) => layer.status !== "covered_fact")
    .map((layer) =>
      workItem({
        item_id: `gate1-ai-compute-propagation:${layer.layer_id}`,
        priority: priorityForLayerStatus(layer.status),
        title: `Close AI compute propagation layer: ${layer.title}`,
        rationale: `${layer.question} Current status is ${layer.status}: ${layer.status_reason} Missing official evidence: ${formatSentenceList(
          layer.missing_official_evidence
        )} Unknown/backlog seed: ${formatUnknownSeedList(layer.unknown_backlog_seeds.map((seed) => `${seed.seed_id} ${seed.recommended_review_action}`))}`,
        recommended_action: layer.next_actions.join(" "),
        recommended_decision: decisionForLayerStatus(layer.status),
        allowed_decisions: allowedDecisionsForLayerStatus(layer.status),
        write_impact:
          "No fact-layer write is authorized from this item. Use the refs as frontend/AI research input; only review-approved evidence may later create fact edges or close unknowns.",
        command_hints: sourcePlanCommandHints(sourceAdaptersForLayer(layer)),
        refs: layerRefs(layer),
        edge_ids: layer.fact_edge_refs.map((ref) => ref.replace("edge:", "")),
        component_ids: layer.component_ids,
        source_adapters: sourceAdaptersForLayer(layer),
        source_targets: []
      })
    );
}

function priorityForLayerStatus(status: AiComputePropagationLayerStatus): Gate1DataDepthPriority {
  if (status === "blocked_source" || status === "unknown_open") return "P1";
  if (status === "official_target_runnable") return "P1";
  return "P2";
}

function decisionForLayerStatus(status: AiComputePropagationLayerStatus): Gate1DataDepthReviewDecision {
  if (status === "blocked_source") return "rerun_source_check";
  if (status === "official_target_runnable") return "sync_or_enable_source_target";
  return "keep_unknown_open";
}

function allowedDecisionsForLayerStatus(status: AiComputePropagationLayerStatus): Gate1DataDepthReviewDecision[] {
  if (status === "blocked_source") return ["rerun_source_check", "sync_or_enable_source_target", "keep_unknown_open", "defer"];
  if (status === "official_target_runnable") return ["sync_or_enable_source_target", "rerun_source_check", "keep_unknown_open", "defer"];
  return ["keep_unknown_open", "defer"];
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
    ...layer.source_target_statuses.map((item) => item.source_adapter_id)
  ]);
}

function layerRefs(layer: AiComputePropagationLayer): string[] {
  return uniqueSorted([
    ...layer.fact_edge_refs,
    ...layer.observation_refs,
    ...layer.observation_series_refs,
    ...layer.source_plan_refs,
    ...layer.source_target_refs,
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

function workItem(
  input: Omit<Gate1DataDepthWorkbenchItem, "workstream" | "frontend_action_kind" | "review_policy" | "automatic_fact_mutation_allowed" | "ranking_contexts">
): Gate1DataDepthWorkbenchItem {
  return {
    ...input,
    workstream: "propagation_context",
    frontend_action_kind: "review_intelligence_context",
    refs: uniqueSorted(input.refs).slice(0, 40),
    edge_ids: uniqueSorted(input.edge_ids).slice(0, 40),
    component_ids: uniqueSorted(input.component_ids).slice(0, 40),
    source_adapters: uniqueSorted(input.source_adapters).slice(0, 20),
    source_targets: input.source_targets.slice(0, 40),
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
