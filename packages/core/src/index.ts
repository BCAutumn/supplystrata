import { randomUUID } from "node:crypto";

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

export const DOCUMENT_TYPES = ["10-K", "10-Q", "20-F", "8-K", "company_facts", "company_registry", "annual_report", "supplier_list", "manual"] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export type EvidenceLevel = 1 | 2 | 3 | 4 | 5;
export type ExtractionMethod = "rule" | "llm" | "manual" | "hybrid";
export type ComponentSpecificity = "explicit" | "inferred" | "unspecified";

export const CLAIM_TYPES = [
  "SUPPLY_RELATION_CLAIM",
  "FACILITY_RELATION_CLAIM",
  "ENTITY_FACT_CLAIM",
  "COMPONENT_EXPOSURE_CLAIM",
  "DEMAND_SIGNAL_CLAIM",
  "RISK_SIGNAL_CLAIM",
  "UNKNOWN_BOUNDARY_CLAIM"
] as const;

export type ClaimType = (typeof CLAIM_TYPES)[number];

export const OBSERVATION_TYPES = [
  "TRADE_FLOW_OBSERVATION",
  "PORT_ACTIVITY_OBSERVATION",
  "ROUTE_OBSERVATION",
  "ENERGY_PRICE_OBSERVATION",
  "COMMODITY_PRICE_OBSERVATION",
  "MINERAL_SUPPLY_OBSERVATION",
  "CAPEX_OBSERVATION",
  "INVENTORY_OBSERVATION",
  "BACKLOG_OBSERVATION",
  "CUSTOMER_CONCENTRATION_OBSERVATION",
  "POLICY_OBSERVATION",
  "PROCUREMENT_OBSERVATION"
] as const;

export type ObservationType = (typeof OBSERVATION_TYPES)[number];

export const LEAD_TYPES = [
  "HIRING_SIGNAL",
  "NEWS_SIGNAL",
  "PROCUREMENT_SIGNAL",
  "BOL_SINGLE_RECORD",
  "FORUM_OR_BLOG_SIGNAL",
  "UNVERIFIED_FACILITY_SIGNAL"
] as const;

export type LeadType = (typeof LEAD_TYPES)[number];

export const SEMANTIC_LAYERS = ["edge", "claim", "observation", "lead", "unknown"] as const;

export type SemanticLayer = (typeof SEMANTIC_LAYERS)[number];

export const CHAIN_ENDPOINT_KINDS = [
  "company",
  "entity",
  "facility",
  "component",
  "country",
  "port",
  "vessel",
  "carrier",
  "mineral",
  "route",
  "document"
] as const;

export type ChainEndpointKind = (typeof CHAIN_ENDPOINT_KINDS)[number];

export const EXTRACTOR_ID_PREFIXES = ["rule.", "llm.", "manual.", "review."] as const;

export function inferExtractionMethod(extractorId: string): ExtractionMethod {
  if (extractorId.startsWith("rule.")) return "rule";
  if (extractorId.startsWith("llm.")) return "llm";
  if (extractorId.startsWith("manual.")) return "manual";
  if (extractorId.startsWith("review.")) return "hybrid";
  throw new Error(`Unknown extractor_id prefix for "${extractorId}". Expected one of: ${EXTRACTOR_ID_PREFIXES.join(", ")}`);
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
  component_id?: string;
  component_specificity?: ComponentSpecificity;
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

export interface ClaimRecord {
  claim_id: string;
  claim_type: ClaimType;
  claim_text: string;
  subject_id?: string;
  object_id?: string;
  component_id?: string;
  edge_id?: string;
  status: "active" | "superseded" | "rejected";
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  generated_by: string;
  last_verified_at: string;
}

export interface ObservationRecord {
  observation_id: string;
  observation_type: ObservationType;
  source_adapter_id: string;
  scope_kind: string;
  scope_id: string;
  component_id?: string;
  metric_name: string;
  metric_value?: string;
  metric_unit?: string;
  time_window_start?: string;
  time_window_end?: string;
  confidence: number;
}

export interface LeadObservationRecord {
  lead_id: string;
  lead_type: LeadType;
  source_adapter_id: string;
  scope_kind: string;
  scope_id: string;
  title: string;
  summary: string;
  status: "open" | "in_review" | "promoted" | "rejected" | "closed";
}

export interface ChainSegmentRecord {
  segment_id: string;
  chain_id: string;
  sequence_index: number;
  from_kind: ChainEndpointKind;
  from_id: string;
  to_kind: ChainEndpointKind;
  to_id: string;
  semantic_layer: SemanticLayer;
  relation?: string;
  component_id?: string;
  edge_id?: string;
  claim_id?: string;
  observation_id?: string;
  lead_id?: string;
  unknown_id?: string;
  evidence_ids: string[];
  confidence?: number;
}

export interface ChainViewRecord {
  chain_id: string;
  root_kind: ChainEndpointKind;
  root_id: string;
  view_type: "company_chain" | "component_chain" | "facility_chain" | "route_chain" | "material_chain" | "demand_chain" | "unknown_map";
  title: string;
  generated_by: string;
  generated_at: string;
}

export function createId(
  prefix: "DOC" | "CHK" | "EV" | "EDGE" | "CHG" | "REV" | "REJ" | "PND" | "UNK" | "ALIAS" | "CLM" | "OBS" | "LEAD" | "CHAIN" | "SEG"
): string {
  return `${prefix}-${randomUUID()}`;
}

export function normalizeAlias(input: string): string {
  return input.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function toIsoDateOnly(value: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match?.[1];
}
