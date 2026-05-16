import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import pino from "pino";
import { z } from "zod";

loadDotEnvIfPresent();

export const ENTITY_KINDS = [
  "company",
  "company_group",
  "business_unit",
  "facility",
  "port",
  "vessel",
  "carrier",
  "product",
  "component",
  "industry_node",
  "person",
  "government_agency"
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

export const RELATION_TYPES = [
  "BUYS_FROM",
  "SUPPLIES_TO",
  "USES_FOUNDRY",
  "USES_COMPONENT",
  "MANUFACTURES_AT",
  "OWNS_SUBSIDIARY",
  "OWNS_BUSINESS_UNIT",
  "IS_A",
  "OPERATES_FACILITY"
] as const;

export type RelationType = (typeof RELATION_TYPES)[number];

export const DOCUMENT_TYPES = [
  "10-K",
  "10-Q",
  "20-F",
  "8-K",
  "company_facts",
  "company_registry",
  "annual_report",
  "supplier_list",
  "manual"
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export type EvidenceLevel = 1 | 2 | 3 | 4 | 5;
export type ExtractionMethod = "rule" | "llm" | "manual" | "hybrid";

export function inferExtractionMethod(extractorId: string): ExtractionMethod {
  if (extractorId.startsWith("rule.")) return "rule";
  if (extractorId.startsWith("llm.")) return "llm";
  if (extractorId.startsWith("manual.")) return "manual";
  if (extractorId.startsWith("review.")) return "hybrid";
  return "llm";
}

export interface EntityRecord {
  entity_id: string;
  kind: EntityKind;
  canonical_name: string;
  display_name: string;
  language_of_canonical: string;
  identifiers: Record<string, unknown>;
  primary_country?: string;
  hq_location?: Record<string, unknown>;
  industry: string[];
  status: "active" | "deprecated" | "merged_into";
  attrs: Record<string, unknown>;
}

export interface AliasRecord {
  alias_id: string;
  entity_id: string;
  alias: string;
  alias_norm: string;
  language?: string;
  alias_kind: "official" | "informal" | "abbreviation" | "translation" | "former";
  source_type?: string;
  status: "active" | "rejected";
}

export interface FetchTask {
  task_id: string;
  url: string;
  expected_format: "html" | "pdf" | "json" | "csv" | "xbrl" | "excel";
  params?: Record<string, unknown>;
  hint?: { entity_id?: string; document_type?: DocumentType; period?: string };
}

export interface RawDocument<TBody = unknown> {
  doc_id: string;
  source_adapter_id: string;
  url: string;
  fetched_at: string;
  bytes_sha256: string;
  storage_key: string;
  body: TBody;
  metadata: Record<string, unknown>;
}

export interface DocumentChunk {
  chunk_id: string;
  text: string;
  locator: string;
  token_count?: number;
  language?: string;
}

export interface NormalizedDocument {
  doc_id: string;
  source_adapter_id: string;
  document_type: DocumentType;
  primary_entity_id?: string;
  language: string;
  fetched_at: string;
  source_date?: string;
  source_url: string;
  storage_key: string;
  bytes_sha256: string;
  text: string;
  chunks: DocumentChunk[];
  metadata: Record<string, unknown>;
}

export interface ResolveInput {
  surface: string;
  language?: string;
  context?: {
    nearby_text?: string;
    document_type?: string;
    co_mentioned_entities?: string[];
    inferred_country?: string;
    industry_hint?: string;
  };
  identifiers?: { cik?: string; lei?: string; isin?: string; ticker?: string };
}

export interface ResolveResult {
  status: "resolved" | "ambiguous" | "unknown";
  entity_id?: string;
  confidence: number;
  candidates?: { entity_id: string; confidence: number; reason: string }[];
  needs_human_review: boolean;
}

export interface CandidateRelation {
  subject_resolve: ResolveInput;
  object_resolve: ResolveInput;
  relation: RelationType;
  component?: string;
  cite_text: string;
  cite_locator: string;
  validity?: { from?: string; to?: string };
  extractor_id: string;
  raw_evidence_level_hint: EvidenceLevel;
  raw_confidence_hint: number;
  llm_meta?: { model: string; prompt_hash: string };
}

export interface ScoringResult {
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  needs_review: boolean;
  rationale: string;
  confidence_breakdown: {
    base: number;
    factors: { name: string; value: number }[];
    cap: number;
    final: number;
  };
}

export interface ApprovedCandidate {
  candidate: CandidateRelation;
  scoring: ScoringResult;
  approved_by: "auto" | { reviewer: string; reviewed_at: string };
  doc_id: string;
  chunk_id?: string;
}

export interface ApplyResult {
  edge_id: string;
  evidence_id: string;
  change_id: string;
  is_new_edge: boolean;
  graph_sync: { status: "synced" } | { status: "failed"; error_message: string };
}

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
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info")
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  return envSchema.parse(process.env);
}

export const logger = pino({ level: loadEnv().LOG_LEVEL }, pino.destination(2));

export function createId(prefix: "DOC" | "CHK" | "EV" | "EDGE" | "CHG" | "REV" | "REJ" | "PND" | "UNK" | "ALIAS"): string {
  return `${prefix}-${randomUUID()}`;
}

export function normalizeAlias(input: string): string {
  return input.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function requireEnvValue(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required environment value: ${name}`);
  }
  return value;
}

export interface FetchBytesOptions {
  userAgent: string;
  timeoutMs: number;
  sourceLabel: string;
  headers?: Record<string, string>;
}

// 统一处理公开网页抓取的超时与状态码错误，避免各 adapter 自己散落网络细节。
export async function fetchBytesWithTimeout(url: string, options: FetchBytesOptions): Promise<Uint8Array> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": options.userAgent, ...options.headers },
      signal: AbortSignal.timeout(options.timeoutMs)
    });
    if (!response.ok) throw new Error(`${options.sourceLabel} fetch failed: ${response.status} ${response.statusText}`);
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new Error(`${options.sourceLabel} fetch timed out after ${options.timeoutMs}ms`);
    }
    throw error;
  }
}

export function toIsoDateOnly(value: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match?.[1];
}

function loadDotEnvIfPresent(path = ".env"): void {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^"|"$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
