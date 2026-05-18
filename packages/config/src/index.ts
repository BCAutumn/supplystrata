import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

export const envSchema = z.object({
  POSTGRES_URL: z.string().url().default("postgres://supplystrata:dev@localhost:5432/supplystrata"),
  NEO4J_URI: z.string().default("bolt://localhost:7687"),
  NEO4J_USER: z.string().default("neo4j"),
  NEO4J_PASSWORD: z.string().default("devpassword"),
  OBJECT_STORE_FS_BASE: z.string().default("./data/raw"),
  SEC_USER_AGENT: z.string().min(8).default("SupplyStrata MVP contact@example.com"),
  LLM_PROVIDER: z.enum(["none", "openai", "anthropic", "deepseek"]).default("none"),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  OPEN_CORPORATES_API_TOKEN: z.string().optional(),
  COMPANIES_HOUSE_API_KEY: z.string().optional(),
  CENSUS_API_KEY: z.string().optional(),
  OSH_API_TOKEN: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info")
});

export type Env = z.infer<typeof envSchema>;

export interface LoadEnvOptions {
  dotenvPath?: string;
}

export function loadEnv(options: LoadEnvOptions = {}): Env {
  loadDotEnvIfPresent(options.dotenvPath ?? ".env");
  return envSchema.parse(process.env);
}

export function requireEnvValue(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required environment value: ${name}`);
  }
  return value;
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
