import type { SourceTargetCoverageItem } from "@supplystrata/source-monitor";
import type {
  Gate1DataDepthActionBatch,
  Gate1DataDepthActionBatchDefinition,
  Gate1DataDepthActionBatchKind,
  Gate1DataDepthCommandHint,
  Gate1DataDepthFrontendActionKind,
  Gate1DataDepthPriority,
  Gate1DataDepthReviewDecision,
  Gate1DataDepthReviewPolicy,
  Gate1DataDepthSourceTargetRef,
  Gate1DataDepthSummary,
  Gate1DataDepthWorkbench,
  Gate1DataDepthWorkbenchItem,
  Gate1DataDepthWorkstream
} from "./gate1-data-depth-workbench-definitions.js";
import type {
  OfficialDisclosureCorroborationQueueItem,
  OfficialDisclosureReadinessGap,
  OfficialDisclosureReadinessReport
} from "./official-disclosure-readiness.js";
import type { PropagationReadinessReport } from "./propagation-readiness.js";
import type { SourceTargetCoverageReport } from "./source-target-coverage.js";
import type { SupplyChainExpansionPlan } from "./supply-chain-expansion-plan.js";

export type {
  Gate1DataDepthActionBatch,
  Gate1DataDepthActionBatchDefinition,
  Gate1DataDepthActionBatchKind,
  Gate1DataDepthCommandHint,
  Gate1DataDepthFrontendActionKind,
  Gate1DataDepthPriority,
  Gate1DataDepthReviewDecision,
  Gate1DataDepthReviewPolicy,
  Gate1DataDepthSourceTargetRef,
  Gate1DataDepthSummary,
  Gate1DataDepthWorkbench,
  Gate1DataDepthWorkbenchItem,
  Gate1DataDepthWorkstream
} from "./gate1-data-depth-workbench-definitions.js";
export { renderGate1DataDepthWorkbenchMarkdown } from "./gate1-data-depth-workbench-render.js";

export interface Gate1DataDepthWorkbenchInput {
  generated_at: string;
  company_id: string;
  official_disclosure_readiness: OfficialDisclosureReadinessReport;
  source_target_coverage: SourceTargetCoverageReport;
  supply_chain_expansion_plan: SupplyChainExpansionPlan;
  propagation_readiness: PropagationReadinessReport;
}

const REVIEW_POLICY = "review_only_no_fact_mutation";

export const GATE1_DATA_DEPTH_ACTION_BATCHES = [
  {
    kind: "p0",
    file_name: "gate1-data-depth-p0.json",
    description: "Gate 1 data-depth P0 items that need review or operational action first",
    priorities: ["P0"]
  },
  {
    kind: "source_blockers",
    file_name: "gate1-data-depth-source-blockers.json",
    description: "Gate 1 source blockers grouped for credential, configuration, or source-health repair",
    workstreams: ["source_blocker"]
  },
  {
    kind: "labeling",
    file_name: "gate1-data-depth-labeling.json",
    description: "Gate 1 observation calibration labeling batch for gold-label growth",
    workstreams: ["observation_calibration"]
  },
  {
    kind: "corroboration",
    file_name: "gate1-data-depth-corroboration.json",
    description: "Gate 1 edge corroboration review items for counterparty official-source checking",
    workstreams: ["counterparty_corroboration"]
  },
  {
    kind: "intelligence_context",
    file_name: "gate1-data-depth-intelligence-context.json",
    description: "Gate 1 strength and propagation-context items that remain reasoning inputs only",
    workstreams: ["strength_context", "propagation_context"]
  }
] as const satisfies readonly Gate1DataDepthActionBatchDefinition[];

const WORKSTREAM_ORDER: Record<Gate1DataDepthWorkstream, number> = {
  fact_edge_growth: 0,
  source_blocker: 1,
  counterparty_corroboration: 2,
  observation_calibration: 3,
  propagation_context: 4,
  strength_context: 5
};

const PRIORITY_ORDER: Record<Gate1DataDepthPriority, number> = { P0: 0, P1: 1, P2: 2 };

