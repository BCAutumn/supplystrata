import type { SourceTargetCoverageItem } from "@supplystrata/source-monitor";

export type SourceTargetObservationReviewCategory = "supply_chain_signal" | "financial_context" | "metric_mapping_gap";
export type SourceTargetObservationReviewPriority = "P0" | "P1" | "P2";
export type SourceTargetObservationReviewPolicy = "review_only_no_fact_mutation";
export type SourceTargetObservationCalibrationLabel = "useful_signal" | "background_context" | "needs_context" | "not_useful";

export interface SourceTargetObservationReviewSummary {
  review_items: number;
  calibration_candidates: number;
  labeled_calibration_candidates: number;
  unlabeled_calibration_candidates: number;
  next_labeling_batch_candidates: number;
  p0: number;
  p1: number;
  p2: number;
  by_category: Record<SourceTargetObservationReviewCategory, number>;
  by_recommended_label: Record<SourceTargetObservationCalibrationLabel, number>;
  by_persisted_label: Record<SourceTargetObservationCalibrationLabel, number>;
  next_labeling_batch_by_priority: Record<SourceTargetObservationReviewPriority, number>;
  next_labeling_batch_by_metric: Record<string, number>;
}

export interface SourceTargetObservationReviewItem {
  metric_name: string;
  observations: number;
  priority: SourceTargetObservationReviewPriority;
  category: SourceTargetObservationReviewCategory;
  review_policy: SourceTargetObservationReviewPolicy;
  recommended_action: string;
  rationale: string;
  supporting_refs: string[];
  sample_observations: SourceTargetCoverageItem["observation_samples"];
}

export interface SourceTargetObservationCalibrationCandidate {
  candidate_id: string;
  observation_id: string;
  metric_name: string;
  priority: SourceTargetObservationReviewPriority;
  category: SourceTargetObservationReviewCategory;
  recommended_label: SourceTargetObservationCalibrationLabel;
  allowed_labels: readonly SourceTargetObservationCalibrationLabel[];
  review_policy: SourceTargetObservationReviewPolicy;
  rationale: string;
  doc_id: string | null;
  source_item_id: string | null;
  source_url: string | null;
  metric_value: string | null;
  metric_unit: string | null;
  baseline_value: string | null;
  change_percent: number | null;
  time_window_start: string | null;
  time_window_end: string | null;
  scope_kind: string;
  scope_id: string;
  confidence: number;
  review_status: "unlabeled" | "labeled";
  latest_label: SourceTargetObservationCalibrationExistingLabel | null;
  existing_labels: SourceTargetObservationCalibrationExistingLabel[];
}

export interface SourceTargetObservationCalibrationExistingLabel {
  label_id: string;
  observation_id: string;
  candidate_id?: string;
  label: SourceTargetObservationCalibrationLabel;
  reviewer: string;
  reviewed_at: string;
  rationale?: string;
}

export interface SourceTargetObservationReview {
  summary: SourceTargetObservationReviewSummary;
  items: SourceTargetObservationReviewItem[];
  calibration_candidates: SourceTargetObservationCalibrationCandidate[];
  labeling_plan: SourceTargetObservationCalibrationLabelingPlan;
}

export interface SourceTargetObservationCalibrationLabelingPlan {
  strategy: "stratified_unlabeled_by_priority_metric";
  review_policy: SourceTargetObservationReviewPolicy;
  batch_size: number;
  candidates: SourceTargetObservationCalibrationLabelingPlanItem[];
}

export interface SourceTargetObservationCalibrationLabelingPlanItem {
  candidate_id: string;
  observation_id: string;
  metric_name: string;
  priority: SourceTargetObservationReviewPriority;
  category: SourceTargetObservationReviewCategory;
  recommended_label: SourceTargetObservationCalibrationLabel;
  selection_reason: string;
  doc_id: string | null;
  source_item_id: string | null;
  source_url: string | null;
  time_window_end: string | null;
}

