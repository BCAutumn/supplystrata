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
export type LlmHelperCandidateStatus = "candidate" | "disabled" | "deferred" | "invalid_input" | "provider_error";

export interface LlmProviderJsonRequest {
  helper: LlmHelperName;
  prompt_version: string;
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
