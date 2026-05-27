import type { Gate1DataDepthCommandHint, Gate1DataDepthWorkbenchItem } from "./gate1-data-depth-workbench-definitions.js";
import type { SourceTargetObservationCalibrationLabelingPlanItem } from "./source-target-observation-review.js";
import type { SourceTargetCoverageReport } from "./source-target-coverage.js";
import { commandHint, uniqueSorted, workItem } from "./gate1-data-depth-workbench-item-shared.js";

export function observationCalibrationItems(report: SourceTargetCoverageReport): Gate1DataDepthWorkbenchItem[] {
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
      command_hints: observationCalibrationCommandHints(plan.candidates),
      refs: plan.candidates.map((candidate) => `observation:${candidate.observation_id}`),
      edge_ids: [],
      component_ids: [],
      source_adapters: sourceAdaptersForCalibrationBatch(report),
      source_targets: []
    })
  ];
}

function observationCalibrationCommandHints(candidates: readonly SourceTargetObservationCalibrationLabelingPlanItem[]): Gate1DataDepthCommandHint[] {
  return candidates.map((candidate) =>
    commandHint(
      `Record ${candidate.metric_name} label`,
      `pnpm --silent cli intelligence observation-calibration-label ${candidate.observation_id} --label ${candidate.recommended_label} --reviewer <reviewer> --rationale "<reviewed ${candidate.selection_reason}>"`,
      true,
      true
    )
  );
}

function sourceAdaptersForCalibrationBatch(report: SourceTargetCoverageReport): string[] {
  const observationIds = new Set(report.observation_review.labeling_plan.candidates.map((candidate) => candidate.observation_id));
  return uniqueSorted(
    report.items
      .filter((item) => item.observation_samples.some((sample) => observationIds.has(sample.observation_id)))
      .map((item) => item.expected_target.source_adapter_id)
  );
}