const OBSERVATION_CALIBRATION_LABELS: readonly SourceTargetObservationCalibrationLabel[] = [
  "useful_signal",
  "background_context",
  "needs_context",
  "not_useful"
];
const OBSERVATION_CALIBRATION_LABELING_BATCH_SIZE = 12;

export function buildSourceTargetObservationReview(
  items: readonly SourceTargetCoverageItem[],
  existingLabels: readonly SourceTargetObservationCalibrationExistingLabel[] = []
): SourceTargetObservationReview {
  const metricCounts = summarizeSourceTargetObservationMetrics(items);
  const reviewPolicy: SourceTargetObservationReviewPolicy = "review_only_no_fact_mutation";
  const reviewItems = Object.entries(metricCounts)
    .filter(([, count]) => count > 0)
    .map(([metricName, observations]) => {
      const rule = reviewRuleForMetric(metricName);
      return {
        metric_name: metricName,
        observations,
        priority: rule.priority,
        category: rule.category,
        review_policy: reviewPolicy,
        recommended_action: rule.recommended_action,
        rationale: rule.rationale,
        supporting_refs: metricSupportingRefs(metricName, items),
        sample_observations: metricObservationSamples(metricName, items)
      };
    })
    .sort(compareObservationReviewItems);
  const calibrationCandidates = buildObservationCalibrationCandidates(reviewItems, existingLabels);
  const labelingPlan = buildObservationCalibrationLabelingPlan(calibrationCandidates, reviewPolicy);
  return {
    summary: summarizeObservationReview(reviewItems, calibrationCandidates, labelingPlan),
    items: reviewItems,
    calibration_candidates: calibrationCandidates,
    labeling_plan: labelingPlan
  };
}

export function summarizeSourceTargetObservationMetrics(items: readonly SourceTargetCoverageItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    for (const [metric, count] of Object.entries(item.observations_by_metric)) counts[metric] = (counts[metric] ?? 0) + count;
  }
  const sorted: Record<string, number> = {};
  for (const [metric, count] of Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))) sorted[metric] = count;
  return sorted;
}

function reviewRuleForMetric(
  metricName: string
): Omit<SourceTargetObservationReviewItem, "metric_name" | "observations" | "review_policy" | "supporting_refs" | "sample_observations"> {
  const normalized = metricName.toLowerCase();
  // 这里只做审查优先级，不把指标解释成供应关系，避免 observation 越权污染事实层。
  if (normalized === "purchase_obligations") {
    return {
      priority: "P0",
      category: "supply_chain_signal",
      recommended_action: "Review official filing snippets and map whether the obligation language can support dependency or capacity calibration.",
      rationale:
        "Purchase obligations are the closest current structured SEC signal to supplier or procurement exposure, but they still require source review before relation use."
    };
  }
  if (normalized === "capital_expenditures" || normalized === "inventory") {
    return {
      priority: "P1",
      category: "supply_chain_signal",
      recommended_action:
        "Use as calibration seed for capacity, inventory, or expansion context; keep it in observations until corroborated by relationship evidence.",
      rationale: "This metric can support supply-chain context and anomaly calibration, but it cannot identify a counterparty by itself."
    };
  }
  if (normalized === "cost_of_revenue" || normalized === "accounts_payable") {
    return {
      priority: "P1",
      category: "supply_chain_signal",
      recommended_action:
        "Review as cost/procurement pressure context and pair it with official counterparty disclosure before using it in relationship analysis.",
      rationale: "The metric may indicate operating or procurement pressure, but it is still aggregate financial context rather than a fact edge."
    };
  }
  if (normalized === "revenue") {
    return {
      priority: "P2",
      category: "financial_context",
      recommended_action: "Keep as peer baseline and scale context for financial comparison; do not use it as supply-chain relationship evidence.",
      rationale: "Revenue is useful for normalization and peer comparison, but it does not describe upstream or downstream relationships."
    };
  }
  if (normalized.includes("import") || normalized.includes("export") || normalized.includes("price")) {
    return {
      priority: "P1",
      category: "supply_chain_signal",
      recommended_action: "Review as trade, material, or price context and connect it to a component/geography before deriving risk or propagation inputs.",
      rationale: "Trade and price observations can support propagation analysis, but need component/geography scoping before interpretation."
    };
  }
  return {
    priority: "P2",
    category: "metric_mapping_gap",
    recommended_action: "Classify the metric in methodology docs before using it for calibration, anomaly, or propagation analysis.",
    rationale: "Unclassified metrics should stay visible but should not silently enter downstream scoring or relationship reasoning."
  };
}

