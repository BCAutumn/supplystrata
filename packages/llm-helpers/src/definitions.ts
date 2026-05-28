export const LLM_HELPERS_SCHEMA_VERSION = "1.0.0" as const;

export type AiAnalysisProvider = "none" | "openai" | "anthropic" | "deepseek" | "custom";
export type AiAnalysisProviderStatus = "disabled" | "missing_api_key" | "missing_base_url" | "ready";

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
  schema_version: typeof LLM_HELPERS_SCHEMA_VERSION;
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

export type LlmHelperName = "disambiguate_entity" | "derive_dynamic_profile" | "suggest_source_targets" | "summarize_with_citations";
export type LlmHelperCandidateStatus = "candidate" | "disabled" | "deferred" | "invalid_input" | "invalid_output" | "provider_error";

export interface LlmProviderPrompt {
  system: string;
  user: string;
}

export interface LlmProviderJsonRequest {
  helper: LlmHelperName;
  prompt_version: string;
  prompt: LlmProviderPrompt;
  input: Record<string, unknown>;
}

export interface LlmProviderJsonResponse {
  provider_request_id: string | null;
  model: string | null;
  output: Record<string, unknown>;
}

export interface LlmProvider {
  completeJson(request: LlmProviderJsonRequest): Promise<LlmProviderJsonResponse>;
}

export interface LlmHelperOptions {
  provider?: LlmProvider;
  disabled?: boolean;
  generated_at?: string;
}

export interface LlmCandidateCitation {
  source_ref: string;
  cite_text?: string;
}

interface LlmCandidateBase {
  schema_version: typeof LLM_HELPERS_SCHEMA_VERSION;
  generated_at: string;
  helper: LlmHelperName;
  status: LlmHelperCandidateStatus;
  confidence: number;
  citations: LlmCandidateCitation[];
  rationale: string;
  provider_request_id: string | null;
  model: string | null;
  fact_write_allowed: false;
}

export interface EntityDisambiguationCandidate {
  entity_id: string;
  label: string;
  confidence: number;
  reason: string;
}

export interface DisambiguateEntityInput {
  surface: string;
  nearby_text?: string;
  candidates: EntityDisambiguationCandidate[];
}

export interface DisambiguateEntityCandidate extends LlmCandidateBase {
  helper: "disambiguate_entity";
  ranked_candidates: EntityDisambiguationCandidate[];
}

export interface DerivedProfileComponent {
  component_id?: string;
  label: string;
  rationale: string;
}

export interface SuggestedSourceTarget {
  source_adapter_id: string;
  target_ref: string;
  rationale: string;
}

export interface DeriveDynamicProfileInput {
  company_id: string;
  company_name: string;
  public_description?: string;
  sic_code?: string;
  naics_code?: string;
  filing_excerpt?: string;
  source_refs?: string[];
}

export interface DeriveDynamicProfileCandidate extends LlmCandidateBase {
  helper: "derive_dynamic_profile";
  expected_upstream_components: DerivedProfileComponent[];
  source_targets: SuggestedSourceTarget[];
}

export interface SuggestSourceTargetsInput {
  company_id: string;
  current_coverage_refs: string[];
  unknown_context: string[];
  source_refs?: string[];
}

export interface SuggestSourceTargetsCandidate extends LlmCandidateBase {
  helper: "suggest_source_targets";
  source_targets: SuggestedSourceTarget[];
}

export interface SummarizeWithCitationsInput {
  question: string;
  evidence: SummarizeEvidenceInput[];
}

export interface SummarizeEvidenceInput {
  evidence_id: string;
  cite_text: string;
}

export interface SummarizeWithCitationsCandidate extends LlmCandidateBase {
  helper: "summarize_with_citations";
  summary: string;
  cited_evidence_ids: string[];
}

export type AiAnalysisNodeId = "company_context_explanation_v0" | "reasoning_walkthrough_explanation_v0";
export type AiAnalysisArtifactMode = "simulated_local_ai_v0" | "provider_ai_v0";
export type AiAnalysisArtifactStatus = "succeeded" | "cannot_conclude" | "blocked_missing_configuration" | "failed";
export type AiAnalysisPromptVersion = "company_context_explanation.local.v0" | "company_context_explanation.openai_compatible.v0";

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

export interface AiAnalysisArtifactCandidate {
  schema_version: typeof LLM_HELPERS_SCHEMA_VERSION;
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
    official_evidence_gaps?: AiAnalysisOfficialEvidenceGapInput[];
  };
  cannot_conclude?: string[];
}

export interface AiAnalysisOfficialEvidenceGapInput {
  gap_kind: string;
  target_kind: string;
  target_id: string;
  label: string;
  recommended_action: string;
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
