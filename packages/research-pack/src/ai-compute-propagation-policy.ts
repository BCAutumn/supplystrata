import type { AiComputePropagationLayerStatus, AiComputePropagationPolicy } from "./ai-compute-propagation-readiness-definitions.js";

export const AI_COMPUTE_PROPAGATION_POLICY: AiComputePropagationPolicy = "reasoning_input_only_no_fact_mutation";

export function nextActionsFor(status: AiComputePropagationLayerStatus): string[] {
  if (status === "covered_fact") return ["Use fact refs as chain anchors; continue corroboration and strength/freshness review."];
  if (status === "observation_ready") return ["Use observations as reasoning inputs; do not create company fact edges from them."];
  if (status === "blocked_source") return ["Inspect source target failure/degradation before relying on this layer."];
  if (status === "official_target_runnable") return ["Sync/enable/run the listed source targets, then review outputs through controlled paths."];
  if (status === "lead_only") return ["Promote relevant leads into source targets or explicit unknowns before treating the layer as covered."];
  return ["Create source targets or explicit unknowns for this propagation layer."];
}

export function missingOfficialEvidenceFor(status: AiComputePropagationLayerStatus): string[] {
  if (status === "covered_fact") return [];
  if (status === "observation_ready") {
    return ["Review official filings, IR pages, supplier lists, or approved source targets before converting observations into evidence-backed facts."];
  }
  if (status === "blocked_source") {
    return ["Repair the blocked/degraded official source target and rerun it before relying on this layer."];
  }
  if (status === "official_target_runnable") {
    return ["Run or sync the listed official source targets, then review extracted citations through the existing review/apply path."];
  }
  if (status === "lead_only") {
    return ["Create an official source target or explicit unknown for each relevant lead before treating this layer as covered."];
  }
  return ["No official evidence or runnable official source path is visible; add a source target or keep the layer as an explicit unknown."];
}

export function allowedResearchOutputsFor(status: AiComputePropagationLayerStatus): string[] {
  if (status === "covered_fact") return ["chain_anchor", "corroboration_review", "strength_freshness_review"];
  if (status === "observation_ready") return ["reasoning_input", "observation_review", "calibration_candidate"];
  if (status === "official_target_runnable") return ["source_target_action", "review_queue_seed"];
  if (status === "blocked_source") return ["source_repair_action", "operational_backlog"];
  if (status === "lead_only") return ["frontier_backlog", "unknown_seed"];
  return ["unknown_backlog", "source_target_gap"];
}

export function prohibitedTruthStoreWritesFor(status: AiComputePropagationLayerStatus): string[] {
  if (status === "covered_fact") {
    return ["raise_evidence_level_without_review", "close_unknown_without_review"];
  }
  return ["create_fact_edge", "raise_evidence_level", "close_unknown", "convert_observation_to_evidence_without_review"];
}