function metricSupportingRefs(metricName: string, items: readonly SourceTargetCoverageItem[]): string[] {
  const refs = new Set<string>();
  for (const item of items) {
    const count = item.observations_by_metric[metricName] ?? 0;
    if (count <= 0) continue;
    refs.add(`source_target:${item.matched_check_target_id ?? item.expected_target.check_target_id}`);
  }
  return [...refs].sort().slice(0, 10);
}

function metricObservationSamples(metricName: string, items: readonly SourceTargetCoverageItem[]): SourceTargetCoverageItem["observation_samples"] {
  return items
    .flatMap((item) => item.observation_samples.filter((sample) => sample.metric_name === metricName))
    .sort(compareObservationSamples)
    .slice(0, 10);
}

function buildObservationCalibrationCandidates(
  reviewItems: readonly SourceTargetObservationReviewItem[],
  existingLabels: readonly SourceTargetObservationCalibrationExistingLabel[]
): SourceTargetObservationCalibrationCandidate[] {
  const labelsByObservation = groupLabelsByObservation(existingLabels);
  return reviewItems
    .flatMap((item) =>
      item.sample_observations.map((sample) => {
        const labels = labelsByObservation.get(sample.observation_id) ?? [];
        const latestLabel = labels[0] ?? null;
        const reviewStatus: SourceTargetObservationCalibrationCandidate["review_status"] = latestLabel === null ? "unlabeled" : "labeled";
        return {
          candidate_id: `observation-calibration:${item.metric_name}:${sample.observation_id}`,
          observation_id: sample.observation_id,
          metric_name: item.metric_name,
          priority: item.priority,
          category: item.category,
          recommended_label: calibrationLabelForCategory(item.category),
          allowed_labels: OBSERVATION_CALIBRATION_LABELS,
          review_policy: item.review_policy,
          rationale: item.rationale,
          doc_id: sample.doc_id,
          source_item_id: sample.source_item_id,
          source_url: sample.source_url,
          metric_value: sample.metric_value,
          metric_unit: sample.metric_unit,
          baseline_value: sample.baseline_value,
          change_percent: sample.change_percent,
          time_window_start: sample.time_window_start,
          time_window_end: sample.time_window_end,
          scope_kind: sample.scope_kind,
          scope_id: sample.scope_id,
          confidence: sample.confidence,
          review_status: reviewStatus,
          latest_label: latestLabel,
          existing_labels: labels
        };
      })
    )
    .sort(compareObservationCalibrationCandidates);
}

function groupLabelsByObservation(
  labels: readonly SourceTargetObservationCalibrationExistingLabel[]
): Map<string, SourceTargetObservationCalibrationExistingLabel[]> {
  const groups = new Map<string, SourceTargetObservationCalibrationExistingLabel[]>();
  for (const label of labels) {
    const existing = groups.get(label.observation_id) ?? [];
    existing.push(label);
    groups.set(label.observation_id, existing);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => {
      const reviewedDiff = right.reviewed_at.localeCompare(left.reviewed_at);
      if (reviewedDiff !== 0) return reviewedDiff;
      return left.label_id.localeCompare(right.label_id);
    });
  }
  return groups;
}

