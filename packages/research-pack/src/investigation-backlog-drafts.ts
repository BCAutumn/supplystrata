import type { SourcePlanItem } from "@supplystrata/source-plan";
import type { WorkbenchUnknownItem } from "@supplystrata/workbench-export";
import type { ObservationSeriesReadiness } from "./observation-coverage.js";
import type { QuestionReadinessStatus } from "./question-readiness.js";
import type { BacklogDraft, InvestigationBacklogInput, InvestigationBacklogPriority } from "./investigation-backlog-definitions.js";
import {
  coverageByRunnableTarget,
  coverageForTargets,
  runnableTargetsByKey,
  runnableTargetsForCorroborationQueueItem,
  runnableTargetsForRefs,
  runnableTargetsForSources,
  sourceIdsForUnknown
} from "./investigation-backlog-source-targets.js";

const QUESTION_READINESS_PRIORITY: Readonly<Record<string, InvestigationBacklogPriority>> = {
  "relationship.strength_freshness": "P1",
  "component.known_providers": "P1",
  "graph.component_risk": "P1"
};

const QUESTION_READINESS_ACTION: Readonly<Record<string, string>> = {
  "relationship.strength_freshness": "Find explicit share, dependency, capacity, or qualitative evidence; otherwise keep the edge strength unknown open.",
  "component.known_providers": "Prioritize official disclosures that can create Level 4/5 component provider fact candidates through review.",
  "graph.component_risk": "Add or verify component provider fact edges before expecting a component risk baseline.",
  "investigation.next_sources": "Provide configured periods or targets so source-plan suggestions become runnable."
};

export function backlogDrafts(input: InvestigationBacklogInput): BacklogDraft[] {
  return [
    ...readinessGapDrafts(input),
    ...unknownResolutionDrafts(input),
    ...componentCoverageDrafts(input),
    ...officialDisclosureCoverageDrafts(input),
    ...corroborationReviewDrafts(input),
    ...profileExpansionDrafts(input),
    ...supplyChainExpansionDrafts(input),
    ...propagationReadinessDrafts(input),
    ...observationSeriesDrafts(input),
    ...sourceCheckDrafts(input)
  ];
}

function readinessGapDrafts(input: InvestigationBacklogInput): BacklogDraft[] {
  const coverageByTarget = coverageByRunnableTarget(input);
  return input.question_readiness.items
    .filter((item) => item.status !== "ready")
    .map((item) => {
      const runnableCheckTargets = runnableTargetsForRefs(input.source_plan, item.supporting_refs);
      return {
        kind: "readiness_gap",
        priority: priorityForReadiness(item.status, item.question_id),
        title: `Close ${item.question_id} readiness gap`,
        rationale: item.missing_requirements.join("; "),
        action: actionForQuestion(item.question_id),
        target: {
          component_ids: componentIdsFromRefs(item.supporting_refs),
          edge_ids: edgeIdsFromRefs(item.supporting_refs),
          unknown_ids: item.unknown_ids,
          source_ids: sourceIdsFromRefs(item.supporting_refs),
          question_ids: [item.question_id]
        },
        supporting_refs: item.supporting_refs,
        runnable_check_targets: runnableCheckTargets,
        source_target_coverage: coverageForTargets(coverageByTarget, runnableCheckTargets)
      };
    });
}

function unknownResolutionDrafts(input: InvestigationBacklogInput): BacklogDraft[] {
  const coverageByTarget = coverageByRunnableTarget(input);
  return input.workbench.unknown_items
    .filter((unknown) => unknown.status !== "resolved")
    .map((unknown) => {
      const sourceIds = sourceIdsForUnknown(input.source_plan, unknown);
      const runnableCheckTargets = runnableTargetsForSources(input.source_plan, sourceIds);
      return {
        kind: "unknown_resolution",
        priority: priorityForUnknown(unknown),
        title: `Resolve unknown ${unknown.unknown_id}`,
        rationale: unknown.why_unknown,
        action: unknownAction(unknown),
        target: {
          component_ids: componentIdsFromText(unknown.question),
          edge_ids: edgeIdsFromText(unknown.question),
          unknown_ids: [unknown.unknown_id],
          source_ids: sourceIds,
          question_ids: []
        },
        supporting_refs: [`unknown:${unknown.unknown_id}`],
        runnable_check_targets: runnableCheckTargets,
        source_target_coverage: coverageForTargets(coverageByTarget, runnableCheckTargets)
      };
    });
}

