import {
  LLM_HELPERS_SCHEMA_VERSION,
  type DeriveDynamicProfileCandidate,
  type DeriveDynamicProfileInput,
  type DerivedProfileComponent,
  type DisambiguateEntityCandidate,
  type DisambiguateEntityInput,
  type EntityDisambiguationCandidate,
  type LlmCandidateCitation,
  type LlmHelperCandidateStatus,
  type LlmHelperName,
  type LlmHelperOptions,
  type LlmProviderJsonResponse,
  type SuggestSourceTargetsCandidate,
  type SuggestSourceTargetsInput,
  type SuggestedSourceTarget,
  type SummarizeWithCitationsCandidate,
  type SummarizeWithCitationsInput
} from "./definitions.js";

const PROMPTS: Record<LlmHelperName, { prompt_version: string; user: string }> = {
  disambiguate_entity: {
    prompt_version: "disambiguate_entity.v1",
    user: [
      "Rank only the provided candidate entities for the supplied surface form.",
      "Return JSON with confidence, rationale, citations, and ranked_candidates.",
      "Do not invent entity ids or write facts."
    ].join("\n")
  },
  derive_dynamic_profile: {
    prompt_version: "derive_dynamic_profile.v1",
    user: [
      "Suggest a dynamic research profile from the provided company context.",
      "Return JSON with confidence, rationale, citations, expected_upstream_components, and source_targets.",
      "Every citation source_ref must come from input.source_refs when citations are present."
    ].join("\n")
  },
  suggest_source_targets: {
    prompt_version: "suggest_source_targets.v1",
    user: [
      "Suggest source targets for unresolved supply-chain research context.",
      "Return JSON with confidence, rationale, citations, and source_targets.",
      "Do not claim that any target has already been fetched or verified."
    ].join("\n")
  },
  summarize_with_citations: {
    prompt_version: "summarize_with_citations.v1",
    user: [
      "Summarize the answer using only the provided evidence snippets.",
      "Return JSON with confidence, rationale, citations, summary, and cited_evidence_ids.",
      "Every cited_evidence_id and citation source_ref must exist in input.evidence."
    ].join("\n")
  }
};

const SYSTEM_PROMPT = [
  "You are a SupplyStrata read-only LLM helper.",
  "Return only JSON matching the requested helper output.",
  "All outputs are candidates, not facts.",
  "Never write edges, evidence, claims, observations, review decisions, source jobs, or truth-store records.",
  "Use only citation refs supplied by the helper input."
].join("\n");

export async function disambiguate_entity(input: DisambiguateEntityInput, options: LlmHelperOptions = {}): Promise<DisambiguateEntityCandidate> {
  const disabled = maybeDisabledCandidate("disambiguate_entity", options);
  if (disabled !== null) return { ...disabled, helper: "disambiguate_entity", ranked_candidates: [] };

  const inputErrors = validateDisambiguateEntityInput(input);
  if (inputErrors.length > 0) {
    return {
      ...candidateBase("disambiguate_entity", "invalid_input", options, null, null, 0, inputErrors.join("; "), []),
      helper: "disambiguate_entity",
      ranked_candidates: []
    };
  }

  const response = await completeHelper("disambiguate_entity", input, options);
  if ("candidate" in response) return { ...response.candidate, helper: "disambiguate_entity", ranked_candidates: [] };

  const parsed = parseDisambiguateOutput(response.output, new Set(input.candidates.map((candidate) => candidate.entity_id)));
  if (parsed.errors.length > 0) {
    return {
      ...invalidOutputCandidate("disambiguate_entity", options, response, parsed.errors, { ranked_candidates: [] }),
      helper: "disambiguate_entity"
    };
  }
  return {
    ...candidateBase(
      "disambiguate_entity",
      candidateStatusFromConfidence(parsed.common.confidence),
      options,
      response.provider_request_id,
      response.model,
      parsed.common.confidence,
      parsed.common.rationale,
      parsed.common.citations
    ),
    helper: "disambiguate_entity",
    ranked_candidates: parsed.ranked_candidates
  };
}

