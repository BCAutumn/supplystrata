import { createHash } from "node:crypto";
import type { AiAnalysisArtifact, AiAnalysisProvider, AiProviderStatusReport, BuildProviderAiAnalysisArtifactFromUnknownInput } from "./definitions.js";
import { buildLocalAiAnalysisArtifactFromUnknown } from "./local-simulated-analysis.js";
import { validateAiAnalysisArtifact } from "./artifact-validation.js";

const DEFAULT_OPENAI_COMPATIBLE_BASE_URLS: Record<"openai" | "deepseek", string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com"
};

export async function buildProviderAiAnalysisArtifactFromUnknown(input: BuildProviderAiAnalysisArtifactFromUnknownInput): Promise<AiAnalysisArtifact> {
  if (input.provider.status !== "ready") {
    throw new Error(`AI provider is not ready: ${input.provider.status_reason}`);
  }
  if (!isOpenAiCompatibleProvider(input.provider.provider)) {
    throw new Error(`AI provider ${input.provider.provider} is not supported by the OpenAI-compatible adapter yet.`);
  }
  const model = input.provider.model;
  if (model === null || model.trim().length === 0) throw new Error("AI provider model is required for provider mode.");

  const baseline = buildLocalAiAnalysisArtifactFromUnknown(input);
  const baseUrl = openAiCompatibleBaseUrl(input.provider.provider, input.base_url);
  const payload = openAiCompatiblePayload({
    model,
    baseline,
    manifest: input.manifest,
    consumer_read_model: input.consumer_read_model,
    reasoning_walkthrough: input.reasoning_walkthrough
  });
  const response = await postOpenAiCompatibleJson({
    url: `${baseUrl}/chat/completions`,
    api_key: input.api_key,
    timeout_ms: input.timeout_ms ?? 120000,
    payload
  });
  const content = firstChoiceContent(response);
  const parsed = parseJsonObject(content);
  const artifact = providerArtifactFromModelOutput({
    parsed,
    baseline,
    provider: input.provider,
    provider_request_id: response.id ?? null
  });
  const validation = validateAiAnalysisArtifact({
    artifact,
    allowed_refs: baseline.model_metadata.input_refs
  });
  if (!validation.ok) {
    throw new Error(`AI provider output failed guardrail validation: ${validation.errors.join("; ")}`);
  }
  return validation.artifact;
}

function openAiCompatiblePayload(input: {
  model: string;
  baseline: AiAnalysisArtifact;
  manifest: unknown;
  consumer_read_model: unknown;
  reasoning_walkthrough: unknown;
}): OpenAiCompatibleChatRequest {
  return {
    model: input.model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You are SupplyStrata's internal read-only AI analyst.",
          "Return only valid JSON. Do not wrap it in Markdown.",
          "Do not create facts, evidence, claims, observations, review decisions, source targets, or source jobs.",
          "Do not recommend autonomous web search, crawling, or connector execution.",
          "Use only refs listed in baseline.model_metadata.input_refs and next_human_actions.refs.",
          "If evidence is insufficient, put the limitation in cannot_conclude."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            task: "Produce a polished Chinese ai_analysis_artifact.v1 JSON object for the report. Keep the exact schema shape from baseline. Improve narrative quality using the provided context, while preserving all guardrails.",
            output_rules: {
              schema_version: "1.0.0",
              mode: "provider_ai_v0",
              node_id: "company_context_explanation_v0",
              policy: {
                fact_mutation_allowed: false,
                agent_behavior_allowed: false,
                source_connector_allowed: false
              },
              prompt_version: "company_context_explanation.openai_compatible.v0",
              output_schema_id: "ai_analysis_artifact.v1",
              simulated: false,
              refs_must_be_subset_of: input.baseline.model_metadata.input_refs
            },
            baseline: input.baseline,
            context: {
              manifest: input.manifest,
              consumer_read_model: input.consumer_read_model,
              reasoning_walkthrough: input.reasoning_walkthrough
            }
          },
          null,
          2
        )
      }
    ]
  };
}

