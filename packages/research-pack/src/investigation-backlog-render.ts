import type { InvestigationBacklog, InvestigationBacklogSourceTargetCoverage, InvestigationBacklogTarget } from "./investigation-backlog-definitions.js";

export function renderInvestigationBacklogMarkdown(backlog: InvestigationBacklog): string {
  const lines = [
    `# Investigation Backlog ${backlog.company_id}`,
    "",
    `Generated at: ${backlog.generated_at}`,
    `Open: ${backlog.summary.open_items}; P0: ${backlog.summary.p0}; P1: ${backlog.summary.p1}; P2: ${backlog.summary.p2}; P3: ${backlog.summary.p3}`,
    `Runnable check targets: ${backlog.summary.runnable_check_targets}`,
    `Propagation readiness items: ${backlog.summary.propagation_readiness_items}`,
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
