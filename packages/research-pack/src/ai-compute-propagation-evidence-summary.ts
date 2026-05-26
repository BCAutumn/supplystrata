import type { AiComputePropagationEvidenceLayerSummary, AiComputePropagationOfficialEvidenceGap } from "./ai-compute-propagation-readiness-definitions.js";

export interface BuildAiComputePropagationEvidenceLayerSummaryInput {
  fact_edge_refs: readonly string[];
  observation_refs: readonly string[];
  observation_series_refs: readonly string[];
  component_dependency_refs: readonly string[];
  frontier_refs: readonly string[];
  unknown_refs: readonly string[];
  unknown_backlog_seed_refs: readonly string[];
  source_plan_refs: readonly string[];
  source_target_refs: readonly string[];
  official_evidence_gaps: readonly AiComputePropagationOfficialEvidenceGap[];
}

export function buildAiComputePropagationEvidenceLayerSummary(
  input: BuildAiComputePropagationEvidenceLayerSummaryInput
): AiComputePropagationEvidenceLayerSummary[] {
  return [
    summaryItem({
      layer_kind: "fact_edge",
      refs: input.fact_edge_refs,
      interpretation: "Reviewed Level 4/5 fact anchors visible in this research pack; still require review-controlled mutation for any change.",
      allowed_research_outputs: ["chain_anchor", "corroboration_review", "strength_freshness_review"],
      prohibited_truth_store_writes: ["raise_evidence_level_without_review", "close_unknown_without_review"]
    }),
    summaryItem({
      layer_kind: "observation",
      refs: [...input.observation_refs, ...input.observation_series_refs],
      interpretation: "Typed observations or observation series that can inform analysis but cannot create company relationship facts by themselves.",
      allowed_research_outputs: ["reasoning_input", "observation_review", "calibration_candidate"],
      prohibited_truth_store_writes: ["create_fact_edge", "convert_observation_to_evidence_without_review"]
    }),
    summaryItem({
      layer_kind: "lead",
      refs: [...input.component_dependency_refs, ...input.frontier_refs],
      interpretation: "Taxonomy, frontier, or dependency leads that point to what to research next; they are not evidence-backed relationships.",
      allowed_research_outputs: ["frontier_backlog", "next_research_target", "review_queue_seed"],
      prohibited_truth_store_writes: ["create_fact_edge", "raise_evidence_level", "close_unknown"]
    }),
    summaryItem({
      layer_kind: "unknown",
      refs: [...input.unknown_refs, ...input.unknown_backlog_seed_refs],
      interpretation: "Open unknowns or deterministic backlog seeds that make missing evidence explicit instead of filling gaps with assumptions.",
      allowed_research_outputs: ["unknown_backlog", "review_queue_seed"],
      prohibited_truth_store_writes: ["close_unknown_without_review", "create_fact_edge"]
    }),
    summaryItem({
      layer_kind: "source_target",
      refs: [...input.source_plan_refs, ...input.source_target_refs],
      interpretation: "Configured or planned source collection paths; running them may create observations or review candidates, not automatic fact edges.",
      allowed_research_outputs: ["source_target_action", "source_repair_action", "operational_backlog"],
      prohibited_truth_store_writes: ["create_fact_edge", "raise_evidence_level", "close_unknown"]
    }),
    summaryItem({
      layer_kind: "official_evidence_gap",
      refs: input.official_evidence_gaps.flatMap((gap) => [`official_evidence_gap:${gap.gap_kind}:${gap.target_kind}:${gap.target_id}`, ...gap.refs]),
      count: input.official_evidence_gaps.length,
      interpretation: "Structured missing official-evidence gaps that remain open even when the layer has partial fact anchors.",
      allowed_research_outputs: ["official_evidence_backlog", "source_target_action", "keep_unknown_open"],
      prohibited_truth_store_writes: ["create_fact_edge", "raise_evidence_level", "close_unknown"]
    })
  ];
}

function summaryItem(input: {
  layer_kind: AiComputePropagationEvidenceLayerSummary["layer_kind"];
  refs: readonly string[];
  count?: number;
  interpretation: string;
  allowed_research_outputs: readonly string[];
  prohibited_truth_store_writes: readonly string[];
}): AiComputePropagationEvidenceLayerSummary {
  const refs = uniqueSorted(input.refs);
  return {
    layer_kind: input.layer_kind,
    count: input.count ?? refs.length,
    refs,
    interpretation: input.interpretation,
    allowed_research_outputs: [...input.allowed_research_outputs],
    prohibited_truth_store_writes: [...input.prohibited_truth_store_writes]
  };
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort((left, right) => left.localeCompare(right));
}
