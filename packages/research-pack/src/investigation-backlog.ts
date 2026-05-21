import { createHash } from "node:crypto";
import type { ComponentCardModel } from "@supplystrata/render";
import type { SourcePlanCheckTargetSuggestion, SourcePlanItem } from "@supplystrata/source-plan";
import type { SourceTargetCoverageState } from "@supplystrata/source-monitor";
import type { WorkbenchModel, WorkbenchUnknownItem } from "@supplystrata/workbench-export";
import type { ObservationCoverageReport, ObservationSeriesReadiness } from "./observation-coverage.js";
import type { OfficialDisclosureCorroborationQueueItem, OfficialDisclosureReadinessReport } from "./official-disclosure-readiness.js";
import type { QuestionReadinessMatrix, QuestionReadinessStatus } from "./question-readiness.js";
import type { SourceTargetCoverageReport } from "./source-target-coverage.js";
import type {
  SourceTargetPreflightIssueKind,
  SourceTargetPreflightItem,
  SourceTargetPreflightReport,
  SourceTargetPreflightStatus
} from "./source-target-preflight.js";

export type InvestigationBacklogKind =
  | "readiness_gap"
  | "unknown_resolution"
  | "component_coverage"
  | "source_check"
  | "observation_series"
  | "official_disclosure_coverage"
  | "corroboration_review"
  | "profile_expansion";
export type InvestigationBacklogPriority = "P0" | "P1" | "P2" | "P3";

export interface InvestigationBacklogTarget {
  component_ids: string[];
  edge_ids: string[];
  unknown_ids: string[];
  source_ids: string[];
  question_ids: string[];
}

export interface InvestigationBacklogItem {
  backlog_id: string;
  kind: InvestigationBacklogKind;
  priority: InvestigationBacklogPriority;
  title: string;
  rationale: string;
  action: string;
  target: InvestigationBacklogTarget;
  supporting_refs: string[];
  runnable_check_targets: SourcePlanCheckTargetSuggestion[];
  source_target_coverage: InvestigationBacklogSourceTargetCoverage[];
}

export interface InvestigationBacklogSourceTargetCoverage {
  source_adapter_id: string;
  target_kind: string;
  check_target_id: string;
  state: SourceTargetCoverageState;
  synced: boolean;
  observations: number;
  latest_job_id: string | null;
  latest_job_status: string | null;
  latest_event_id: string | null;
  latest_event_type: string | null;
  preflight_status: SourceTargetPreflightStatus | null;
  preflight_issue_kind: SourceTargetPreflightIssueKind | null;
  preflight_error_message: string | null;
  preflight_missing_credential_env_keys: readonly string[];
  preflight_normalized_documents: number;
  preflight_degraded_documents: number;
}

export interface InvestigationBacklog {
  schema_version: "1.0.0";
  generated_at: string;
  company_id: string;
  summary: {
    open_items: number;
    p0: number;
    p1: number;
    p2: number;
    p3: number;
    runnable_check_targets: number;
    source_target_coverage_items: number;
    corroboration_reviews: number;
    corroboration_review_runnable_targets: number;
    corroboration_review_with_source_target_coverage: number;
    corroboration_review_explicit_disposition_only: number;
    corroboration_review_need_sync: number;
    corroboration_review_need_enable: number;
    corroboration_review_due: number;
    corroboration_review_failed_preflight: number;
    corroboration_review_missing_credentials: number;
    corroboration_review_invalid_config: number;
    corroboration_review_unsupported_connector: number;
    corroboration_review_source_unreachable: number;
  };
  items: InvestigationBacklogItem[];
}

export interface InvestigationBacklogInput {
  generated_at: string;
  company_id: string;
  workbench: WorkbenchModel;
  components: readonly ComponentCardModel[];
  source_plan: readonly SourcePlanItem[];
  question_readiness: QuestionReadinessMatrix;
  observation_coverage?: ObservationCoverageReport;
  official_disclosure_readiness?: OfficialDisclosureReadinessReport;
  source_target_coverage?: SourceTargetCoverageReport;
  source_target_preflight?: SourceTargetPreflightReport;
}

