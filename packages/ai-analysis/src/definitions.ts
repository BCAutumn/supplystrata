import type { ConsumerReadModel, ReasoningWalkthrough } from "@supplystrata/research-pack";

export const AI_ANALYSIS_SCHEMA_VERSION = "1.0.0" as const;

export type AiAnalysisProvider = "none" | "openai" | "anthropic" | "deepseek" | "custom";
export type AiAnalysisProviderStatus = "disabled" | "missing_api_key" | "missing_base_url" | "ready";
export type AiAnalysisNodeId = "company_context_explanation_v0" | "reasoning_walkthrough_explanation_v0";
export type AiAnalysisRunStatus = "queued" | "in_progress" | "succeeded" | "failed" | "blocked_missing_configuration" | "cannot_conclude";
export type AiAnalysisArtifactMode = "simulated_local_ai_v0" | "provider_ai_v0";
export type AiAnalysisArtifactStatus = "succeeded" | "cannot_conclude" | "blocked_missing_configuration" | "failed";
export type AiAnalysisPromptVersion = "company_context_explanation.local.v0" | "company_context_explanation.openai_compatible.v0";
export type AiAnalysisScopeKind = "company" | "component" | "edge" | "claim" | "policy";
export type AiAnalysisRunReadPolicy = "read_only_ai_analysis_status";
export type AiAnalysisRunWritePolicy = "ai_analysis_run_only_no_truth_store_mutation";

export interface AiProviderConfigInput {
  LLM_PROVIDER: AiAnalysisProvider;
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
}

export interface AiProviderStatusReport {
  schema_version: typeof AI_ANALYSIS_SCHEMA_VERSION;
  generated_at: string;
  provider: AiAnalysisProvider;
  status: AiAnalysisProviderStatus;
  model: string | null;
  base_url_configured: boolean;
  api_key_configured: boolean;
  external_configuration: {
    api_key_env_keys: string[];
    base_url_env_key: "LLM_BASE_URL";
    model_env_key: "LLM_MODEL";
  };
  safety: {
    secret_fields_redacted: true;
    network_call_allowed: boolean;
    truth_store_write_allowed: false;
  };
  status_reason: string;
}

export interface AiAnalysisPlan {
  schema_version: typeof AI_ANALYSIS_SCHEMA_VERSION;
  generated_at: string;
  scope_kind: AiAnalysisScopeKind;
  scope_id: string;
  provider: AiProviderStatusReport;
  status: AiAnalysisProviderStatus;
  nodes: AiAnalysisNodePlan[];
  policy: {
    run_write_policy: AiAnalysisRunWritePolicy;
    fact_mutation_allowed: false;
    agent_behavior_allowed: false;
  };
}

export interface AiAnalysisNodePlan {
  node_id: AiAnalysisNodeId;
  status: "ready" | "blocked_missing_configuration" | "cannot_conclude";
  purpose: string;
  input_contracts: string[];
  input_refs: string[];
  guardrails: string[];
  cannot_conclude: string[];
  expected_output_sections: string[];
}

export interface AiAnalysisRunStatusReport {
  schema_version: typeof AI_ANALYSIS_SCHEMA_VERSION;
  generated_at: string;
  summary: AiAnalysisRunStatusSummary;
  runs: AiAnalysisRunStatusItem[];
  policy: {
    read_policy: AiAnalysisRunReadPolicy;
    fact_mutation_allowed: false;
    agent_behavior_allowed: false;
  };
}

export interface AiAnalysisRunStatusSummary {
  total: number;
  queued: number;
  in_progress: number;
  succeeded: number;
  failed: number;
  blocked_missing_configuration: number;
  cannot_conclude: number;
}