function componentCoverageDrafts(input: InvestigationBacklogInput): BacklogDraft[] {
  const coverageByTarget = coverageByRunnableTarget(input);
  return input.components
    .filter((component) => component.known_suppliers.length === 0 && component.known_consumers.length === 0)
    .map((component) => {
      const componentId = component.component.component_id;
      const planItems = input.source_plan.filter((item) => item.parent_component_ids.includes(componentId) || item.target_ids.includes(componentId));
      const runnableCheckTargets = planItems.flatMap((item) => item.suggested_check_targets.filter((target) => target.runnable));
      return {
        kind: "component_coverage",
        priority: "P1",
        title: `Find provider coverage for ${componentId}`,
        rationale: "ComponentCard has no known supplier or consumer fact edge yet.",
        action: "Review official disclosure and registered component source-plan items before creating any fact candidate.",
        target: {
          component_ids: [componentId],
          edge_ids: [],
          unknown_ids: component.unknown_map.map((item) => item.unknown_id),
          source_ids: uniqueSorted(planItems.map((item) => item.source_id)),
          question_ids: ["component.known_providers", "graph.component_risk"]
        },
        supporting_refs: [`component:${componentId}`, ...planItems.slice(0, 10).map((item) => `source_plan:${item.source_id}`)],
        runnable_check_targets: runnableCheckTargets,
        source_target_coverage: coverageForTargets(coverageByTarget, runnableCheckTargets)
      };
    });
}

function officialDisclosureCoverageDrafts(input: InvestigationBacklogInput): BacklogDraft[] {
  if (input.official_disclosure_readiness === undefined) return [];
  return input.official_disclosure_readiness.gaps.map((gap) => ({
    kind: "official_disclosure_coverage",
    priority: gap.priority,
    title: gap.title,
    rationale: gap.rationale,
    action: gap.action,
    target: {
      component_ids: gap.component_ids,
      edge_ids: gap.edge_ids,
      unknown_ids: [],
      source_ids: gap.source_adapters,
      question_ids: ["official_disclosure.readiness"]
    },
    supporting_refs: [
      `official_disclosure_gap:${gap.gap_id}`,
      ...gap.source_plan_refs,
      ...gap.source_targets.flatMap((target) => (target.check_target_id === null ? [] : [`source_target:${target.check_target_id}`])),
      ...gap.edge_ids.slice(0, 20).map((edgeId) => `edge:${edgeId}`),
      ...gap.component_ids.slice(0, 20).map((componentId) => `component:${componentId}`)
    ],
    runnable_check_targets: [],
    source_target_coverage: []
  }));
}