function calibrationLabelForCategory(category: SourceTargetObservationReviewCategory): SourceTargetObservationCalibrationLabel {
  if (category === "supply_chain_signal") return "useful_signal";
  if (category === "financial_context") return "background_context";
  return "needs_context";
}

function buildObservationCalibrationLabelingPlan(
  candidates: readonly SourceTargetObservationCalibrationCandidate[],
  reviewPolicy: SourceTargetObservationReviewPolicy
): SourceTargetObservationCalibrationLabelingPlan {
  const selected = stratifiedUnlabeledCalibrationCandidates(candidates, OBSERVATION_CALIBRATION_LABELING_BATCH_SIZE);
  return {
    strategy: "stratified_unlabeled_by_priority_metric",
    review_policy: reviewPolicy,
    batch_size: OBSERVATION_CALIBRATION_LABELING_BATCH_SIZE,
    candidates: selected.map((candidate) => ({
      candidate_id: candidate.candidate_id,
      observation_id: candidate.observation_id,
      metric_name: candidate.metric_name,
      priority: candidate.priority,
      category: candidate.category,
      recommended_label: candidate.recommended_label,
      selection_reason: `${candidate.priority} unlabeled ${candidate.metric_name} calibration stratum`,
      doc_id: candidate.doc_id,
      source_item_id: candidate.source_item_id,
      source_url: candidate.source_url,
      time_window_end: candidate.time_window_end
    }))
  };
}

function stratifiedUnlabeledCalibrationCandidates(
  candidates: readonly SourceTargetObservationCalibrationCandidate[],
  batchSize: number
): SourceTargetObservationCalibrationCandidate[] {
  const groups = new Map<string, SourceTargetObservationCalibrationCandidate[]>();
  for (const candidate of candidates.filter((item) => item.review_status === "unlabeled").sort(compareObservationCalibrationCandidates)) {
    const key = `${candidate.priority}:${candidate.metric_name}`;
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }
  const groupKeys = [...groups.keys()].sort(compareCalibrationStratumKeys);
  const selected: SourceTargetObservationCalibrationCandidate[] = [];
  while (selected.length < batchSize) {
    let pickedInRound = false;
    for (const key of groupKeys) {
      const group = groups.get(key) ?? [];
      const candidate = group.shift();
      if (candidate === undefined) continue;
      selected.push(candidate);
      pickedInRound = true;
      if (selected.length >= batchSize) break;
    }
    if (!pickedInRound) break;
  }
  return selected;
}

function compareCalibrationStratumKeys(left: string, right: string): number {
  const [leftPriority = "P2", leftMetric = ""] = left.split(":");
  const [rightPriority = "P2", rightMetric = ""] = right.split(":");
  const priorityDiff = priorityRank(priorityFromString(leftPriority)) - priorityRank(priorityFromString(rightPriority));
  if (priorityDiff !== 0) return priorityDiff;
  return leftMetric.localeCompare(rightMetric);
}

function priorityFromString(value: string): SourceTargetObservationReviewPriority {
  if (value === "P0" || value === "P1") return value;
  return "P2";
}

function compareObservationCalibrationCandidates(
  left: SourceTargetObservationCalibrationCandidate,
  right: SourceTargetObservationCalibrationCandidate
): number {
  const priorityDiff = priorityRank(left.priority) - priorityRank(right.priority);
  if (priorityDiff !== 0) return priorityDiff;
  const metricDiff = left.metric_name.localeCompare(right.metric_name);
  if (metricDiff !== 0) return metricDiff;
  const leftWindow = left.time_window_end ?? "";
  const rightWindow = right.time_window_end ?? "";
  const windowDiff = rightWindow.localeCompare(leftWindow);
  if (windowDiff !== 0) return windowDiff;
  return left.observation_id.localeCompare(right.observation_id);
}