export interface AiAnalysisRunStatusItem {
  run_id: string;
  node_id: AiAnalysisNodeId;
  scope_kind: AiAnalysisScopeKind;
  scope_id: string;
  status: AiAnalysisRunStatus;
  provider: AiAnalysisProvider;
  model: string | null;
  provider_request_id: string | null;
  input_refs: string[];
  guardrail_refs: string[];
  cannot_conclude: string[];
  prompt_sha256: string | null;
  output_sha256: string | null;
  output_summary: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export interface CompanyAiAnalysisPlanInput {
  generated_at: string;
  provider: AiProviderStatusReport;
  consumer_read_model: ConsumerReadModel;
  reasoning_walkthrough: ReasoningWalkthrough;
}

export interface AiAnalysisArtifactPolicy {
  fact_mutation_allowed: false;
  agent_behavior_allowed: false;
  source_connector_allowed: false;
}

export interface AiAnalysisKeyInsight {
  title: string;
  body: string;
}

export interface AiAnalysisNextHumanAction {
  title: string;
  action: string;
  refs: string[];
}

export interface AiAnalysisArtifact {
  schema_version: typeof AI_ANALYSIS_SCHEMA_VERSION;
  generated_at: string;
  mode: AiAnalysisArtifactMode;
  scope_id: string;
  node_id: AiAnalysisNodeId;
  status: AiAnalysisArtifactStatus;
  provider: AiAnalysisProvider;
  model: string | null;
  policy: AiAnalysisArtifactPolicy;
  headline: string;
  executive_summary: string[];
  key_insights: AiAnalysisKeyInsight[];
  evidence_boundaries: string[];
  cannot_conclude: string[];
  next_human_actions: AiAnalysisNextHumanAction[];
  open_unknowns: string[];
  referenced_refs: string[];
  assumptions: string[];
  model_metadata: {
    provider_request_id: string | null;
    prompt_version: AiAnalysisPromptVersion;
    input_contracts: string[];
    input_refs: string[];
    output_schema_id: "ai_analysis_artifact.v1";
    simulated: boolean;
  };
  quality_lift: {
    before: string;
    after: string;
  };
}

export interface AiAnalysisResearchPackManifestInput {
  generated_at: string;
  selected_company_id: string;
  mode: string;
  stats: AiAnalysisResearchPackStatsInput;
}

export interface AiAnalysisResearchPackStatsInput {
  official_disclosure_l4_l5_edges: number;
  official_disclosure_traceable_edges: number;
  source_target_total_observations: number;
  supply_chain_expansion_component_dependency_leads: number;
  official_disclosure_target_nodes?: number;
}

export interface AiAnalysisConsumerInput {
  contract_id: string;
  company: {
    selected_company_id: string;
  };
  research_pack: {
    mode: string;
  };
  source_monitoring?: {
    expected_targets: number;
    synced_targets: number;
    due_targets: number;
  };
  unknowns: {
    top_open: AiAnalysisUnknownInput[];
  };
  next_actions: {
    top_items: AiAnalysisNextActionInput[];
  };
}

export interface AiAnalysisUnknownInput {
  unknown_id: string;
  question: string;
}

export interface AiAnalysisNextActionInput {
  title: string;
  recommended_action: string;
  refs: string[];
}

export interface AiAnalysisReasoningInput {
  walkthrough_id: string;
  company_id: string;
  layers: AiAnalysisReasoningLayerInput[];
  cannot_conclude: AiAnalysisCannotConcludeInput[];
}

export interface AiAnalysisReasoningLayerInput {
  layer_id: string;
  status: string;
  known_facts?: {
    count: number;
    refs?: string[];
  };
  explicit_unknowns?: {
    count: number;
    refs?: string[];
  };
  constrained_evidence?: {
    source_target_refs?: string[];
    observation_refs?: string[];
    lead_refs?: string[];
  };
  cannot_conclude?: string[];
}

export interface AiAnalysisCannotConcludeInput {
  layer_id: string;
  reason: string;
}

export interface BuildLocalAiAnalysisArtifactInput {
  generated_at: string;
  provider: AiProviderStatusReport;
  manifest: AiAnalysisResearchPackManifestInput;
  consumer_read_model: AiAnalysisConsumerInput;
  reasoning_walkthrough: AiAnalysisReasoningInput;
  previous_manifest?: AiAnalysisResearchPackManifestInput;
}

export interface BuildLocalAiAnalysisArtifactFromUnknownInput {
  generated_at?: string;
  provider: AiProviderStatusReport;
  manifest: unknown;
  consumer_read_model: unknown;
  reasoning_walkthrough: unknown;
  previous_manifest?: unknown;
}

export interface BuildProviderAiAnalysisArtifactFromUnknownInput extends BuildLocalAiAnalysisArtifactFromUnknownInput {
  api_key: string;
  base_url?: string;
  timeout_ms?: number;
}

export interface AiAnalysisArtifactValidationInput {
  artifact: unknown;
  allowed_refs: readonly string[];
}

export type AiAnalysisArtifactValidationResult =
  | {
      ok: true;
      artifact: AiAnalysisArtifact;
    }
  | {
      ok: false;
      errors: string[];
    };