function corroborationReviewDrafts(input: InvestigationBacklogInput): BacklogDraft[] {
  if (input.official_disclosure_readiness === undefined) return [];
  const coverageByTarget = coverageByRunnableTarget(input);
  const sourcePlanTargetsByKey = runnableTargetsByKey(input.source_plan);
  return input.official_disclosure_readiness.corroboration_queue.slice(0, 40).map((queueItem) => {
    const runnableCheckTargets = runnableTargetsForCorroborationQueueItem(queueItem, sourcePlanTargetsByKey);
    return {
      kind: "corroboration_review",
      priority: queueItem.priority,
      title: `Resolve corroboration for ${queueItem.edge_id}`,
      rationale: queueItem.reason,
      action: queueItem.action,
      target: {
        component_ids: queueItem.component_id === null ? [] : [queueItem.component_id],
        edge_ids: [queueItem.edge_id],
        unknown_ids: queueItem.unknown_ids,
        source_ids: uniqueSorted([
          ...queueItem.existing_source_adapters,
          ...queueItem.candidate_source_ids,
          ...queueItem.source_targets.map((target) => target.source_adapter_id)
        ]),
        question_ids: ["official_disclosure.corroboration"]
      },
      supporting_refs: [
        `corroboration_queue:${queueItem.edge_id}`,
        `edge:${queueItem.edge_id}`,
        ...queueItem.source_plan_refs,
        ...queueItem.source_targets.flatMap((target) => (target.check_target_id === null ? [] : [`source_target:${target.check_target_id}`])),
        ...queueItem.unknown_ids.map((unknownId) => `unknown:${unknownId}`)
      ],
      runnable_check_targets: runnableCheckTargets,
      source_target_coverage: coverageForTargets(coverageByTarget, runnableCheckTargets)
    };
  });
}

function profileExpansionDrafts(input: InvestigationBacklogInput): BacklogDraft[] {
  return (input.official_disclosure_readiness?.profile_expansion_candidates ?? []).slice(0, 20).map((candidate) => ({
    kind: "profile_expansion",
    priority: candidate.suggested_priority,
    title: `Review profile expansion candidate ${candidate.node_id}`,
    rationale: candidate.reason,
    action: "Review whether this discovered node belongs in the research target profile. Do not treat profile inclusion as a fact edge or evidence upgrade.",
    target: {
      component_ids: candidate.node_kind === "component" ? [candidate.node_id] : [],
      edge_ids: candidate.fact_edge_ids,
      unknown_ids: [],
      source_ids: candidate.source_adapters,
      question_ids: ["official_disclosure.profile_expansion"]
    },
    supporting_refs: [
      `profile_candidate:${candidate.node_id}`,
      ...candidate.source_plan_refs,
      ...candidate.fact_edge_ids.slice(0, 20).map((edgeId) => `edge:${edgeId}`)
    ],
    runnable_check_targets: [],
    source_target_coverage: []
  }));
}

function supplyChainExpansionDrafts(input: InvestigationBacklogInput): BacklogDraft[] {
  const plan = input.supply_chain_expansion_plan;
  if (plan === undefined) return [];
  const coverageByTarget = coverageByRunnableTarget(input);
  const frontierDrafts: BacklogDraft[] = plan.frontier
    .filter((item) => item.expansion_state !== "stop_depth_limit")
    .slice(0, 20)
    .map((item) => {
      const sourceIds = sourceIdsFromRefs(item.source_plan_refs);
      const runnableCheckTargets = runnableTargetsForSources(input.source_plan, sourceIds);
      return {
        kind: "supply_chain_expansion",
        priority: item.expansion_state === "needs_component_context" ? "P0" : "P1",
        title: `Expand supply-chain frontier ${item.edge_id}`,
        rationale: item.rationale,
        action: item.action,
        target: {
          component_ids: item.component_id === null ? [] : [item.component_id],
          edge_ids: [item.edge_id],
          unknown_ids: item.unknown_ids,
          source_ids: sourceIds,
          question_ids: ["supply_chain.recursive_expansion"]
        },
        supporting_refs: [`supply_chain_frontier:${item.frontier_id}`, `edge:${item.edge_id}`, ...item.source_plan_refs],
        runnable_check_targets: runnableCheckTargets,
        source_target_coverage: coverageForTargets(coverageByTarget, runnableCheckTargets)
      };
    });

  const leadDrafts: BacklogDraft[] = plan.component_dependency_leads
    .filter((lead) => lead.state !== "fact_covered")
    .slice(0, 30)
    .map((lead) => {
      const runnableCheckTargets = runnableTargetsForSources(input.source_plan, lead.source_ids);
      return {
        kind: "supply_chain_expansion",
        priority: lead.state === "lead_only" ? "P2" : "P1",
        title: `Review recursive component lead ${lead.parent_component_id} -> ${lead.target_id}`,
        rationale: lead.rationale,
        action: lead.action,
        target: {
          component_ids: uniqueSorted([lead.parent_component_id, lead.target_id]),
          edge_ids: lead.supporting_edge_ids,
          unknown_ids: [],
          source_ids: lead.source_ids,
          question_ids: ["supply_chain.component_frontier"]
        },
        supporting_refs: [
          `component_dependency:${lead.dependency_id}`,
          ...lead.source_plan_refs,
          ...lead.supporting_edge_ids.map((edgeId) => `edge:${edgeId}`)
        ],
        runnable_check_targets: runnableCheckTargets,
        source_target_coverage: coverageForTargets(coverageByTarget, runnableCheckTargets)
      };
    });

  return [...frontierDrafts, ...leadDrafts];
}

