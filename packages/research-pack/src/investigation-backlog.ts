import { createHash } from "node:crypto";
import type { SourceTargetCoverageState } from "@supplystrata/source-monitor";
import type {
  BacklogDraft,
  InvestigationBacklog,
  InvestigationBacklogInput,
  InvestigationBacklogItem,
  InvestigationBacklogPriority,
  InvestigationBacklogSourceTargetCoverage
} from "./investigation-backlog-definitions.js";
import { backlogDrafts } from "./investigation-backlog-drafts.js";
import { coverageAwareAction, coverageSupportingRefs, dedupeCoverageRefs, dedupeRunnableTargets } from "./investigation-backlog-source-targets.js";
import type { SourceTargetPreflightIssueKind } from "./source-target-preflight.js";

export type {
  InvestigationBacklog,
  InvestigationBacklogInput,
  InvestigationBacklogItem,
  InvestigationBacklogKind,
  InvestigationBacklogPriority,
  InvestigationBacklogSourceTargetCoverage,
  InvestigationBacklogTarget
} from "./investigation-backlog-definitions.js";
export { renderInvestigationBacklogMarkdown } from "./investigation-backlog-render.js";

export function buildInvestigationBacklog(input: InvestigationBacklogInput): InvestigationBacklog {
  const items = backlogDrafts(input).map(finalizeDraft).sort(compareBacklogItems);
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