interface BacklogDraft {
  kind: InvestigationBacklogKind;
  priority: InvestigationBacklogPriority;
  title: string;
  rationale: string;
  action: string;
  target: InvestigationBacklogTarget;
  supporting_refs: string[];
  runnable_check_targets: SourcePlanCheckTargetSuggestion[];
  source_target_coverage: InvestigationBacklogSourceTargetCoverage[];
}

export function buildInvestigationBacklog(input: InvestigationBacklogInput): InvestigationBacklog {
  const items = [
    ...readinessGapDrafts(input),
    ...unknownResolutionDrafts(input),
    ...componentCoverageDrafts(input),
    ...officialDisclosureCoverageDrafts(input),
    ...corroborationReviewDrafts(input),
    ...profileExpansionDrafts(input),
    ...observationSeriesDrafts(input),
    ...sourceCheckDrafts(input)
  ]
    .map(finalizeDraft)
    .sort(compareBacklogItems);
  const corroborationReviewSummary = summarizeCorroborationReviews(items);

  return {
    schema_version: "1.0.0",
    generated_at: input.generated_at,
    company_id: input.company_id,
    summary: {
      open_items: items.length,
      p0: countPriority(items, "P0"),
      p1: countPriority(items, "P1"),
      p2: countPriority(items, "P2"),
      p3: countPriority(items, "P3"),
      runnable_check_targets: items.reduce((count, item) => count + item.runnable_check_targets.length, 0),
      source_target_coverage_items: items.reduce((count, item) => count + item.source_target_coverage.length, 0),
      ...corroborationReviewSummary
    },
    items
  };
}

export function renderInvestigationBacklogMarkdown(backlog: InvestigationBacklog): string {
  const lines = [
    `# Investigation Backlog ${backlog.company_id}`,
    "",
    `Generated at: ${backlog.generated_at}`,
    `Open: ${backlog.summary.open_items}; P0: ${backlog.summary.p0}; P1: ${backlog.summary.p1}; P2: ${backlog.summary.p2}; P3: ${backlog.summary.p3}`,
    `Runnable check targets: ${backlog.summary.runnable_check_targets}`,
    `Corroboration reviews: ${backlog.summary.corroboration_reviews}; runnable targets ${backlog.summary.corroboration_review_runnable_targets}; coverage ${backlog.summary.corroboration_review_with_source_target_coverage}; disposition-only ${backlog.summary.corroboration_review_explicit_disposition_only}; need sync ${backlog.summary.corroboration_review_need_sync}; need enable ${backlog.summary.corroboration_review_need_enable}; due ${backlog.summary.corroboration_review_due}; failed preflight ${backlog.summary.corroboration_review_failed_preflight}; missing credentials ${backlog.summary.corroboration_review_missing_credentials}; invalid config ${backlog.summary.corroboration_review_invalid_config}; unsupported connector ${backlog.summary.corroboration_review_unsupported_connector}; source unreachable ${backlog.summary.corroboration_review_source_unreachable}`,
    "",
    "## Items",
    ""
  ];
  for (const item of backlog.items) {
    lines.push(`- ${item.priority} ${item.kind}: ${item.title}`);
    lines.push(`  Action: ${item.action}`);
    lines.push(`  Why: ${item.rationale}`);
    lines.push(`  Targets: ${targetSummary(item.target)}`);
    if (item.supporting_refs.length > 0) lines.push(`  Refs: ${item.supporting_refs.join(", ")}`);
    if (item.runnable_check_targets.length > 0) {
      lines.push(`  Runnable checks: ${item.runnable_check_targets.map((target) => `${target.source_adapter_id}/${target.target_kind}`).join(", ")}`);
    }
    if (item.source_target_coverage.length > 0) {
      lines.push(
        `  Coverage: ${item.source_target_coverage
          .map((coverage) => `${coverage.source_adapter_id}/${coverage.target_kind}=${coverageLine(coverage)}`)
          .join("; ")}`
      );
    }
  }
  return lines.join("\n");
}

