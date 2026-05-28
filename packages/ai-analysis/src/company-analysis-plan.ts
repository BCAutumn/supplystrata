import type { AiAnalysisNodePlan, AiAnalysisPlan, CompanyAiAnalysisPlanInput } from "./definitions.js";
import { AI_ANALYSIS_SCHEMA_VERSION } from "./definitions.js";

export function buildCompanyAiAnalysisPlan(input: CompanyAiAnalysisPlanInput): AiAnalysisPlan {
  const baseNodes = [companyContextNode(input), reasoningWalkthroughNode(input)];
  const nodes = baseNodes.map((node) => ({
    ...node,
    status: nodeStatus(input.provider.status, node.cannot_conclude.length)
  }));
  return {
    schema_version: AI_ANALYSIS_SCHEMA_VERSION,
    generated_at: input.generated_at,
    scope_kind: "company",
    scope_id: input.consumer_read_model.company.selected_company_id,
    provider: input.provider,
    status: input.provider.status,
    nodes,
    policy: {
      run_write_policy: "ai_analysis_run_only_no_truth_store_mutation",
      fact_mutation_allowed: false,
      agent_behavior_allowed: false
    }
  };
}

function companyContextNode(input: CompanyAiAnalysisPlanInput): Omit<AiAnalysisNodePlan, "status"> {
  const readModel = input.consumer_read_model;
  return {
    node_id: "company_context_explanation_v0",
    purpose: "Explain the deterministic company read model in plain language while preserving evidence, unknown, and source-monitor boundaries.",
    input_contracts: [readModel.contract_id, input.reasoning_walkthrough.walkthrough_id],
    input_refs: [
      `company:${readModel.company.selected_company_id}`,
      `research_pack:${readModel.research_pack.mode}`,
      ...readModel.unknowns.top_open.map((item) => `unknown:${item.unknown_id}`),
      ...readModel.next_actions.top_items.flatMap((item) => item.refs.slice(0, 4))
    ],
    guardrails: [
      "Do not create fact edges, claims, observations, unknowns, review decisions, or source-check jobs.",
      "Do not infer supplier/customer relationships from observations or leads.",
      "Mention blocked sources and missing credentials as operational state, not evidence of absence.",
      "Use cannot_conclude when reviewed evidence is insufficient."
    ],
    cannot_conclude: input.reasoning_walkthrough.cannot_conclude.slice(0, 12).map((item) => `${item.layer_id}: ${item.reason}`),
    expected_output_sections: ["known_facts", "explicit_unknowns", "source_monitor_state", "cannot_conclude", "next_human_actions"]
  };
}

function reasoningWalkthroughNode(input: CompanyAiAnalysisPlanInput): Omit<AiAnalysisNodePlan, "status"> {
  const blockedLayers = input.reasoning_walkthrough.layers.filter(
    (layer) => layer.status === "blocked_source" || layer.explicit_unknowns.count > 0 || layer.constrained_evidence.official_evidence_gaps.length > 0
  );
  return {
    node_id: "reasoning_walkthrough_explanation_v0",
    purpose: "Turn deterministic reasoning layers into an audit-friendly explanation without expanding the investigation scope.",
    input_contracts: [input.reasoning_walkthrough.walkthrough_id],
    input_refs: [
      `company:${input.reasoning_walkthrough.company_id}`,
      ...blockedLayers.map((layer) => `reasoning_layer:${layer.layer_id}`),
      ...blockedLayers.flatMap((layer) => layer.constrained_evidence.source_target_refs.slice(0, 4))
    ],
    guardrails: [
      "Explain only the listed reasoning layers and refs.",
      "Keep observations, leads, and source targets separate from reviewed fact edges.",
      "Do not recommend autonomous web search or crawling.",
      "Do not write back to the truth store."
    ],
    cannot_conclude: blockedLayers.flatMap((layer) => layer.cannot_conclude.map((reason) => `${layer.layer_id}: ${reason}`)).slice(0, 16),
    expected_output_sections: ["layer_statuses", "evidence_boundaries", "blocked_inputs", "cannot_conclude", "review_ready_next_steps"]
  };
}

function nodeStatus(providerStatus: CompanyAiAnalysisPlanInput["provider"]["status"], cannotConcludeCount: number): AiAnalysisNodePlan["status"] {
  if (providerStatus !== "ready") return "blocked_missing_configuration";
  return cannotConcludeCount > 0 ? "cannot_conclude" : "ready";
}