export function buildGate1DataDepthWorkbench(input: Gate1DataDepthWorkbenchInput): Gate1DataDepthWorkbench {
  const items = [
    ...gapWorkItems(input.official_disclosure_readiness.gaps),
    ...sourceBlockerItems(input.source_target_coverage),
    ...corroborationWorkItems(input.official_disclosure_readiness.corroboration_queue),
    ...observationCalibrationItems(input.source_target_coverage),
    ...propagationWorkItems(input.propagation_readiness),
    ...frontierWorkItems(input.supply_chain_expansion_plan)
  ].sort(compareItems);
  return {
    schema_version: "1.0.0",
    generated_at: input.generated_at,
    company_id: input.company_id,
    summary: summarizeWorkbench(input, items),
    items
  };
}

export function buildGate1DataDepthActionBatch(workbench: Gate1DataDepthWorkbench, definition: Gate1DataDepthActionBatchDefinition): Gate1DataDepthActionBatch {
  const items = workbench.items.filter((item) => actionBatchIncludes(definition, item));
  return {
    schema_version: "1.0.0",
    generated_at: workbench.generated_at,
    company_id: workbench.company_id,
    batch_kind: definition.kind,
    review_policy: REVIEW_POLICY,
    automatic_fact_mutation_allowed: false,
    summary: {
      items: items.length,
      p0: items.filter((item) => item.priority === "P0").length,
      p1: items.filter((item) => item.priority === "P1").length,
      p2: items.filter((item) => item.priority === "P2").length,
      source_targets: items.reduce((count, item) => count + item.source_targets.length, 0),
      edge_refs: uniqueSorted(items.flatMap((item) => item.edge_ids)).length,
      component_refs: uniqueSorted(items.flatMap((item) => item.component_ids)).length,
      by_workstream: countByWorkstream(items),
      by_source_adapter: countBySourceAdapter(items)
    },
    items
  };
}

function gapWorkItems(gaps: readonly OfficialDisclosureReadinessGap[]): Gate1DataDepthWorkbenchItem[] {
  return gaps.map((gap) =>
    workItem({
      item_id: `gate1-gap:${gap.gap_id}`,
      workstream: workstreamForGap(gap.kind),
      priority: gap.priority,
      frontend_action_kind: actionKindForWorkstream(workstreamForGap(gap.kind)),
      title: gap.title,
      rationale: gap.rationale,
      recommended_action: gap.action,
      recommended_decision: decisionForGap(gap.kind),
      allowed_decisions: allowedDecisionsForGap(gap.kind),
      write_impact: writeImpactForGap(gap.kind),
      command_hints: commandHintsForGap(gap),
      refs: gapRefs(gap),
      edge_ids: gap.edge_ids,
      component_ids: gap.component_ids,
      source_adapters: gap.source_adapters,
      source_targets: gap.source_targets.map(toSourceTargetRef)
    })
  );
}

function sourceBlockerItems(report: SourceTargetCoverageReport): Gate1DataDepthWorkbenchItem[] {
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
      command_hints: sourceBlockerCommandHints(sourceAdapterId),
      refs: items.map((item) => `source_target:${item.matched_check_target_id ?? item.expected_target.check_target_id}`).sort(),
      edge_ids: [],
      component_ids: uniqueSorted(items.map((item) => targetConfigString(item, "component_id")).filter(nonEmpty)),
      source_adapters: [sourceAdapterId],
      source_targets: items.map(toCoverageSourceTargetRef)
    });
  });
}

function corroborationWorkItems(queue: readonly OfficialDisclosureCorroborationQueueItem[]): Gate1DataDepthWorkbenchItem[] {
  return queue.slice(0, 40).map((item) =>
    workItem({
      item_id: `gate1-corroboration:${item.edge_id}`,
      workstream: "counterparty_corroboration",
      priority: item.priority,
      frontend_action_kind: "review_counterparty_corroboration",
      title: `Corroborate edge ${item.from_name} -> ${item.to_name}`,
      rationale: item.reason,
      recommended_action: item.action,
      recommended_decision: "record_corroboration_disposition",
      allowed_decisions: ["record_corroboration_disposition", "keep_unknown_open", "defer"],
      write_impact: "May record review disposition or queue review work; must not mutate fact edges until approved evidence exists.",
      command_hints: corroborationCommandHints(),
      refs: uniqueSorted([
        `edge:${item.edge_id}`,
        ...item.source_plan_refs.map((ref) => prefixedRef("source_plan", ref)),
        ...item.unknown_ids.map((unknownId) => `unknown:${unknownId}`)
      ]),
      edge_ids: [item.edge_id],
      component_ids: item.component_id === null ? [] : [item.component_id],
      source_adapters: item.candidate_source_ids,
      source_targets: item.source_targets.map(toSourceTargetRef)
    })
  );
}