export async function derive_dynamic_profile(input: DeriveDynamicProfileInput, options: LlmHelperOptions = {}): Promise<DeriveDynamicProfileCandidate> {
  const disabled = maybeDisabledCandidate("derive_dynamic_profile", options);
  if (disabled !== null) return { ...disabled, helper: "derive_dynamic_profile", expected_upstream_components: [], source_targets: [] };

  const inputErrors = validateDeriveDynamicProfileInput(input);
  if (inputErrors.length > 0) {
    return {
      ...candidateBase("derive_dynamic_profile", "invalid_input", options, null, null, 0, inputErrors.join("; "), []),
      helper: "derive_dynamic_profile",
      expected_upstream_components: [],
      source_targets: []
    };
  }

  const response = await completeHelper("derive_dynamic_profile", input, options);
  if ("candidate" in response) return { ...response.candidate, helper: "derive_dynamic_profile", expected_upstream_components: [], source_targets: [] };

  const parsed = parseDeriveDynamicProfileOutput(response.output, new Set(input.source_refs ?? []));
  if (parsed.errors.length > 0) {
    return {
      ...invalidOutputCandidate("derive_dynamic_profile", options, response, parsed.errors, {
        expected_upstream_components: [],
        source_targets: []
      }),
      helper: "derive_dynamic_profile"
    };
  }
  return {
    ...candidateBase(
      "derive_dynamic_profile",
      candidateStatusFromConfidence(parsed.common.confidence),
      options,
      response.provider_request_id,
      response.model,
      parsed.common.confidence,
      parsed.common.rationale,
      parsed.common.citations
    ),
    helper: "derive_dynamic_profile",
    expected_upstream_components: parsed.expected_upstream_components,
    source_targets: parsed.source_targets
  };
}

export async function suggest_source_targets(input: SuggestSourceTargetsInput, options: LlmHelperOptions = {}): Promise<SuggestSourceTargetsCandidate> {
  const disabled = maybeDisabledCandidate("suggest_source_targets", options);
  if (disabled !== null) return { ...disabled, helper: "suggest_source_targets", source_targets: [] };

  const inputErrors = validateSuggestSourceTargetsInput(input);
  if (inputErrors.length > 0) {
    return {
      ...candidateBase("suggest_source_targets", "invalid_input", options, null, null, 0, inputErrors.join("; "), []),
      helper: "suggest_source_targets",
      source_targets: []
    };
  }

  const response = await completeHelper("suggest_source_targets", input, options);
  if ("candidate" in response) return { ...response.candidate, helper: "suggest_source_targets", source_targets: [] };

  const allowedRefs = new Set([...input.current_coverage_refs, ...input.unknown_context, ...(input.source_refs ?? [])]);
  const parsed = parseSuggestSourceTargetsOutput(response.output, allowedRefs);
  if (parsed.errors.length > 0) {
    return {
      ...invalidOutputCandidate("suggest_source_targets", options, response, parsed.errors, { source_targets: [] }),
      helper: "suggest_source_targets"
    };
  }
  return {
    ...candidateBase(
      "suggest_source_targets",
      candidateStatusFromConfidence(parsed.common.confidence),
      options,
      response.provider_request_id,
      response.model,
      parsed.common.confidence,
      parsed.common.rationale,
      parsed.common.citations
    ),
    helper: "suggest_source_targets",
    source_targets: parsed.source_targets
  };
}

export async function summarize_with_citations(input: SummarizeWithCitationsInput, options: LlmHelperOptions = {}): Promise<SummarizeWithCitationsCandidate> {
  const disabled = maybeDisabledCandidate("summarize_with_citations", options);
  if (disabled !== null) return { ...disabled, helper: "summarize_with_citations", summary: "", cited_evidence_ids: [] };

  const inputErrors = validateSummarizeWithCitationsInput(input);
  if (inputErrors.length > 0) {
    return {
      ...candidateBase("summarize_with_citations", "invalid_input", options, null, null, 0, inputErrors.join("; "), []),
      helper: "summarize_with_citations",
      summary: "",
      cited_evidence_ids: []
    };
  }

  const response = await completeHelper("summarize_with_citations", input, options);
  if ("candidate" in response) return { ...response.candidate, helper: "summarize_with_citations", summary: "", cited_evidence_ids: [] };

  const allowedEvidenceIds = new Set(input.evidence.map((item) => item.evidence_id));
  const parsed = parseSummarizeWithCitationsOutput(response.output, allowedEvidenceIds);
  if (parsed.errors.length > 0) {
    return {
      ...invalidOutputCandidate("summarize_with_citations", options, response, parsed.errors, {
        summary: "",
        cited_evidence_ids: []
      }),
      helper: "summarize_with_citations"
    };
  }
  return {
    ...candidateBase(
      "summarize_with_citations",
      candidateStatusFromConfidence(parsed.common.confidence),
      options,
      response.provider_request_id,
      response.model,
      parsed.common.confidence,
      parsed.common.rationale,
      parsed.common.citations
    ),
    helper: "summarize_with_citations",
    summary: parsed.summary,
    cited_evidence_ids: parsed.cited_evidence_ids
  };
}