function compareObservationSamples(
  left: SourceTargetCoverageItem["observation_samples"][number],
  right: SourceTargetCoverageItem["observation_samples"][number]
): number {
  const leftWindow = left.time_window_end ?? "";
  const rightWindow = right.time_window_end ?? "";
  const windowDiff = rightWindow.localeCompare(leftWindow);
  if (windowDiff !== 0) return windowDiff;
  return left.observation_id.localeCompare(right.observation_id);
}

function summarizeObservationReview(
  items: readonly SourceTargetObservationReviewItem[],
  calibrationCandidates: readonly SourceTargetObservationCalibrationCandidate[],
  labelingPlan: SourceTargetObservationCalibrationLabelingPlan
): SourceTargetObservationReviewSummary {
  const byCategory: Record<SourceTargetObservationReviewCategory, number> = {
    supply_chain_signal: 0,
    financial_context: 0,
    metric_mapping_gap: 0
  };
  for (const item of items) byCategory[item.category] += 1;
  const byRecommendedLabel = emptyCalibrationLabelCounts();
  for (const candidate of calibrationCandidates) byRecommendedLabel[candidate.recommended_label] += 1;
  const byPersistedLabel = emptyCalibrationLabelCounts();
  let labeledCalibrationCandidates = 0;
  for (const candidate of calibrationCandidates) {
    if (candidate.latest_label === null) continue;
    labeledCalibrationCandidates += 1;
    byPersistedLabel[candidate.latest_label.label] += 1;
  }
  const nextLabelingBatchByPriority: Record<SourceTargetObservationReviewPriority, number> = { P0: 0, P1: 0, P2: 0 };
  const nextLabelingBatchByMetric: Record<string, number> = {};
  for (const candidate of labelingPlan.candidates) {
    nextLabelingBatchByPriority[candidate.priority] += 1;
    nextLabelingBatchByMetric[candidate.metric_name] = (nextLabelingBatchByMetric[candidate.metric_name] ?? 0) + 1;
  }
  return {
    review_items: items.length,
    calibration_candidates: calibrationCandidates.length,
    labeled_calibration_candidates: labeledCalibrationCandidates,
    unlabeled_calibration_candidates: calibrationCandidates.length - labeledCalibrationCandidates,
    next_labeling_batch_candidates: labelingPlan.candidates.length,
    p0: items.filter((item) => item.priority === "P0").length,
    p1: items.filter((item) => item.priority === "P1").length,
    p2: items.filter((item) => item.priority === "P2").length,
    by_category: byCategory,
    by_recommended_label: byRecommendedLabel,
    by_persisted_label: byPersistedLabel,
    next_labeling_batch_by_priority: nextLabelingBatchByPriority,
    next_labeling_batch_by_metric: sortNumberMap(nextLabelingBatchByMetric)
  };
}

function emptyCalibrationLabelCounts(): Record<SourceTargetObservationCalibrationLabel, number> {
  return {
    useful_signal: 0,
    background_context: 0,
    needs_context: 0,
    not_useful: 0
  };
}

function compareObservationReviewItems(left: SourceTargetObservationReviewItem, right: SourceTargetObservationReviewItem): number {
  const priorityDiff = priorityRank(left.priority) - priorityRank(right.priority);
  if (priorityDiff !== 0) return priorityDiff;
  const observationDiff = right.observations - left.observations;
  if (observationDiff !== 0) return observationDiff;
  return left.metric_name.localeCompare(right.metric_name);
}

function sortNumberMap(input: Record<string, number>): Record<string, number> {
  const sorted: Record<string, number> = {};
  for (const [key, value] of Object.entries(input).sort(([left], [right]) => left.localeCompare(right))) sorted[key] = value;
  return sorted;
}

function priorityRank(priority: SourceTargetObservationReviewPriority): number {
  if (priority === "P0") return 0;
  if (priority === "P1") return 1;
  return 2;
}