function propagationReadinessDrafts(input: InvestigationBacklogInput): BacklogDraft[] {
  const report = input.propagation_readiness;
  if (report === undefined) return [];
  const coverageByTarget = coverageByRunnableTarget(input);
  return report.items
    .filter((item) => item.status !== "ready")
    .map((item) => {
      const sourceIds = sourceIdsFromRefs(item.source_plan_refs);
      const runnableCheckTargets = runnableTargetsForSources(input.source_plan, sourceIds);
      return {
        kind: "propagation_readiness",
        priority: priorityForPropagationReadiness(item.status),
        title: `Collect propagation context for ${item.context_kind}`,
        rationale: item.missing_requirements.join("; "),
        action: item.action,
        target: {
          component_ids: item.component_ids,
          edge_ids: edgeIdsFromRefs(item.frontier_refs),
          unknown_ids: [],
          source_ids: sourceIds,
          question_ids: [`propagation.${item.context_kind}`]
        },
        supporting_refs: [item.context_id, ...item.observation_series_refs, ...item.source_plan_refs, ...item.component_dependency_refs, ...item.frontier_refs],
        runnable_check_targets: runnableCheckTargets,
        source_target_coverage: coverageForTargets(coverageByTarget, runnableCheckTargets)
      };
    });
}

function sourceCheckDrafts(input: InvestigationBacklogInput): BacklogDraft[] {
  const coverageByTarget = coverageByRunnableTarget(input);
  return input.source_plan
    .filter((item) => item.suggested_check_targets.length > 0 || item.expected_output_layer === "edge")
    .map((item) => {
      const runnableCheckTargets = item.suggested_check_targets.filter((target) => target.runnable);
      return {
        kind: "source_check",
        priority: priorityForSourcePlanItem(item),
        title: `Check ${item.source_id}`,
        rationale: item.reasons.slice(0, 3).join("; "),
        action:
          item.suggested_check_targets.length > 0
            ? "Run or enqueue the suggested source check target, then keep outputs in observation/lead/review paths according to relation policy."
            : "Review this source manually or add a configured check target before expecting automated coverage.",
        target: {
          component_ids: uniqueSorted([...item.parent_component_ids, ...item.target_ids].filter((id) => id.startsWith("COMP-"))),
          edge_ids: [],
          unknown_ids: [],
          source_ids: [item.source_id],
          question_ids: ["investigation.next_sources"]
        },
        supporting_refs: [`source_plan:${item.source_id}`],
        runnable_check_targets: runnableCheckTargets,
        source_target_coverage: coverageForTargets(coverageByTarget, runnableCheckTargets)
      };
    });
}

function observationSeriesDrafts(input: InvestigationBacklogInput): BacklogDraft[] {
  return (input.observation_coverage?.series ?? [])
    .filter((series) => series.status === "sparse")
    .slice(0, 10)
    .map((series) => ({
      kind: "observation_series",
      priority: priorityForObservationSeries(series),
      title: `Make observation series analyzable: ${series.metric_name}`,
      rationale: series.reason,
      action: actionForObservationSeries(series),
      target: {
        component_ids: series.component_id === null ? [] : [series.component_id],
        edge_ids: [],
        unknown_ids: [],
        source_ids: series.source_adapters,
        question_ids: ["signals.observation_series"]
      },
      supporting_refs: [`observation_series:${series.series_key}`, ...series.sample_observation_ids.map((observationId) => `observation:${observationId}`)],
      runnable_check_targets: [],
      source_target_coverage: []
    }));
}

