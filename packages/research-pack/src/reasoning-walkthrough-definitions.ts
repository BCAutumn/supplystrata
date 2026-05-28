import type { AiComputePropagationPolicy } from "./ai-compute-propagation-readiness-definitions.js";

export interface ReasoningWalkthrough {
  schema_version: "1.0.0";
  walkthrough_id: "gate8_lite_reasoning_walkthrough.v0";
  generated_at: string;
  company_id: string;
  matrix_id: "ai_compute_propagation.v0" | "profile_propagation.v0";
  policy: AiComputePropagationPolicy;
  summary: {
    layers: number;
    known_fact_layers: number;
    layers_with_unknowns: number;
    layers_with_blocked_sources: number;
    next_actions: number;
    prohibited_truth_store_writes: string[];
  };
  layers: ReasoningWalkthroughLayer[];
  cannot_conclude: ReasoningCannotConcludeItem[];
}

export interface ReasoningWalkthroughLayer {
  layer_id: string;
  title: string;
  status: string;
  question: string;
  known_facts: ReasoningRefGroup;
  explicit_unknowns: ReasoningRefGroup;
  constrained_evidence: ReasoningConstrainedEvidence;
  next_actions: ReasoningNextAction[];
  cannot_conclude: string[];
}

export interface ReasoningRefGroup {
  count: number;
  refs: string[];
  interpretation: string;
}

export interface ReasoningConstrainedEvidence {
  observation_refs: string[];
  lead_refs: string[];
  source_target_refs: string[];
  official_evidence_gaps: ReasoningOfficialEvidenceGap[];
}

export interface ReasoningOfficialEvidenceGap {
  gap_kind: string;
  target_kind: string;
  target_id: string;
  label: string;
  recommended_action: string;
}

export interface ReasoningNextAction {
  queue_item_id: string;
  priority: string;
  action: string;
  title: string;
  reason: string;
  source_target_refs: string[];
  unknown_refs: string[];
}

export interface ReasoningCannotConcludeItem {
  layer_id: string;
  reason: string;
}
