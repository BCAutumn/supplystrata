import {
  AI_ANALYSIS_SCHEMA_VERSION,
  type AiAnalysisArtifact,
  type AiAnalysisArtifactValidationInput,
  type AiAnalysisArtifactValidationResult
} from "./definitions.js";

export function validateAiAnalysisArtifact(input: AiAnalysisArtifactValidationInput): AiAnalysisArtifactValidationResult {
  const errors: string[] = [];
  const artifact = parseArtifact(input.artifact, errors);
  if (artifact === null) return { ok: false, errors };

  if (artifact.policy.fact_mutation_allowed !== false) errors.push("policy.fact_mutation_allowed must be false");
  if (artifact.policy.agent_behavior_allowed !== false) errors.push("policy.agent_behavior_allowed must be false");
  if (artifact.policy.source_connector_allowed !== false) errors.push("policy.source_connector_allowed must be false");
  if (artifact.model_metadata.output_schema_id !== "ai_analysis_artifact.v1") errors.push("model_metadata.output_schema_id must be ai_analysis_artifact.v1");
  if (artifact.headline.trim().length === 0) errors.push("headline must be non-empty");
  if (artifact.executive_summary.length === 0) errors.push("executive_summary must be non-empty");

  const allowedRefs = new Set(input.allowed_refs);
  for (const ref of refsUsedByArtifact(artifact)) {
    if (!allowedRefs.has(ref)) errors.push(`AI artifact references unknown input ref: ${ref}`);
  }

  return errors.length === 0 ? { ok: true, artifact } : { ok: false, errors };
}

function refsUsedByArtifact(artifact: AiAnalysisArtifact): string[] {
  return uniqueStrings([...artifact.referenced_refs, ...artifact.model_metadata.input_refs, ...artifact.next_human_actions.flatMap((item) => item.refs)]);
}

function parseArtifact(value: unknown, errors: string[]): AiAnalysisArtifact | null {
  const record = objectField(value, "artifact", errors);
  if (record === null) return null;
  const policy = objectField(record["policy"], "policy", errors);
  const modelMetadata = objectField(record["model_metadata"], "model_metadata", errors);
  const qualityLift = objectField(record["quality_lift"], "quality_lift", errors);
  if (policy === null || modelMetadata === null || qualityLift === null) return null;

  const artifact: AiAnalysisArtifact = {
    schema_version: literalField(record["schema_version"], "schema_version", AI_ANALYSIS_SCHEMA_VERSION, errors),
    generated_at: stringField(record["generated_at"], "generated_at", errors),
    mode: enumField(record["mode"], "mode", ["simulated_local_ai_v0", "provider_ai_v0"], errors),
    scope_id: stringField(record["scope_id"], "scope_id", errors),
    node_id: enumField(record["node_id"], "node_id", ["company_context_explanation_v0", "reasoning_walkthrough_explanation_v0"], errors),
    status: enumField(record["status"], "status", ["succeeded", "cannot_conclude", "blocked_missing_configuration", "failed"], errors),
    provider: enumField(record["provider"], "provider", ["none", "openai", "anthropic", "deepseek", "custom"], errors),
    model: nullableStringField(record["model"], "model", errors),
    policy: {
      fact_mutation_allowed: falseField(policy["fact_mutation_allowed"], "policy.fact_mutation_allowed", errors),
      agent_behavior_allowed: falseField(policy["agent_behavior_allowed"], "policy.agent_behavior_allowed", errors),
      source_connector_allowed: falseField(policy["source_connector_allowed"], "policy.source_connector_allowed", errors)
    },
    headline: stringField(record["headline"], "headline", errors),
    executive_summary: stringArrayField(record["executive_summary"], "executive_summary", errors),
    key_insights: insightArrayField(record["key_insights"], errors),
    evidence_boundaries: stringArrayField(record["evidence_boundaries"], "evidence_boundaries", errors),
    cannot_conclude: stringArrayField(record["cannot_conclude"], "cannot_conclude", errors),
    next_human_actions: humanActionArrayField(record["next_human_actions"], errors),
    open_unknowns: stringArrayField(record["open_unknowns"], "open_unknowns", errors),
    referenced_refs: stringArrayField(record["referenced_refs"], "referenced_refs", errors),
    assumptions: stringArrayField(record["assumptions"], "assumptions", errors),
    model_metadata: {
      provider_request_id: nullableStringField(modelMetadata["provider_request_id"], "model_metadata.provider_request_id", errors),
      prompt_version: enumField(
        modelMetadata["prompt_version"],
        "model_metadata.prompt_version",
        ["company_context_explanation.local.v0", "company_context_explanation.openai_compatible.v0"],
        errors
      ),
      input_contracts: stringArrayField(modelMetadata["input_contracts"], "model_metadata.input_contracts", errors),
      input_refs: stringArrayField(modelMetadata["input_refs"], "model_metadata.input_refs", errors),
      output_schema_id: literalField(modelMetadata["output_schema_id"], "model_metadata.output_schema_id", "ai_analysis_artifact.v1", errors),
      simulated: booleanField(modelMetadata["simulated"], "model_metadata.simulated", errors)
    },
    quality_lift: {
      before: stringField(qualityLift["before"], "quality_lift.before", errors),
      after: stringField(qualityLift["after"], "quality_lift.after", errors)
    }
  };
  return artifact;
}

