import {
  buildAiProviderStatus,
  createOpenAiCompatibleJsonProvider,
  type AiAnalysisProvider,
  type AiProviderConfigInput,
  type LlmHelperOptions
} from "@supplystrata/llm-helpers";

export interface AgentCliProviderInput {
  readonly provider: AiAnalysisProvider;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly generatedAt: string;
}

export function agentLlmOptions(input: AgentCliProviderInput): LlmHelperOptions {
  if (input.provider === "none") return { disabled: true, generated_at: input.generatedAt };
  const providerStatus = buildAiProviderStatus(providerConfigInput(input), input.generatedAt);
  if (providerStatus.status !== "ready") throw new Error(providerStatus.status_reason);
  const apiKey = providerApiKey(input);
  if (apiKey === undefined) throw new Error(`LLM provider ${input.provider} requires an API key.`);
  return {
    provider: createOpenAiCompatibleJsonProvider({
      provider: providerStatus,
      api_key: apiKey,
      ...(input.baseUrl === undefined ? {} : { base_url: input.baseUrl })
    }),
    generated_at: input.generatedAt
  };
}

function providerConfigInput(input: AgentCliProviderInput): AiProviderConfigInput {
  return {
    LLM_PROVIDER: input.provider,
    ...(input.apiKey === undefined ? {} : { LLM_API_KEY: input.apiKey }),
    ...(input.baseUrl === undefined ? {} : { LLM_BASE_URL: input.baseUrl }),
    ...(input.model === undefined ? {} : { LLM_MODEL: input.model }),
    ...(process.env["OPENAI_API_KEY"] === undefined ? {} : { OPENAI_API_KEY: process.env["OPENAI_API_KEY"] }),
    ...(process.env["ANTHROPIC_API_KEY"] === undefined ? {} : { ANTHROPIC_API_KEY: process.env["ANTHROPIC_API_KEY"] }),
    ...(process.env["DEEPSEEK_API_KEY"] === undefined ? {} : { DEEPSEEK_API_KEY: process.env["DEEPSEEK_API_KEY"] }),
    ...(process.env["LLM_API_KEY"] === undefined || input.apiKey !== undefined ? {} : { LLM_API_KEY: process.env["LLM_API_KEY"] }),
    ...(process.env["LLM_BASE_URL"] === undefined || input.baseUrl !== undefined ? {} : { LLM_BASE_URL: process.env["LLM_BASE_URL"] }),
    ...(process.env["LLM_MODEL"] === undefined || input.model !== undefined ? {} : { LLM_MODEL: process.env["LLM_MODEL"] })
  };
}

function providerApiKey(input: AgentCliProviderInput): string | undefined {
  if (input.apiKey !== undefined && input.apiKey.trim().length > 0) return input.apiKey.trim();
  if (process.env["LLM_API_KEY"] !== undefined && process.env["LLM_API_KEY"].trim().length > 0) return process.env["LLM_API_KEY"].trim();
  if (input.provider === "openai" && process.env["OPENAI_API_KEY"] !== undefined && process.env["OPENAI_API_KEY"].trim().length > 0) {
    return process.env["OPENAI_API_KEY"].trim();
  }
  if (input.provider === "deepseek" && process.env["DEEPSEEK_API_KEY"] !== undefined && process.env["DEEPSEEK_API_KEY"].trim().length > 0) {
    return process.env["DEEPSEEK_API_KEY"].trim();
  }
  if (input.provider === "anthropic" && process.env["ANTHROPIC_API_KEY"] !== undefined && process.env["ANTHROPIC_API_KEY"].trim().length > 0) {
    return process.env["ANTHROPIC_API_KEY"].trim();
  }
  return undefined;
}
