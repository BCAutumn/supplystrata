import type { AiAnalysisProvider, AiAnalysisProviderStatus, AiProviderConfigInput, AiProviderStatusReport } from "./definitions.js";
import { AI_ANALYSIS_SCHEMA_VERSION } from "./definitions.js";

const PROVIDER_API_KEY_ENV_KEYS: Record<Exclude<AiAnalysisProvider, "none">, string[]> = {
  openai: ["LLM_API_KEY", "OPENAI_API_KEY"],
  anthropic: ["LLM_API_KEY", "ANTHROPIC_API_KEY"],
  deepseek: ["LLM_API_KEY", "DEEPSEEK_API_KEY"],
  custom: ["LLM_API_KEY"]
};

const DEFAULT_MODELS: Record<Exclude<AiAnalysisProvider, "none">, string> = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-3-5-haiku-latest",
  deepseek: "deepseek-chat",
  custom: "custom-model"
};

export function buildAiProviderStatus(input: AiProviderConfigInput, generatedAt: string): AiProviderStatusReport {
  if (input.LLM_PROVIDER === "none") {
    return {
      schema_version: AI_ANALYSIS_SCHEMA_VERSION,
      generated_at: generatedAt,
      provider: "none",
      status: "disabled",
      model: null,
      base_url_configured: false,
      api_key_configured: false,
      external_configuration: {
        api_key_env_keys: [],
        base_url_env_key: "LLM_BASE_URL",
        model_env_key: "LLM_MODEL"
      },
      safety: {
        secret_fields_redacted: true,
        network_call_allowed: false,
        truth_store_write_allowed: false
      },
      status_reason: "LLM_PROVIDER is none, so internal AI analysis nodes are disabled."
    };
  }

  const apiKeyConfigured = providerApiKey(input) !== undefined;
  const baseUrlConfigured = input.LLM_BASE_URL !== undefined && input.LLM_BASE_URL.trim().length > 0;
  const status = providerStatus(input.LLM_PROVIDER, apiKeyConfigured, baseUrlConfigured);
  return {
    schema_version: AI_ANALYSIS_SCHEMA_VERSION,
    generated_at: generatedAt,
    provider: input.LLM_PROVIDER,
    status,
    model: normalizedOptional(input.LLM_MODEL) ?? DEFAULT_MODELS[input.LLM_PROVIDER],
    base_url_configured: baseUrlConfigured,
    api_key_configured: apiKeyConfigured,
    external_configuration: {
      api_key_env_keys: PROVIDER_API_KEY_ENV_KEYS[input.LLM_PROVIDER],
      base_url_env_key: "LLM_BASE_URL",
      model_env_key: "LLM_MODEL"
    },
    safety: {
      secret_fields_redacted: true,
      network_call_allowed: status === "ready",
      truth_store_write_allowed: false
    },
    status_reason: providerStatusReason(input.LLM_PROVIDER, status)
  };
}

function providerStatus(provider: Exclude<AiAnalysisProvider, "none">, apiKeyConfigured: boolean, baseUrlConfigured: boolean): AiAnalysisProviderStatus {
  if (!apiKeyConfigured) return "missing_api_key";
  if (provider === "custom" && !baseUrlConfigured) return "missing_base_url";
  return "ready";
}

function providerStatusReason(provider: Exclude<AiAnalysisProvider, "none">, status: AiAnalysisProviderStatus): string {
  if (status === "ready") return "Provider configuration is sufficient for a future explicit AI analysis invocation.";
  if (status === "missing_base_url") return `${provider} requires LLM_BASE_URL because there is no built-in custom endpoint.`;
  if (status === "missing_api_key") return `${provider} requires a configured API key before internal AI analysis can run.`;
  return "Internal AI analysis is disabled.";
}

function providerApiKey(input: AiProviderConfigInput): string | undefined {
  if (input.LLM_PROVIDER === "none") return undefined;
  if (normalizedOptional(input.LLM_API_KEY) !== undefined) return normalizedOptional(input.LLM_API_KEY);
  if (input.LLM_PROVIDER === "openai") return normalizedOptional(input.OPENAI_API_KEY);
  if (input.LLM_PROVIDER === "anthropic") return normalizedOptional(input.ANTHROPIC_API_KEY);
  if (input.LLM_PROVIDER === "deepseek") return normalizedOptional(input.DEEPSEEK_API_KEY);
  return undefined;
}

function normalizedOptional(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