function insightArrayField(value: unknown, errors: string[]): AiAnalysisArtifact["key_insights"] {
  return arrayField(value, "key_insights", errors).map((item, index) => {
    const record = objectField(item, `key_insights[${index}]`, errors);
    return {
      title: record === null ? "" : stringField(record["title"], `key_insights[${index}].title`, errors),
      body: record === null ? "" : stringField(record["body"], `key_insights[${index}].body`, errors)
    };
  });
}

function humanActionArrayField(value: unknown, errors: string[]): AiAnalysisArtifact["next_human_actions"] {
  return arrayField(value, "next_human_actions", errors).map((item, index) => {
    const record = objectField(item, `next_human_actions[${index}]`, errors);
    return {
      title: record === null ? "" : stringField(record["title"], `next_human_actions[${index}].title`, errors),
      action: record === null ? "" : stringField(record["action"], `next_human_actions[${index}].action`, errors),
      refs: record === null ? [] : stringArrayField(record["refs"], `next_human_actions[${index}].refs`, errors)
    };
  });
}

function objectField(value: unknown, label: string, errors: string[]): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  errors.push(`${label} must be an object`);
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayField(value: unknown, label: string, errors: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  errors.push(`${label} must be an array`);
  return [];
}

function stringField(value: unknown, label: string, errors: string[]): string {
  if (typeof value === "string") return value;
  errors.push(`${label} must be a string`);
  return "";
}

function nullableStringField(value: unknown, label: string, errors: string[]): string | null {
  if (value === null || typeof value === "string") return value;
  errors.push(`${label} must be a string or null`);
  return null;
}

function stringArrayField(value: unknown, label: string, errors: string[]): string[] {
  return arrayField(value, label, errors).map((item, index) => stringField(item, `${label}[${index}]`, errors));
}

function booleanField(value: unknown, label: string, errors: string[]): boolean {
  if (typeof value === "boolean") return value;
  errors.push(`${label} must be a boolean`);
  return false;
}

function falseField(value: unknown, label: string, errors: string[]): false {
  if (value === false) return false;
  errors.push(`${label} must be false`);
  return false;
}

function literalField<T extends string>(value: unknown, label: string, expected: T, errors: string[]): T {
  if (value === expected) return expected;
  errors.push(`${label} must be ${expected}`);
  return expected;
}

function enumField<T extends string>(value: unknown, label: string, allowed: readonly [T, ...T[]], errors: string[]): T {
  if (typeof value === "string") {
    const match = allowed.find((item) => item === value);
    if (match !== undefined) return match;
  }
  errors.push(`${label} must be one of ${allowed.join(", ")}`);
  return allowed[0];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
