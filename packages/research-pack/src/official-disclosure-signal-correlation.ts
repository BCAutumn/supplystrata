import type { OfficialDisclosureCorroborationQueueItem, OfficialDisclosureSignalReviewSummary } from "./official-disclosure-readiness.js";

export interface OfficialDisclosureSignalCorrelationHint {
  review_id: string;
  edge_id: string;
  status: string;
  source_adapter_id: string;
  signal_title: string;
  edge_summary: string;
  disposition: OfficialDisclosureCorroborationQueueItem["disposition"];
  relevance_score: number;
  match_reasons: OfficialDisclosureSignalCorrelationReason[];
  disposition_status: "open" | "recorded";
  recorded_decision: string | null;
  review_policy: "review_only_no_fact_mutation";
  action: string;
}

export type OfficialDisclosureSignalCorrelationReason =
  | "signal_source_matches_candidate_source"
  | "signal_source_matches_runnable_target"
  | "signal_mentions_from_company"
  | "signal_mentions_to_company"
  | "signal_mentions_component"
  | "signal_source_already_on_edge";

export interface OfficialDisclosureSignalCorrelationInput {
  signals: readonly OfficialDisclosureSignalReviewSummary[];
  corroboration_queue: readonly OfficialDisclosureCorroborationQueueItem[];
  limit?: number;
}

const OPEN_REVIEW_STATUSES = new Set(["pending", "in_review", "approved", "blocked"]);
const DEFAULT_SIGNAL_CORRELATION_LIMIT = 80;
const MIN_RELEVANCE_SCORE = 0.45;

export function buildOfficialDisclosureSignalCorrelationHints(input: OfficialDisclosureSignalCorrelationInput): OfficialDisclosureSignalCorrelationHint[] {
  const hints: OfficialDisclosureSignalCorrelationHint[] = [];
  const openSignals = input.signals.filter((signal) => OPEN_REVIEW_STATUSES.has(signal.status));
  for (const signal of openSignals) {
    for (const queueItem of input.corroboration_queue) {
      // 这里只做研究排序提示；signal 没有经过 evidence review 前，不能被计入二源 corroboration。
      const scored = scoreSignalCorrelation(signal, queueItem);
      if (scored.relevance_score < MIN_RELEVANCE_SCORE) continue;
      hints.push({
        review_id: signal.review_id,
        edge_id: queueItem.edge_id,
        status: signal.status,
        source_adapter_id: signal.source_adapter_id,
        signal_title: signal.signal_title,
        edge_summary: `${queueItem.from_name} -> ${queueItem.to_name}${queueItem.component_id === null ? "" : ` (${queueItem.component_id})`}`,
        disposition: queueItem.disposition,
        relevance_score: scored.relevance_score,
        match_reasons: scored.match_reasons,
        disposition_status: scored.recorded_decision === null ? "open" : "recorded",
        recorded_decision: scored.recorded_decision,
        review_policy: "review_only_no_fact_mutation",
        action: signalCorrelationAction(queueItem)
      });
    }
  }
  return hints.sort(compareSignalCorrelationHints).slice(0, input.limit ?? DEFAULT_SIGNAL_CORRELATION_LIMIT);
}

function scoreSignalCorrelation(
  signal: OfficialDisclosureSignalReviewSummary,
  queueItem: OfficialDisclosureCorroborationQueueItem
): { relevance_score: number; match_reasons: OfficialDisclosureSignalCorrelationReason[]; recorded_decision: string | null } {
  let score = 0;
  const reasons: OfficialDisclosureSignalCorrelationReason[] = [];
  const signalText = normalizeText(`${signal.signal_title} ${signal.cite_text}`);
  const sourceTargets = queueItem.source_targets.map((target) => target.source_adapter_id);

  if (queueItem.candidate_source_ids.includes(signal.source_adapter_id)) {
    score += 0.45;
    reasons.push("signal_source_matches_candidate_source");
  }
  if (sourceTargets.includes(signal.source_adapter_id)) {
    score += 0.45;
    reasons.push("signal_source_matches_runnable_target");
  }
  if (queueItem.existing_source_adapters.includes(signal.source_adapter_id)) {
    score += 0.2;
    reasons.push("signal_source_already_on_edge");
  }
  if (containsName(signalText, queueItem.from_name)) {
    score += 0.2;
    reasons.push("signal_mentions_from_company");
  }
  if (containsName(signalText, queueItem.to_name)) {
    score += 0.25;
    reasons.push("signal_mentions_to_company");
  }
  if (queueItem.component_id !== null && containsComponent(signalText, queueItem.component_id)) {
    score += 0.15;
    reasons.push("signal_mentions_component");
  }

  return {
    relevance_score: roundSix(Math.min(score, 1)),
    match_reasons: reasons,
    recorded_decision: signal.dispositions.find((disposition) => disposition.edge_id === queueItem.edge_id)?.decision ?? null
  };
}

function signalCorrelationAction(queueItem: OfficialDisclosureCorroborationQueueItem): string {
  if (queueItem.disposition === "needs_counterparty_check")
    return "Review the official disclosure signal against this edge's counterparty check target; if useful, create reviewed evidence or keep an explicit unknown.";
  if (queueItem.disposition === "needs_counterparty_source_target")
    return "Use the signal as a review hint while creating a concrete counterparty source target; do not treat it as corroboration until evidence is reviewed.";
  if (queueItem.disposition === "single_source_disposition_recorded")
    return "Use the signal to revisit the recorded single-source disposition; do not count it as cross-source corroboration automatically.";
  if (queueItem.disposition === "needs_traceability_backfill")
    return "Backfill traceable official evidence for the edge before using the signal as a corroboration review hint.";
  return "Use the signal as a manual review hint or record an explicit single-source unknown; do not mutate the fact edge automatically.";
}

function containsName(normalizedText: string, name: string): boolean {
  const tokens = meaningfulTokens(name);
  if (tokens.length === 0) return false;
  return tokens.every((token) => normalizedText.includes(token));
}

function containsComponent(normalizedText: string, componentId: string): boolean {
  const tokens = meaningfulTokens(componentId.replace(/^COMP-/i, ""));
  if (tokens.length === 0) return false;
  return tokens.some((token) => normalizedText.includes(token));
}

function meaningfulTokens(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 3)
    .filter((token) => !["inc", "corp", "ltd", "limited", "company", "electronics", "technologies"].includes(token));
}

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compareSignalCorrelationHints(left: OfficialDisclosureSignalCorrelationHint, right: OfficialDisclosureSignalCorrelationHint): number {
  return (
    right.relevance_score - left.relevance_score ||
    left.edge_id.localeCompare(right.edge_id) ||
    left.source_adapter_id.localeCompare(right.source_adapter_id) ||
    left.review_id.localeCompare(right.review_id)
  );
}

function roundSix(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