function maybeDisabledCandidate(helper: LlmHelperName, options: LlmHelperOptions): ReturnType<typeof candidateBase> | null {
  const disabledByEnv = process.env["SUPPLYSTRATA_LLM_DISABLED"] === "1";
  if (!disabledByEnv && options.disabled !== true && options.provider !== undefined) return null;
  return candidateBase(
    helper,
    "disabled",
    options,
    null,
    null,
    0,
    disabledByEnv
      ? "SUPPLYSTRATA_LLM_DISABLED=1 disables all LLM helper calls."
      : "LLM helper is disabled or no provider was supplied; returning an empty candidate.",
    []
  );
}

async function completeHelper(
  helper: LlmHelperName,
  input: DisambiguateEntityInput | DeriveDynamicProfileInput | SuggestSourceTargetsInput | SummarizeWithCitationsInput,
  options: LlmHelperOptions
): Promise<LlmProviderJsonResponse | { candidate: ReturnType<typeof candidateBase> }> {
  const provider = options.provider;
  if (provider === undefined) {
    return { candidate: candidateBase(helper, "disabled", options, null, null, 0, "LLM helper is disabled or no provider was supplied.", []) };
  }
  try {
    const prompt = PROMPTS[helper];
    return await provider.completeJson({
      helper,
      prompt_version: prompt.prompt_version,
      prompt: {
        system: SYSTEM_PROMPT,
        user: prompt.user
      },
      input: helperInputRecord(input)
    });
  } catch (error) {
    return {
      candidate: candidateBase(helper, "provider_error", options, null, null, 0, providerErrorReason(error), [])
    };
  }
}

function invalidOutputCandidate<T extends object>(
  helper: LlmHelperName,
  options: LlmHelperOptions,
  response: LlmProviderJsonResponse,
  errors: readonly string[],
  payload: T
): ReturnType<typeof candidateBase> & T {
  return {
    ...candidateBase(helper, "invalid_output", options, response.provider_request_id, response.model, 0, errors.join("; "), []),
    ...payload
  };
}

function candidateBase(
  helper: LlmHelperName,
  status: LlmHelperCandidateStatus,
  options: LlmHelperOptions,
  providerRequestId: string | null,
  model: string | null,
  confidence: number,
  rationale: string,
  citations: LlmCandidateCitation[]
): {
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
} {
  return {
    schema_version: LLM_HELPERS_SCHEMA_VERSION,
    generated_at: options.generated_at ?? new Date().toISOString(),
    helper,
    status,
    confidence,
    citations,
    rationale,
    provider_request_id: providerRequestId,
    model,
    fact_write_allowed: false
  };
}

function parseDisambiguateOutput(
  output: Record<string, unknown>,
  allowedEntityIds: ReadonlySet<string>
): {
  errors: string[];
  common: CommonOutput;
  ranked_candidates: EntityDisambiguationCandidate[];
} {
  const errors: string[] = [];
  const common = commonOutput(output, allowedEntityIds, errors);
  const rankedCandidates = arrayField(output["ranked_candidates"], "ranked_candidates", errors).map((item, index) => {
    const record = recordField(item, `ranked_candidates[${index}]`, errors);
    const entityId = record === null ? "" : stringField(record["entity_id"], `ranked_candidates[${index}].entity_id`, errors);
    if (entityId.length > 0 && !allowedEntityIds.has(entityId)) errors.push(`ranked_candidates[${index}].entity_id must come from input.candidates`);
    return {
      entity_id: entityId,
      label: record === null ? "" : stringField(record["label"], `ranked_candidates[${index}].label`, errors),
      confidence: record === null ? 0 : confidenceField(record["confidence"], `ranked_candidates[${index}].confidence`, errors),
      reason: record === null ? "" : stringField(record["reason"], `ranked_candidates[${index}].reason`, errors)
    };
  });
  return { errors, common, ranked_candidates: rankedCandidates };
}