function observationCalibrationItems(report: SourceTargetCoverageReport): Gate1DataDepthWorkbenchItem[] {
  const plan = report.observation_review.labeling_plan;
  if (plan.candidates.length === 0) return [];
  return [
    workItem({
      item_id: "gate1-observation-calibration:next-labeling-batch",
      workstream: "observation_calibration",
      priority: plan.candidates.some((candidate) => candidate.priority === "P0") ? "P0" : "P1",
      frontend_action_kind: "label_observation_sample",
      title: "Label the next observation calibration batch",
      rationale:
        "Gate 1 needs a small gold-label sample so metric anomaly, signal usefulness, and source quality can be held stable during later algorithm changes.",
      recommended_action:
        "Review the stratified unlabeled batch and persist labels through the observation calibration label path. Labels calibrate algorithms; they do not create fact edges.",
      recommended_decision: "record_observation_label",
      allowed_decisions: ["record_observation_label", "defer"],
      write_impact: "Writes observation_calibration_labels only; does not modify observations, evidence, unknowns, or fact edges.",
      command_hints: observationCalibrationCommandHints(plan.candidates.map((candidate) => candidate.observation_id)),
      refs: plan.candidates.map((candidate) => `observation:${candidate.observation_id}`),
      edge_ids: [],
      component_ids: [],
      source_adapters: uniqueSorted(
        report.items
          .filter((item) => item.observation_samples.some((sample) => plan.candidates.some((candidate) => candidate.observation_id === sample.observation_id)))
          .map((item) => item.expected_target.source_adapter_id)
      ),
      source_targets: []
    })
  ];
}