function priorityForReadiness(status: QuestionReadinessStatus, questionId: string): InvestigationBacklogPriority {
  if (status === "blocked") return "P0";
  return QUESTION_READINESS_PRIORITY[questionId] ?? "P2";
}

function priorityForUnknown(unknown: WorkbenchUnknownItem): InvestigationBacklogPriority {
  if (unknown.unknown_id.startsWith("UNK-EDGE-STRENGTH")) return "P1";
  if (unknown.blocking_data_sources.length > 0) return "P2";
  return "P3";
}

function priorityForSourcePlanItem(item: SourcePlanItem): InvestigationBacklogPriority {
  if (item.priority === "P0") return "P0";
  if (item.priority === "P1" || item.expected_output_layer === "edge") return "P1";
  if (item.priority === "P2") return "P2";
  return "P3";
}

function priorityForObservationSeries(series: ObservationSeriesReadiness): InvestigationBacklogPriority {
  if (series.observation_type === "FINANCIAL_METRIC_OBSERVATION" || series.observation_type === "TRADE_FLOW_OBSERVATION") return "P2";
  return "P3";
}

function priorityForPropagationReadiness(
  status: NonNullable<InvestigationBacklogInput["propagation_readiness"]>["items"][number]["status"]
): InvestigationBacklogPriority {
  if (status === "blocked") return "P0";
  return "P1";
}

function actionForQuestion(questionId: string): string {
  return QUESTION_READINESS_ACTION[questionId] ?? "Collect the missing supporting data listed by the readiness matrix without changing fact edges directly.";
}

function unknownAction(unknown: WorkbenchUnknownItem): string {
  if (unknown.unknown_id.startsWith("UNK-EDGE-STRENGTH"))
    return "Search public evidence for explicit relationship strength; do not infer share from equal supplier lists.";
  if (unknown.blocking_data_sources.length > 0) return `Check blocking sources: ${unknown.blocking_data_sources.join(", ")}.`;
  if (unknown.proxies.length > 0) return `Use proxy signals only as observations or leads: ${unknown.proxies.join(", ")}.`;
  return "Keep this unknown explicit until a source can resolve it.";
}

function actionForObservationSeries(series: ObservationSeriesReadiness): string {
  const windowGap = Math.max(0, 6 - series.windowed_points);
  const numericGap = Math.max(0, 6 - series.numeric_points);
  if (series.explicit_baseline_points === 0) {
    return `Collect ${Math.max(windowGap, numericGap)} more comparable numeric/windowed observations or find an official disclosure with explicit baseline/change fields for ${series.metric_name}. Keep the result in observations until reviewed.`;
  }
  return `Review existing explicit baseline observations for ${series.metric_name}, then rerun observation anomaly refresh before deriving alert candidates.`;
}

function componentIdsFromRefs(refs: readonly string[]): string[] {
  return refs.filter((ref) => ref.startsWith("component:")).map((ref) => ref.slice("component:".length));
}

function edgeIdsFromRefs(refs: readonly string[]): string[] {
  return refs.filter((ref) => ref.startsWith("edge:")).map((ref) => ref.slice("edge:".length));
}

function sourceIdsFromRefs(refs: readonly string[]): string[] {
  return refs.filter((ref) => ref.startsWith("source_plan:")).map((ref) => ref.slice("source_plan:".length));
}

function componentIdsFromText(value: string): string[] {
  return [...value.matchAll(/\bCOMP-[A-Z0-9-]+\b/g)].map((match) => match[0]);
}

function edgeIdsFromText(value: string): string[] {
  return [...value.matchAll(/\bEDGE-[A-Za-z0-9-]+\b/g)].map((match) => match[0]);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