function parseDeriveDynamicProfileOutput(
  output: Record<string, unknown>,
  allowedRefs: ReadonlySet<string>
): {
  errors: string[];
  common: CommonOutput;
  expected_upstream_components: DerivedProfileComponent[];
  source_targets: SuggestedSourceTarget[];
} {
  const errors: string[] = [];
  const common = commonOutput(output, allowedRefs, errors);
  return {
    errors,
    common,
    expected_upstream_components: derivedProfileComponents(output["expected_upstream_components"], errors),
    source_targets: suggestedSourceTargets(output["source_targets"], errors)
  };
}

function parseSuggestSourceTargetsOutput(
  output: Record<string, unknown>,
  allowedRefs: ReadonlySet<string>
): {
  errors: string[];
  common: CommonOutput;
  source_targets: SuggestedSourceTarget[];
} {
  const errors: string[] = [];
  const common = commonOutput(output, allowedRefs, errors);
  return {
    errors,
    common,
    source_targets: suggestedSourceTargets(output["source_targets"], errors)
  };
}

function parseSummarizeWithCitationsOutput(
  output: Record<string, unknown>,
  allowedEvidenceIds: ReadonlySet<string>
): {
  errors: string[];
  common: CommonOutput;
  summary: string;
  cited_evidence_ids: string[];
} {
  const errors: string[] = [];
  const common = commonOutput(output, allowedEvidenceIds, errors);
  const citedEvidenceIds = stringArrayField(output["cited_evidence_ids"], "cited_evidence_ids", errors);
  for (const [index, evidenceId] of citedEvidenceIds.entries()) {
    if (!allowedEvidenceIds.has(evidenceId)) errors.push(`cited_evidence_ids[${index}] must come from input.evidence`);
  }
  return {
    errors,
    common,
    summary: stringField(output["summary"], "summary", errors),
    cited_evidence_ids: citedEvidenceIds
  };
}

interface CommonOutput {
  confidence: number;
  rationale: string;
  citations: LlmCandidateCitation[];
}

function commonOutput(output: Record<string, unknown>, allowedRefs: ReadonlySet<string>, errors: string[]): CommonOutput {
  return {
    confidence: confidenceField(output["confidence"], "confidence", errors),
    rationale: stringField(output["rationale"], "rationale", errors),
    citations: citationsField(output["citations"], allowedRefs, errors)
  };
}

function citationsField(value: unknown, allowedRefs: ReadonlySet<string>, errors: string[]): LlmCandidateCitation[] {
  return arrayField(value, "citations", errors).map((item, index) => {
    const record = recordField(item, `citations[${index}]`, errors);
    const sourceRef = record === null ? "" : stringField(record["source_ref"], `citations[${index}].source_ref`, errors);
    if (sourceRef.length > 0 && !allowedRefs.has(sourceRef)) errors.push(`citations[${index}].source_ref must come from helper input`);
    const citeText = record === null ? undefined : optionalStringField(record["cite_text"], `citations[${index}].cite_text`, errors);
    return citeText === undefined
      ? {
          source_ref: sourceRef
        }
      : {
          source_ref: sourceRef,
          cite_text: citeText
        };
  });
}

function derivedProfileComponents(value: unknown, errors: string[]): DerivedProfileComponent[] {
  return arrayField(value, "expected_upstream_components", errors).map((item, index) => {
    const record = recordField(item, `expected_upstream_components[${index}]`, errors);
    const componentId =
      record === null ? undefined : optionalStringField(record["component_id"], `expected_upstream_components[${index}].component_id`, errors);
    return {
      ...(componentId === undefined ? {} : { component_id: componentId }),
      label: record === null ? "" : stringField(record["label"], `expected_upstream_components[${index}].label`, errors),
      rationale: record === null ? "" : stringField(record["rationale"], `expected_upstream_components[${index}].rationale`, errors)
    };
  });
}

