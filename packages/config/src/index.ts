import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

export const envSchema = z.object({
  POSTGRES_URL: z.string().url().default("postgres://supplystrata:dev@localhost:5432/supplystrata"),
  NEO4J_URI: z.string().default("bolt://localhost:7687"),
  NEO4J_USER: z.string().default("neo4j"),
  NEO4J_PASSWORD: z.string().default("devpassword"),
  OBJECT_STORE_FS_BASE: z.string().default("./data/raw"),
  SEC_USER_AGENT: z.string().min(8).default("SupplyStrata MVP contact@example.com"),
  LLM_PROVIDER: z.enum(["none", "openai", "anthropic", "deepseek", "custom"]).default("none"),
  LLM_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.string().url().optional(),
  LLM_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  SUPPLYSTRATA_SOURCE_CREDENTIALS_FILE: z.string().optional(),
  OPENDART_API_KEY: z.string().optional(),
  EDINET_API_KEY: z.string().optional(),
  OPEN_CORPORATES_API_TOKEN: z.string().optional(),
  COMPANIES_HOUSE_API_KEY: z.string().optional(),
  CENSUS_API_KEY: z.string().optional(),
  OSH_API_TOKEN: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info")
});

export type Env = z.infer<typeof envSchema>;

export type SourceCredentialEnvKey =
  | "OPENDART_API_KEY"
  | "EDINET_API_KEY"
  | "OPEN_CORPORATES_API_TOKEN"
  | "COMPANIES_HOUSE_API_KEY"
  | "CENSUS_API_KEY"
  | "OSH_API_TOKEN";

export interface SourceCredentialDefinition {
  env_key: SourceCredentialEnvKey;
  source_adapter_ids: readonly string[];
  description: string;
  required: true;
}

export interface SourceCredentialRequirementLike {
  env_key: string;
  description: string;
  required: boolean;
}

export const DEFAULT_SOURCE_CREDENTIALS_PATH = "config/source-credentials.local.json";

export const SOURCE_CREDENTIAL_DEFINITIONS: readonly SourceCredentialDefinition[] = [
  {
    env_key: "OPENDART_API_KEY",
    source_adapter_ids: ["dart-kr"],
    description: "OpenDART official API key used for Korean disclosure list monitoring.",
    required: true
  },
  {
    env_key: "EDINET_API_KEY",
    source_adapter_ids: ["edinet"],
    description: "Japan FSA EDINET API v2 key used for documents.json daily filing list monitoring.",
    required: true
  },
  {
    env_key: "OPEN_CORPORATES_API_TOKEN",
    source_adapter_ids: ["opencorporates"],
    description: "OpenCorporates API token used for entity resolution candidates.",
    required: true
  },
  {
    env_key: "COMPANIES_HOUSE_API_KEY",
    source_adapter_ids: ["companies-house"],
    description: "UK Companies House API key used for official entity registry lookup.",
    required: true
  },
  {
    env_key: "CENSUS_API_KEY",
    source_adapter_ids: ["census-trade"],
    description: "U.S. Census API key used for international trade observations.",
    required: true
  },
  {
    env_key: "OSH_API_TOKEN",
    source_adapter_ids: ["osh"],
    description: "Open Supply Hub API token used for facility search observations and review candidates.",
    required: true
  }
];

const sourceCredentialsFileSchema = z.object({
  schema_version: z.literal("1.0.0"),
  credentials: z.object({
    OPENDART_API_KEY: z.string().optional(),
    EDINET_API_KEY: z.string().optional(),
    OPEN_CORPORATES_API_TOKEN: z.string().optional(),
    COMPANIES_HOUSE_API_KEY: z.string().optional(),
    CENSUS_API_KEY: z.string().optional(),
    OSH_API_TOKEN: z.string().optional()
  })
});

export interface LoadEnvOptions {
  dotenvPath?: string;
  sourceCredentialsPath?: string;
}

export function loadEnv(options: LoadEnvOptions = {}): Env {
  loadDotEnvIfPresent(options.dotenvPath ?? ".env");
  loadSourceCredentialsIfPresent(options.sourceCredentialsPath ?? configuredSourceCredentialsPath());
  return envSchema.parse(process.env);
}

export function requireEnvValue(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required environment value: ${name}`);
  }
  return value;
}

export function requireSourceCredential(env: Env, key: SourceCredentialEnvKey): string {
  return requireEnvValue(env[key], key);
}

export function missingSourceCredentialRequirements<TRequirement extends SourceCredentialRequirementLike>(
  env: Env,
  requirements: readonly TRequirement[] | undefined
): TRequirement[] {
  if (requirements === undefined) return [];
  const missing: TRequirement[] = [];
  for (const requirement of requirements) {
    if (!requirement.required) continue;
    const value = sourceCredentialValue(env, requirement.env_key);
    if (value === undefined || value.trim().length === 0) missing.push(requirement);
  }
  return missing;
}

export function sourceCredentialRequirement(key: SourceCredentialEnvKey): Pick<SourceCredentialDefinition, "env_key" | "description" | "required"> {
  const definition = SOURCE_CREDENTIAL_DEFINITIONS.find((item) => item.env_key === key);
  if (definition === undefined) throw new Error(`Unknown source credential key: ${key}`);
  return { env_key: definition.env_key, description: definition.description, required: definition.required };
}

export function isSourceCredentialEnvKey(value: string): value is SourceCredentialEnvKey {
  return SOURCE_CREDENTIAL_DEFINITIONS.some((definition) => definition.env_key === value);
}

function sourceCredentialValue(env: Env, key: string): string | undefined {
  if (!isSourceCredentialEnvKey(key)) return undefined;
  return env[key];
}

function loadDotEnvIfPresent(path: string): void {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^"|"$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function loadSourceCredentialsIfPresent(path: string): void {
  if (!existsSync(path)) return;
  const parsedJson: unknown = JSON.parse(readFileSync(path, "utf8"));
  const parsed = sourceCredentialsFileSchema.parse(parsedJson);
  for (const definition of SOURCE_CREDENTIAL_DEFINITIONS) {
    const value = parsed.credentials[definition.env_key];
    if (value === undefined || value.trim().length === 0) continue;
    const current = process.env[definition.env_key];
    // 环境变量仍然拥有最高优先级；本地 credentials 文件只填补空白，方便宿主 App 统一托管 source key。
    if (current === undefined || current.trim().length === 0) process.env[definition.env_key] = value;
  }
}

function configuredSourceCredentialsPath(): string {
  const configured = process.env["SUPPLYSTRATA_SOURCE_CREDENTIALS_FILE"];
  if (configured === undefined || configured.trim().length === 0) return DEFAULT_SOURCE_CREDENTIALS_PATH;
  return configured;
}