function propagationWorkItems(report: PropagationReadinessReport): Gate1DataDepthWorkbenchItem[] {
  return report.items
    .filter((item) => item.status !== "ready")
    .map((item) =>
      workItem({
        item_id: `gate1-propagation:${item.context_kind}`,
        workstream: "propagation_context",
        priority: item.status === "blocked" ? "P1" : "P2",
        frontend_action_kind: "review_intelligence_context",
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

function frontierWorkItems(plan: SupplyChainExpansionPlan): Gate1DataDepthWorkbenchItem[] {
  if (plan.summary.blocked_frontier_edges === 0 && plan.summary.component_dependency_leads === 0) return [];
  return [
    workItem({
      item_id: "gate1-frontier:recursive-depth",
      workstream: "fact_edge_growth",
      priority: plan.summary.frontier_edges > 0 ? "P1" : "P2",
      frontend_action_kind: "run_frontier_research",
      title: "Advance recursive listed-company research frontier",
      rationale: `${plan.summary.frontier_edges} frontier edge(s) and ${plan.summary.component_dependency_leads} component lead(s) are available for the next evidence-first company loop.`,
      recommended_action:
        "Run the same official disclosure loop for ready frontier companies, then use review-approved evidence to grow L4/L5 edges. Component leads stay lead-only until official relationship evidence exists.",
      recommended_decision: "run_recursive_company_research",
      allowed_decisions: ["run_recursive_company_research", "defer"],
      write_impact:
        "Running research may refresh derived context and source targets when explicitly prepared; component leads remain non-fact until review-approved evidence exists.",
      command_hints: frontierCommandHints(plan),
      refs: uniqueSorted([
        ...plan.frontier.slice(0, 20).map((item) => `supply_chain_frontier:${item.frontier_id}`),
        ...plan.component_dependency_leads.slice(0, 20).map((lead) => `component_dependency:${lead.dependency_id}`)
      ]),
      edge_ids: plan.frontier.map((item) => item.edge_id),
      component_ids: uniqueSorted([
        ...plan.frontier.flatMap((item) => (item.component_id === null ? [] : [item.component_id])),
        ...plan.component_dependency_leads.map((lead) => lead.parent_component_id)
      ]),
      source_adapters: uniqueSorted(plan.component_dependency_leads.flatMap((lead) => lead.source_ids)),
      source_targets: []
    })
  ];
}

function summarizeWorkbench(input: Gate1DataDepthWorkbenchInput, items: readonly Gate1DataDepthWorkbenchItem[]): Gate1DataDepthSummary {
  const factEdgeTarget = input.official_disclosure_readiness.targets.level_4_5_fact_edges;
  const l4L5Edges = input.official_disclosure_readiness.summary.level_4_5_fact_edges;
  return {
    items: items.length,
    p0: items.filter((item) => item.priority === "P0").length,
    p1: items.filter((item) => item.priority === "P1").length,
    p2: items.filter((item) => item.priority === "P2").length,
    by_workstream: countByWorkstream(items),
    fact_edge_gap_to_target: Math.max(0, factEdgeTarget - l4L5Edges),
    fact_edge_target: factEdgeTarget,
    l4_l5_fact_edges: l4L5Edges,
    cross_source_edges: input.official_disclosure_readiness.summary.cross_source_edges,
    corroboration_or_disposition_edges: input.official_disclosure_readiness.summary.corroboration_or_disposition_edges,
    source_blockers: input.source_target_coverage.items.filter(isSourceBlocked).length,
    strength_missing_edges: input.official_disclosure_readiness.summary.edges_missing_strength,
    observation_labeling_batch: input.source_target_coverage.observation_review.labeling_plan.candidates.length,
    propagation_contexts_not_ready: input.propagation_readiness.summary.partial + input.propagation_readiness.summary.blocked
  };
}

function workItem(input: Omit<Gate1DataDepthWorkbenchItem, "review_policy" | "automatic_fact_mutation_allowed">): Gate1DataDepthWorkbenchItem {
  return {
    ...input,
    refs: uniqueSorted(input.refs).slice(0, 40),
    edge_ids: uniqueSorted(input.edge_ids).slice(0, 40),
    component_ids: uniqueSorted(input.component_ids).slice(0, 40),
    source_adapters: uniqueSorted(input.source_adapters).slice(0, 20),
    source_targets: input.source_targets.slice(0, 40),
    allowed_decisions: uniquePreserveOrder(input.allowed_decisions),
    command_hints: input.command_hints.slice(0, 8),
    review_policy: REVIEW_POLICY,
    automatic_fact_mutation_allowed: false
  };
}

function actionKindForWorkstream(workstream: Gate1DataDepthWorkstream): Gate1DataDepthFrontendActionKind {
  if (workstream === "source_blocker") return "repair_source_target";
  if (workstream === "observation_calibration") return "label_observation_sample";
  if (workstream === "counterparty_corroboration") return "review_counterparty_corroboration";
  if (workstream === "strength_context" || workstream === "propagation_context") return "review_intelligence_context";
  return "run_frontier_research";
}

function decisionForGap(kind: OfficialDisclosureReadinessGap["kind"]): Gate1DataDepthReviewDecision {
  if (kind === "expected_official_source_coverage" || kind === "traceability") return "sync_or_enable_source_target";
  if (kind === "corroboration_or_disposition_coverage") return "record_corroboration_disposition";
  if (kind === "edge_strength" || kind === "edge_freshness") return "keep_unknown_open";
  return "run_recursive_company_research";
}

function allowedDecisionsForGap(kind: OfficialDisclosureReadinessGap["kind"]): Gate1DataDepthReviewDecision[] {
  if (kind === "expected_official_source_coverage" || kind === "traceability") return ["sync_or_enable_source_target", "rerun_source_check", "defer"];
  if (kind === "corroboration_or_disposition_coverage") return ["record_corroboration_disposition", "keep_unknown_open", "defer"];
  if (kind === "edge_strength" || kind === "edge_freshness") return ["keep_unknown_open", "defer"];
  return ["run_recursive_company_research", "defer"];
}

function writeImpactForGap(kind: OfficialDisclosureReadinessGap["kind"]): string {
  if (kind === "expected_official_source_coverage" || kind === "traceability") {
    return "May update source_check_targets/jobs or review dispositions; must not create fact edges without review-approved evidence.";
  }
  if (kind === "corroboration_or_disposition_coverage") {
    return "May record a corroboration disposition or keep an unknown open; must not infer corroboration from silence.";
  }
  if (kind === "edge_strength" || kind === "edge_freshness") {
    return "No direct fact-layer write is recommended; missing strength/freshness remains explicit context until evidence supports it.";
  }
  return "May run another research/export loop; any new relation still requires review-approved evidence before it becomes a fact edge.";
}

function commandHintsForGap(gap: OfficialDisclosureReadinessGap): Gate1DataDepthCommandHint[] {
  if (gap.kind === "expected_official_source_coverage" || gap.kind === "traceability") return sourcePlanCommandHints(gap.source_adapters);
  if (gap.kind === "corroboration_or_disposition_coverage") return corroborationCommandHints();
  if (gap.kind === "core_node_coverage" || gap.kind === "level_4_5_edge_coverage") {
    return [
      commandHint(
        "Run next company research loop",
        "pnpm --silent cli research run --company <next-company-id> --depth 3 --prepare-data --out <research-pack-out>",
        true,
        true
      )
    ];
  }
  return [];
}

function sourcePlanCommandHints(sourceAdapters: readonly string[]): Gate1DataDepthCommandHint[] {
  const sourceFlag = sourceAdapters.length === 0 ? "" : ` --source ${uniqueSorted(sourceAdapters).join(",")}`;
  return [
    commandHint(
      "Preview source-plan targets",
      `pnpm --silent cli sources policy preview-plan-targets --source-plan <source-plan.json> --namespace <namespace>${sourceFlag}`,
      false,
      false
    ),
    commandHint(
      "Smoke source-plan targets",
      `pnpm --silent cli sources policy smoke-plan-targets --source-plan <source-plan.json> --namespace <namespace>${sourceFlag}`,
      false,
      false
    ),
    commandHint(
      "Sync source-plan targets",
      `pnpm --silent cli sources policy sync-plan-targets --source-plan <source-plan.json> --namespace <namespace>${sourceFlag}`,
      true,
      true
    )
  ];
}

function sourceBlockerCommandHints(sourceAdapterId: string): Gate1DataDepthCommandHint[] {
  return [
    commandHint("Inspect due targets", `pnpm --silent cli sources due --source ${sourceAdapterId}`, false, true),
    commandHint("Rerun due targets", `pnpm --silent cli sources run-due --source ${sourceAdapterId} --limit 10`, true, true),
    commandHint("Run one configured check", `pnpm --silent cli sources check --source ${sourceAdapterId} --config-file <target-config.json>`, true, true)
  ];
}

function observationCalibrationCommandHints(observationIds: readonly string[]): Gate1DataDepthCommandHint[] {
  const firstObservationId = observationIds[0] ?? "<observation-id>";
  return [
    commandHint(
      "Record observation label",
      `pnpm --silent cli intelligence observation-calibration-label ${firstObservationId} --label useful_signal --reviewer <reviewer> --rationale "<why this is a useful calibration sample>"`,
      true,
      true
    )
  ];
}

function corroborationCommandHints(): Gate1DataDepthCommandHint[] {
  return [
    commandHint(
      "Review corroboration batch",
      "Open gate1-data-depth-corroboration.json and record disposition only after source/evidence review.",
      false,
      false
    )
  ];
}

function frontierCommandHints(plan: SupplyChainExpansionPlan): Gate1DataDepthCommandHint[] {
  const nextCompanyId = plan.frontier.find((item) => item.next_company_id !== null)?.next_company_id ?? "<next-company-id>";
  return [
    commandHint(
      "Run recursive company research",
      `pnpm --silent cli research run --company ${nextCompanyId} --depth 3 --prepare-data --out <research-pack-out>`,
      true,
      true
    )
  ];
}

function commandHint(label: string, command: string, writesTruthStore: boolean, requiresDatabase: boolean): Gate1DataDepthCommandHint {
  return { label, command, writes_truth_store: writesTruthStore, requires_database: requiresDatabase };
}

function workstreamForGap(kind: OfficialDisclosureReadinessGap["kind"]): Gate1DataDepthWorkstream {
  if (kind === "level_4_5_edge_coverage" || kind === "core_node_coverage") return "fact_edge_growth";
  if (kind === "expected_official_source_coverage" || kind === "traceability") return "source_blocker";
  if (kind === "corroboration_or_disposition_coverage") return "counterparty_corroboration";
  if (kind === "edge_strength" || kind === "edge_freshness") return "strength_context";
  return "fact_edge_growth";
}

function gapRefs(gap: OfficialDisclosureReadinessGap): string[] {
  return uniqueSorted([
    `gate1_gap:${gap.gap_id}`,
    ...gap.edge_ids.map((edgeId) => `edge:${edgeId}`),
    ...gap.component_ids.map((componentId) => `component:${componentId}`),
    ...gap.source_plan_refs.map((ref) => prefixedRef("source_plan", ref))
  ]);
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

function toSourceTargetRef(target: {
  check_target_id: string | null;
  source_adapter_id: string;
  target_kind: string;
  state: string | null;
  latest_event_type: string | null;
  observations: number | null;
  target_entity_id: string | null;
  target_component_id: string | null;
}): Gate1DataDepthSourceTargetRef {
  return {
    check_target_id: target.check_target_id,
    source_adapter_id: target.source_adapter_id,
    target_kind: target.target_kind,
    state: target.state,
    latest_event_type: target.latest_event_type,
    failure_kind: null,
    observations: target.observations,
    target_entity_id: target.target_entity_id,
    target_component_id: target.target_component_id
  };
}

function targetConfigString(item: SourceTargetCoverageItem, key: string): string | null {
  const value = item.expected_target.target_config[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function countByWorkstream(items: readonly Gate1DataDepthWorkbenchItem[]): Record<Gate1DataDepthWorkstream, number> {
  const counts: Record<Gate1DataDepthWorkstream, number> = {
    fact_edge_growth: 0,
    counterparty_corroboration: 0,
    source_blocker: 0,
    strength_context: 0,
    observation_calibration: 0,
    propagation_context: 0
  };
  for (const item of items) counts[item.workstream] += 1;
  return counts;
}

function countBySourceAdapter(items: readonly Gate1DataDepthWorkbenchItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sourceAdapter of items.flatMap((item) => item.source_adapters)) counts[sourceAdapter] = (counts[sourceAdapter] ?? 0) + 1;
  const sorted: Record<string, number> = {};
  for (const [sourceAdapter, count] of Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))) sorted[sourceAdapter] = count;
  return sorted;
}

function actionBatchIncludes(definition: Gate1DataDepthActionBatchDefinition, item: Gate1DataDepthWorkbenchItem): boolean {
  const priorityMatches = definition.priorities === undefined || definition.priorities.includes(item.priority);
  const workstreamMatches = definition.workstreams === undefined || definition.workstreams.includes(item.workstream);
  return priorityMatches && workstreamMatches;
}

function compareItems(left: Gate1DataDepthWorkbenchItem, right: Gate1DataDepthWorkbenchItem): number {
  const priority = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
  if (priority !== 0) return priority;
  const workstream = WORKSTREAM_ORDER[left.workstream] - WORKSTREAM_ORDER[right.workstream];
  if (workstream !== 0) return workstream;
  return left.item_id.localeCompare(right.item_id);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function uniquePreserveOrder<TValue extends string>(values: readonly TValue[]): TValue[] {
  return [...new Set(values)];
}

function nonEmpty(value: string | null): value is string {
  return value !== null && value.length > 0;
}

function prefixedRef(prefix: string, value: string): string {
  return value.startsWith(`${prefix}:`) ? value : `${prefix}:${value}`;
}