function suggestedSourceTargets(value: unknown, errors: string[]): SuggestedSourceTarget[] {
  return arrayField(value, "source_targets", errors).map((item, index) => {
    const record = recordField(item, `source_targets[${index}]`, errors);
    return {
      source_adapter_id: record === null ? "" : stringField(record["source_adapter_id"], `source_targets[${index}].source_adapter_id`, errors),
      target_ref: record === null ? "" : stringField(record["target_ref"], `source_targets[${index}].target_ref`, errors),
      rationale: record === null ? "" : stringField(record["rationale"], `source_targets[${index}].rationale`, errors)
    };
  });
}

function validateDisambiguateEntityInput(input: DisambiguateEntityInput): string[] {
  const errors: string[] = [];
  if (input.surface.trim().length === 0) errors.push("surface must be non-empty");
  if (input.candidates.length === 0) errors.push("candidates must contain at least one candidate");
  for (const [index, candidate] of input.candidates.entries()) {
    if (candidate.entity_id.trim().length === 0) errors.push(`candidates[${index}].entity_id must be non-empty`);
    if (candidate.label.trim().length === 0) errors.push(`candidates[${index}].label must be non-empty`);
    if (!isConfidence(candidate.confidence)) errors.push(`candidates[${index}].confidence must be between 0 and 1`);
    if (candidate.reason.trim().length === 0) errors.push(`candidates[${index}].reason must be non-empty`);
  }
  return errors;
}

function validateDeriveDynamicProfileInput(input: DeriveDynamicProfileInput): string[] {
  const errors: string[] = [];
  if (input.company_id.trim().length === 0) errors.push("company_id must be non-empty");
  if (input.company_name.trim().length === 0) errors.push("company_name must be non-empty");
  return errors;
}

function validateSuggestSourceTargetsInput(input: SuggestSourceTargetsInput): string[] {
  const errors: string[] = [];
  if (input.company_id.trim().length === 0) errors.push("company_id must be non-empty");
  return errors;
}

function validateSummarizeWithCitationsInput(input: SummarizeWithCitationsInput): string[] {
  const errors: string[] = [];
  if (input.question.trim().length === 0) errors.push("question must be non-empty");
  if (input.evidence.length === 0) errors.push("evidence must contain at least one item");
  const evidenceIds = new Set<string>();
  for (const [index, evidence] of input.evidence.entries()) {
    if (evidence.evidence_id.trim().length === 0) errors.push(`evidence[${index}].evidence_id must be non-empty`);
    if (evidence.cite_text.trim().length === 0) errors.push(`evidence[${index}].cite_text must be non-empty`);
    if (evidenceIds.has(evidence.evidence_id)) errors.push(`evidence[${index}].evidence_id must be unique`);
    evidenceIds.add(evidence.evidence_id);
  }
  return errors;
}

function helperInputRecord(
  input: DisambiguateEntityInput | DeriveDynamicProfileInput | SuggestSourceTargetsInput | SummarizeWithCitationsInput
): Record<string, unknown> {
  return { ...input };
}

function recordField(value: unknown, label: string, errors: string[]): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  errors.push(`${label} must be an object`);
  return null;
}

function arrayField(value: unknown, label: string, errors: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  errors.push(`${label} must be an array`);
  return [];
}

function stringField(value: unknown, label: string, errors: string[]): string {
  if (typeof value === "string" && value.trim().length > 0) return value;
  errors.push(`${label} must be a non-empty string`);
  return "";
}

function optionalStringField(value: unknown, label: string, errors: string[]): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim().length > 0) return value;
  errors.push(`${label} must be a non-empty string when present`);
  return undefined;
}

function stringArrayField(value: unknown, label: string, errors: string[]): string[] {
  return arrayField(value, label, errors).map((item, index) => stringField(item, `${label}[${index}]`, errors));
}

function confidenceField(value: unknown, label: string, errors: string[]): number {
  if (typeof value === "number" && isConfidence(value)) return value;
  errors.push(`${label} must be a number between 0 and 1`);
  return 0;
}

function isConfidence(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function candidateStatusFromConfidence(confidence: number): "candidate" | "deferred" {
  return confidence < 0.5 ? "deferred" : "candidate";
}

function providerErrorReason(error: unknown): string {
  return error instanceof Error ? `LLM provider failed: ${error.message}` : "LLM provider failed with a non-Error value.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function providerMetadata(response: LlmProviderJsonResponse): Pick<LlmProviderJsonResponse, "provider_request_id" | "model"> {
  return {
    provider_request_id: response.provider_request_id,
    model: response.model
  };
}