function coverageLine(coverage: InvestigationBacklogSourceTargetCoverage): string {
  const missingCredentials =
    coverage.preflight_missing_credential_env_keys.length === 0 ? "" : `, missing_credentials=${coverage.preflight_missing_credential_env_keys.join("+")}`;
  const preflight =
    coverage.preflight_status === null
      ? ""
      : `, preflight=${coverage.preflight_status}${coverage.preflight_issue_kind === null ? "" : `/${coverage.preflight_issue_kind}`}${missingCredentials}, normalized=${coverage.preflight_normalized_documents}, degraded=${coverage.preflight_degraded_documents}`;
  return `${coverage.state}, observations=${coverage.observations}${preflight}`;
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

function finalizeDraft(draft: BacklogDraft): InvestigationBacklogItem {
  const stableKey = [
    draft.kind,
    draft.title,
    draft.target.component_ids.join("|"),
    draft.target.edge_ids.join("|"),
    draft.target.unknown_ids.join("|"),
    draft.target.source_ids.join("|"),
    draft.target.question_ids.join("|")
  ].join(":");
  return {
    backlog_id: `IB-${hash(stableKey).slice(0, 20).toUpperCase()}`,
    kind: draft.kind,
    priority: draft.priority,
    title: draft.title,
    rationale: draft.rationale,
    action: coverageAwareAction(draft.action, draft.source_target_coverage),
    target: {
      component_ids: uniqueSorted(draft.target.component_ids),
      edge_ids: uniqueSorted(draft.target.edge_ids),
      unknown_ids: uniqueSorted(draft.target.unknown_ids),
      source_ids: uniqueSorted(draft.target.source_ids),
      question_ids: uniqueSorted(draft.target.question_ids)
    },
    supporting_refs: uniqueSorted([...draft.supporting_refs, ...coverageSupportingRefs(draft.source_target_coverage)]).slice(0, 20),
    runnable_check_targets: dedupeRunnableTargets(draft.runnable_check_targets),
    source_target_coverage: dedupeCoverageRefs(draft.source_target_coverage)
  };
}

function summarizeCorroborationReviews(
  items: readonly InvestigationBacklogItem[]
): Pick<
  InvestigationBacklog["summary"],
  | "corroboration_reviews"
  | "corroboration_review_runnable_targets"
  | "corroboration_review_with_source_target_coverage"
  | "corroboration_review_explicit_disposition_only"
  | "corroboration_review_need_sync"
  | "corroboration_review_need_enable"
  | "corroboration_review_due"
  | "corroboration_review_failed_preflight"
  | "corroboration_review_missing_credentials"
  | "corroboration_review_invalid_config"
  | "corroboration_review_unsupported_connector"
  | "corroboration_review_source_unreachable"
> {
  const reviews = items.filter((item) => item.kind === "corroboration_review");
  return {
    corroboration_reviews: reviews.length,
    corroboration_review_runnable_targets: reviews.reduce((count, item) => count + item.runnable_check_targets.length, 0),
    corroboration_review_with_source_target_coverage: reviews.filter((item) => item.source_target_coverage.length > 0).length,
    corroboration_review_explicit_disposition_only: reviews.filter((item) => item.runnable_check_targets.length === 0).length,
    corroboration_review_need_sync: reviews.filter((item) => coverageHasState(item.source_target_coverage, "not_synced")).length,
    corroboration_review_need_enable: reviews.filter((item) => coverageHasState(item.source_target_coverage, "disabled")).length,
    corroboration_review_due: reviews.filter((item) => coverageHasState(item.source_target_coverage, "due")).length,
    corroboration_review_failed_preflight: reviews.filter((item) => item.source_target_coverage.some((coverage) => coverage.preflight_status === "failed"))
      .length,
    corroboration_review_missing_credentials: reviews.filter((item) => coverageHasIssueKind(item.source_target_coverage, "missing_credentials")).length,
    corroboration_review_invalid_config: reviews.filter((item) => coverageHasIssueKind(item.source_target_coverage, "target_config_invalid")).length,
    corroboration_review_unsupported_connector: reviews.filter((item) => coverageHasIssueKind(item.source_target_coverage, "connector_unsupported")).length,
    corroboration_review_source_unreachable: reviews.filter((item) =>
      item.source_target_coverage.some(
        (coverage) => coverage.preflight_issue_kind === "source_unreachable" || coverage.preflight_issue_kind === "source_response_error"
      )
    ).length
  };
}

function coverageHasState(coverage: readonly InvestigationBacklogSourceTargetCoverage[], state: SourceTargetCoverageState): boolean {
  return coverage.some((item) => item.state === state);
}

function coverageHasIssueKind(coverage: readonly InvestigationBacklogSourceTargetCoverage[], issueKind: SourceTargetPreflightIssueKind): boolean {
  return coverage.some((item) => item.preflight_issue_kind === issueKind);
}

function priorityForReadiness(status: QuestionReadinessStatus, questionId: string): InvestigationBacklogPriority {
  if (status === "blocked") return "P0";
  if (questionId === "relationship.strength_freshness" || questionId === "component.known_providers") return "P1";
  if (questionId === "graph.component_risk") return "P1";
  return "P2";
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

function actionForQuestion(questionId: string): string {
  if (questionId === "relationship.strength_freshness")
    return "Find explicit share, dependency, capacity, or qualitative evidence; otherwise keep the edge strength unknown open.";
  if (questionId === "component.known_providers")
    return "Prioritize official disclosures that can create Level 4/5 component provider fact candidates through review.";
  if (questionId === "graph.component_risk") return "Add or verify component provider fact edges before expecting a component risk baseline.";
  if (questionId === "investigation.next_sources") return "Provide configured periods or targets so source-plan suggestions become runnable.";
  return "Collect the missing supporting data listed by the readiness matrix without changing fact edges directly.";
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

function runnableTargetsForRefs(sourcePlan: readonly SourcePlanItem[], refs: readonly string[]): SourcePlanCheckTargetSuggestion[] {
  return runnableTargetsForSources(sourcePlan, sourceIdsFromRefs(refs));
}

function runnableTargetsForSources(sourcePlan: readonly SourcePlanItem[], sourceIds: readonly string[]): SourcePlanCheckTargetSuggestion[] {
  const sourceIdSet = new Set(sourceIds);
  return sourcePlan.flatMap((item) => (sourceIdSet.has(item.source_id) ? item.suggested_check_targets.filter((target) => target.runnable) : []));
}

function runnableTargetsByKey(sourcePlan: readonly SourcePlanItem[]): ReadonlyMap<string, SourcePlanCheckTargetSuggestion> {
  const byKey = new Map<string, SourcePlanCheckTargetSuggestion>();
  for (const item of sourcePlan) {
    for (const target of item.suggested_check_targets) {
      if (target.runnable) byKey.set(runnableTargetKey(target), target);
    }
  }
  return byKey;
}

function runnableTargetsForCorroborationQueueItem(
  queueItem: OfficialDisclosureCorroborationQueueItem,
  sourcePlanTargetsByKey: ReadonlyMap<string, SourcePlanCheckTargetSuggestion>
): SourcePlanCheckTargetSuggestion[] {
  const targets = queueItem.source_targets.flatMap((target) => {
    const runnableTarget = sourcePlanTargetsByKey.get(target.target_key);
    return runnableTarget === undefined ? [] : [runnableTarget];
  });
  return dedupeRunnableTargets(targets);
}

function sourceIdsForUnknown(sourcePlan: readonly SourcePlanItem[], unknown: WorkbenchUnknownItem): string[] {
  const sourceIds = new Set<string>();
  const haystack = [...unknown.blocking_data_sources, ...unknown.proxies, unknown.question, unknown.why_unknown].join(" ").toLowerCase();
  for (const item of sourcePlan) {
    if (haystack.includes(item.source_id.toLowerCase()) || haystack.includes(item.source_name.toLowerCase())) sourceIds.add(item.source_id);
  }
  return [...sourceIds].sort();
}

function dedupeRunnableTargets(targets: readonly SourcePlanCheckTargetSuggestion[]): SourcePlanCheckTargetSuggestion[] {
  const byKey = new Map<string, SourcePlanCheckTargetSuggestion>();
  for (const target of targets) byKey.set(`${target.source_adapter_id}:${target.target_kind}:${JSON.stringify(target.target_config)}`, target);
  return [...byKey.values()].sort(
    (left, right) => left.source_adapter_id.localeCompare(right.source_adapter_id) || left.target_kind.localeCompare(right.target_kind)
  );
}

function coverageByRunnableTarget(input: InvestigationBacklogInput): Map<string, InvestigationBacklogSourceTargetCoverage> {
  const coverageByTarget = new Map<string, InvestigationBacklogSourceTargetCoverage>();
  const preflightByCheckTargetId = sourceTargetPreflightByCheckTargetId(input.source_target_preflight);
  for (const item of input.source_target_coverage?.items ?? []) {
    const checkTargetId = item.matched_check_target_id ?? item.expected_target.check_target_id;
    const preflight = preflightByCheckTargetId.get(checkTargetId) ?? preflightByCheckTargetId.get(item.expected_target.check_target_id);
    coverageByTarget.set(runnableTargetKey(item.expected_target), {
      source_adapter_id: item.expected_target.source_adapter_id,
      target_kind: item.expected_target.target_kind,
      check_target_id: checkTargetId,
      state: item.state,
      synced: item.synced,
      observations: item.observations,
      latest_job_id: item.latest_job?.job_id ?? null,
      latest_job_status: item.latest_job?.status ?? null,
      latest_event_id: item.latest_event?.event_id ?? null,
      latest_event_type: item.latest_event?.event_type ?? null,
      ...preflightFields(preflight)
    });
  }
  return coverageByTarget;
}

function sourceTargetPreflightByCheckTargetId(report: SourceTargetPreflightReport | undefined): Map<string, SourceTargetPreflightItem> {
  const byCheckTargetId = new Map<string, SourceTargetPreflightItem>();
  for (const item of report?.items ?? []) byCheckTargetId.set(item.check_target_id, item);
  return byCheckTargetId;
}

function preflightFields(
  item: SourceTargetPreflightItem | undefined
): Pick<
  InvestigationBacklogSourceTargetCoverage,
  | "preflight_status"
  | "preflight_issue_kind"
  | "preflight_error_message"
  | "preflight_missing_credential_env_keys"
  | "preflight_normalized_documents"
  | "preflight_degraded_documents"
> {
  if (item === undefined) {
    return {
      preflight_status: null,
      preflight_issue_kind: null,
      preflight_error_message: null,
      preflight_missing_credential_env_keys: [],
      preflight_normalized_documents: 0,
      preflight_degraded_documents: 0
    };
  }
  return {
    preflight_status: item.status,
    preflight_issue_kind: item.issue_kind ?? null,
    preflight_error_message: item.error_message ?? null,
    preflight_missing_credential_env_keys: (item.missing_credentials ?? []).map((credential) => credential.env_key).sort(),
    preflight_normalized_documents: item.normalized_documents,
    preflight_degraded_documents: item.degraded_documents
  };
}

function coverageForTargets(
  coverageByTarget: ReadonlyMap<string, InvestigationBacklogSourceTargetCoverage>,
  targets: readonly SourcePlanCheckTargetSuggestion[]
): InvestigationBacklogSourceTargetCoverage[] {
  const coverage: InvestigationBacklogSourceTargetCoverage[] = [];
  for (const target of targets) {
    const item = coverageByTarget.get(runnableTargetKey(target));
    if (item !== undefined) coverage.push(item);
  }
  return dedupeCoverageRefs(coverage);
}

function coverageAwareAction(action: string, coverage: readonly InvestigationBacklogSourceTargetCoverage[]): string {
  if (coverage.length === 0) return action;
  const prefix = coverageActionPrefix(coverage);
  return `${prefix} ${action}`;
}

function coverageActionPrefix(coverage: readonly InvestigationBacklogSourceTargetCoverage[]): string {
  if (coverage.some((item) => item.state === "dead")) return "Investigate dead source-check jobs before expecting new evidence.";
  if (coverage.some((item) => item.state === "retry_wait"))
    return "Inspect failed source-check attempts and wait for configured retry or rerun after fixing the source issue.";
  if (coverage.some((item) => item.state === "degraded")) return "Inspect degraded source fetches before treating the latest check as usable evidence.";
  if (coverage.some((item) => item.preflight_issue_kind === "missing_credentials")) {
    const keys = uniqueSorted(coverage.flatMap((item) => item.preflight_missing_credential_env_keys));
    const suffix = keys.length === 0 ? "" : ` (${keys.join(", ")})`;
    return `Configure required source credentials${suffix} before syncing or enabling this source-plan target.`;
  }
  if (coverage.some((item) => item.preflight_issue_kind === "target_config_invalid"))
    return "Fix the source-plan target configuration before syncing or enabling this target.";
  if (coverage.some((item) => item.preflight_issue_kind === "connector_unsupported"))
    return "Register or implement the required source-check connector before syncing this target.";
  if (coverage.some((item) => item.preflight_issue_kind === "source_unreachable" || item.preflight_issue_kind === "source_response_error"))
    return "Verify source reachability and response format before treating this target as monitor-ready.";
  if (coverage.some((item) => item.preflight_status === "failed"))
    return "Fix source-plan preflight failures (credentials, target config, or source reachability) before syncing or enabling this target.";
  if (coverage.some((item) => item.preflight_status === "skipped"))
    return "Resolve unsupported source-plan preflight target or connector registration before syncing.";
  if (coverage.some((item) => item.preflight_degraded_documents > 0))
    return "Inspect degraded preflight fetches before treating the latest source path as healthy.";
  if (coverage.some((item) => item.state === "disabled")) return "Enable the synced source-check targets when the monitoring cadence is approved.";
  if (coverage.some((item) => item.state === "not_synced")) return "Sync runnable source-plan targets into source_check_targets first.";
  if (coverage.some((item) => item.state === "due")) return "Run due source-check targets through sources run-due or the worker.";
  if (coverage.some((item) => item.state === "active_job")) return "Wait for active source-check jobs to complete before changing conclusions.";
  if (coverage.some((item) => item.observations > 0)) return "Review produced observations and keep any fact-edge promotion behind review.";
  return "Inspect the latest source-check result; if it produced no useful observation, refine the target configuration.";
}

function coverageSupportingRefs(coverage: readonly InvestigationBacklogSourceTargetCoverage[]): string[] {
  return coverage.flatMap((item) => [
    `source_target:${item.check_target_id}`,
    ...(item.preflight_status === null ? [] : [`source_preflight:${item.check_target_id}`]),
    ...(item.latest_job_id === null ? [] : [`source_job:${item.latest_job_id}`]),
    ...(item.latest_event_id === null ? [] : [`source_event:${item.latest_event_id}`])
  ]);
}

function dedupeCoverageRefs(coverage: readonly InvestigationBacklogSourceTargetCoverage[]): InvestigationBacklogSourceTargetCoverage[] {
  const byTarget = new Map<string, InvestigationBacklogSourceTargetCoverage>();
  for (const item of coverage) byTarget.set(item.check_target_id, item);
  return [...byTarget.values()].sort(
    (left, right) => left.source_adapter_id.localeCompare(right.source_adapter_id) || left.target_kind.localeCompare(right.target_kind)
  );
}

function runnableTargetKey(target: { source_adapter_id: string; target_kind: string; target_config: Record<string, unknown> }): string {
  return `${target.source_adapter_id}:${target.target_kind}:${stableConfigKey(target.target_config)}`;
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

function targetSummary(target: InvestigationBacklogTarget): string {
  const parts = [
    summaryPart("components", target.component_ids),
    summaryPart("edges", target.edge_ids),
    summaryPart("unknowns", target.unknown_ids),
    summaryPart("sources", target.source_ids),
    summaryPart("questions", target.question_ids)
  ].filter((part) => part.length > 0);
  return parts.length === 0 ? "(none)" : parts.join("; ");
}

function summaryPart(label: string, values: readonly string[]): string {
  if (values.length === 0) return "";
  return `${label}=${values.join(",")}`;
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

function compareBacklogItems(left: InvestigationBacklogItem, right: InvestigationBacklogItem): number {
  return priorityRank(left.priority) - priorityRank(right.priority) || left.kind.localeCompare(right.kind) || left.backlog_id.localeCompare(right.backlog_id);
}

function priorityRank(priority: InvestigationBacklogPriority): number {
  if (priority === "P0") return 0;
  if (priority === "P1") return 1;
  if (priority === "P2") return 2;
  return 3;
}

function countPriority(items: readonly InvestigationBacklogItem[], priority: InvestigationBacklogPriority): number {
  return items.filter((item) => item.priority === priority).length;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