function providerArtifactFromModelOutput(input: {
  parsed: Record<string, unknown>;
  baseline: AiAnalysisArtifact;
  provider: AiProviderStatusReport;
  provider_request_id: string | null;
}): AiAnalysisArtifact {
  return {
    ...input.baseline,
    ...input.parsed,
    schema_version: "1.0.0",
    generated_at: input.baseline.generated_at,
    mode: "provider_ai_v0",
    scope_id: input.baseline.scope_id,
    node_id: "company_context_explanation_v0",
    provider: input.provider.provider,
    model: input.provider.model,
    policy: {
      fact_mutation_allowed: false,
      agent_behavior_allowed: false,
      source_connector_allowed: false
    },
    model_metadata: {
      provider_request_id: input.provider_request_id,
      prompt_version: "company_context_explanation.openai_compatible.v0",
      input_contracts: input.baseline.model_metadata.input_contracts,
      input_refs: input.baseline.model_metadata.input_refs,
      output_schema_id: "ai_analysis_artifact.v1",
      simulated: false
    }
  };
}

async function postOpenAiCompatibleJson(input: {
  url: string;
  api_key: string;
  timeout_ms: number;
  payload: OpenAiCompatibleChatRequest;
}): Promise<OpenAiCompatibleChatResponse> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), input.timeout_ms);
  try {
    const response = await fetch(input.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.api_key}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(input.payload),
      signal: abort.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`AI provider request failed with HTTP ${response.status}: ${safeProviderError(text)}`);
    return parseOpenAiCompatibleResponse(text);
  } finally {
    clearTimeout(timeout);
  }
}

function firstChoiceContent(response: OpenAiCompatibleChatResponse): string {
  const first = response.choices[0];
  if (first === undefined) throw new Error("AI provider returned no choices.");
  return first.message.content;
}

function parseOpenAiCompatibleResponse(text: string): OpenAiCompatibleChatResponse {
  const value = parseJsonObject(text);
  const choicesValue = value["choices"];
  if (!Array.isArray(choicesValue)) throw new Error("AI provider response is missing choices.");
  const choices = choicesValue.map((choice, index) => {
    const choiceRecord = requireRecord(choice, `choices[${index}]`);
    const message = requireRecord(choiceRecord["message"], `choices[${index}].message`);
    return {
      message: {
        content: requireString(message["content"], `choices[${index}].message.content`)
      }
    };
  });
  return {
    id: typeof value["id"] === "string" ? value["id"] : null,
    choices
  };
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(stripJsonFence(text));
  return requireRecord(parsed, "json");
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```json") && trimmed.endsWith("```")) return trimmed.slice(7, -3).trim();
  if (trimmed.startsWith("```") && trimmed.endsWith("```")) return trimmed.slice(3, -3).trim();
  return trimmed;
}

function safeProviderError(text: string): string {
  return text.slice(0, 800).replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]");
}

function openAiCompatibleBaseUrl(provider: AiAnalysisProvider, configured: string | undefined): string {
  const value = configured?.trim();
  if (value !== undefined && value.length > 0) return value.replace(/\/+$/, "");
  if (provider === "openai" || provider === "deepseek") return DEFAULT_OPENAI_COMPATIBLE_BASE_URLS[provider];
  throw new Error(`LLM_BASE_URL is required for provider ${provider}.`);
}

function isOpenAiCompatibleProvider(provider: AiAnalysisProvider): provider is "openai" | "deepseek" | "custom" {
  return provider === "openai" || provider === "deepseek" || provider === "custom";
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Invalid ${label}: expected object`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`Invalid ${label}: expected non-empty string`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function aiAnalysisPromptSha256(artifact: AiAnalysisArtifact): string {
  return createHash("sha256").update(JSON.stringify(artifact.model_metadata)).digest("hex");
}

interface OpenAiCompatibleChatRequest {
  model: string;
  temperature: number;
  response_format: {
    type: "json_object";
  };
  messages: OpenAiCompatibleChatMessage[];
}

interface OpenAiCompatibleChatMessage {
  role: "system" | "user";
  content: string;
}

interface OpenAiCompatibleChatResponse {
  id: string | null;
  choices: OpenAiCompatibleChoice[];
}

interface OpenAiCompatibleChoice {
  message: {
    content: string;
  };
}
