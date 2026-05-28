import {
  LLM_HELPERS_SCHEMA_VERSION,
  type DeriveDynamicProfileCandidate,
  type DeriveDynamicProfileInput,
  type DisambiguateEntityCandidate,
  type DisambiguateEntityInput,
  type LlmCandidateCitation,
  type LlmHelperName,
  type LlmHelperOptions,
  type LlmProviderJsonResponse,
  type SuggestSourceTargetsCandidate,
  type SuggestSourceTargetsInput,
  type SummarizeWithCitationsCandidate,
  type SummarizeWithCitationsInput
} from "./definitions.js";

export async function disambiguate_entity(input: DisambiguateEntityInput, options: LlmHelperOptions = {}): Promise<DisambiguateEntityCandidate> {
  void input;
  const disabled = disabledCandidateBase("disambiguate_entity", options);
  return {
    ...disabled,
    helper: "disambiguate_entity",
    ranked_candidates: []
  };
}

export async function derive_dynamic_profile(input: DeriveDynamicProfileInput, options: LlmHelperOptions = {}): Promise<DeriveDynamicProfileCandidate> {
  void input;
  const disabled = disabledCandidateBase("derive_dynamic_profile", options);
  return {
    ...disabled,
    helper: "derive_dynamic_profile",
    expected_upstream_components: [],
    source_targets: []
  };
}

export async function suggest_source_targets(input: SuggestSourceTargetsInput, options: LlmHelperOptions = {}): Promise<SuggestSourceTargetsCandidate> {
  void input;
  const disabled = disabledCandidateBase("suggest_source_targets", options);
  return {
    ...disabled,
    helper: "suggest_source_targets",
    source_targets: []
  };
}

export async function summarize_with_citations(input: SummarizeWithCitationsInput, options: LlmHelperOptions = {}): Promise<SummarizeWithCitationsCandidate> {
  void input;
  const disabled = disabledCandidateBase("summarize_with_citations", options);
  return {
    ...disabled,
    helper: "summarize_with_citations",
    summary: "",
    cited_evidence_ids: []
  };
}

function disabledCandidateBase(
  helper: LlmHelperName,
  options: LlmHelperOptions
): {
  schema_version: typeof LLM_HELPERS_SCHEMA_VERSION;
  generated_at: string;
  helper: LlmHelperName;
  status: "disabled";
  confidence: 0;
  citations: LlmCandidateCitation[];
  rationale: string;
  provider_request_id: null;
  model: null;
  fact_write_allowed: false;
} {
  const disabledByEnv = process.env["SUPPLYSTRATA_LLM_DISABLED"] === "1";
  return {
    schema_version: LLM_HELPERS_SCHEMA_VERSION,
    generated_at: options.generated_at ?? new Date().toISOString(),
    helper,
    status: "disabled",
    confidence: 0,
    citations: [],
    rationale: disabledByEnv
      ? "SUPPLYSTRATA_LLM_DISABLED=1 disables all LLM helper calls."
      : "LLM helper is disabled, unavailable, or not implemented in this skeleton; returning an empty candidate.",
    provider_request_id: null,
    model: null,
    fact_write_allowed: false
  };
}

export function providerMetadata(response: LlmProviderJsonResponse): Pick<LlmProviderJsonResponse, "provider_request_id" | "model"> {
  return {
    provider_request_id: response.provider_request_id,
    model: response.model
  };
}
