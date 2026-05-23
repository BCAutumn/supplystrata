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

export const EDGE_VALIDITIES = ["current", "historical", "deprecated"] as const;

export type EdgeValidity = (typeof EDGE_VALIDITIES)[number];

export const DOCUMENT_TYPES = [
  "10-K",
  "10-Q",
  "20-F",
  "8-K",
  "company_facts",
  "company_registry",
  "annual_report",
  "supplier_list",
  "facility_dataset",
  "trade_dataset",
  "manual"
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const SEC_FORM_TYPES = ["10-K", "10-Q", "20-F", "8-K"] as const;

export type SecFormType = (typeof SEC_FORM_TYPES)[number];

export function isSecFormType(value: string): value is SecFormType {
  return SEC_FORM_TYPES.some((formType) => formType === value);
}

export function parseSecFormType(value: string): SecFormType {
  if (isSecFormType(value)) return value;
  throw new Error(`Unsupported SEC form type: ${value}`);
}

export function secFormTypeOrDefault(value: unknown, fallback: SecFormType = "10-K"): SecFormType {
  return typeof value === "string" && isSecFormType(value) ? value : fallback;
}

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

export const CLAIM_STATUSES = ["draft", "active", "superseded", "rejected"] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_EVIDENCE_ROLES = ["primary", "supporting", "contradicting", "context"] as const;

export type ClaimEvidenceRole = (typeof CLAIM_EVIDENCE_ROLES)[number];

export const CLAIM_UNKNOWN_ROLES = ["boundary", "blocking", "context"] as const;

export type ClaimUnknownRole = (typeof CLAIM_UNKNOWN_ROLES)[number];

export const EDGE_STRENGTH_KINDS = ["share", "spend_band", "dependency", "capacity", "qualitative"] as const;

export type EdgeStrengthKind = (typeof EDGE_STRENGTH_KINDS)[number];

export const EDGE_FRESHNESS_DECAY_MODELS = ["methodology.v1"] as const;

export type EdgeFreshnessDecayModel = (typeof EDGE_FRESHNESS_DECAY_MODELS)[number];

export const RISK_METRIC_KINDS = [
  "supplier_concentration_hhi",
  "single_source_exposure",
  "path_redundancy",
  "node_knockout_reach",
  "node_knockout_weighted_impact",
  "betweenness_centrality",
  "freshness_adjusted_exposure",
  "observation_anomaly",
  "financial_metric_peer_zscore"
] as const;

export type RiskMetricKind = (typeof RISK_METRIC_KINDS)[number];

export const ALERT_KINDS = ["observation_anomaly", "source_failure", "component_risk"] as const;

export type AlertKind = (typeof ALERT_KINDS)[number];

export const EDGE_CALIBRATION_LABELS = ["correct", "incorrect", "uncertain"] as const;

export type EdgeCalibrationLabel = (typeof EDGE_CALIBRATION_LABELS)[number];

export const EDGE_CALIBRATION_ERROR_CATEGORIES = [
  "extraction_error",
  "entity_resolution_error",
  "source_error",
  "staleness_error",
  "semantic_misread",
  "other"
] as const;

export type EdgeCalibrationErrorCategory = (typeof EDGE_CALIBRATION_ERROR_CATEGORIES)[number];

export const OBSERVATION_TYPES = [
  "FINANCIAL_METRIC_OBSERVATION",
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
  "PROCUREMENT_OBSERVATION",
  "FACILITY_PROFILE_OBSERVATION"
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
  source_location?: {
    chunk_id?: string;
    chunk_locator?: string;
    cite_start_char: number;
    cite_end_char: number;
  };
  validity?: { from?: string; to?: string };
  extractor_id: string;
  raw_evidence_level_hint: EvidenceLevel;
  raw_confidence_hint: number;
  llm_meta?: { model: string; prompt_hash: string };
}

export function isValidCandidateRelation(candidate: CandidateRelation, documentText: string): boolean {
  return candidate.cite_text.length >= 30 && documentText.includes(candidate.cite_text);
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
  approved_by: { reviewer: string; reviewed_at: string };
  doc_id: string;
  chunk_id?: string;
}

export interface ApplyResult {
  edge_id: string;
  evidence_id: string;
  change_id: string;
  is_new_edge: boolean;
  graph_sync: { status: "synced" } | { status: "deferred" } | { status: "failed"; error_message: string };
}

export interface ClaimRecord {
  claim_id: string;
  claim_type: ClaimType;
  claim_text: string;
  subject_id?: string;
  object_id?: string;
  component_id?: string;
  edge_id?: string;
  review_id?: string;
  status: "draft" | "active" | "superseded" | "rejected";
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

export interface EdgeStrengthEstimateRecord {
  strength_id: string;
  edge_id: string;
  strength_kind: EdgeStrengthKind;
  value?: string;
  lower_bound?: string;
  upper_bound?: string;
  unit?: string;
  evidence_id?: string;
  method: string;
  valid_from?: string;
  valid_to?: string;
  attrs: Record<string, unknown>;
}

export interface EdgeFreshnessRecord {
  edge_id: string;
  last_verified_at: string;
  decay_model: EdgeFreshnessDecayModel;
  age_days: number;
  freshness_score: number;
  computed_at: string;
  source_evidence_id?: string;
  attrs: Record<string, unknown>;
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
  prefix: "DOC" | "CHK" | "EV" | "EDGE" | "CHG" | "REV" | "REJ" | "PND" | "UNK" | "ALIAS" | "CLM" | "OBS" | "LEAD" | "CHAIN" | "SEG" | "GPJ" | "STR"
): string {
  return `${prefix}-${randomUUID()}`;
}

export function calculateEdgeFreshness(input: { last_verified_at: string; computed_at: string; recent_corroboration_within_180d?: boolean }): {
  age_days: number;
  freshness_score: number;
  decay_model: EdgeFreshnessDecayModel;
} {
  const lastVerifiedAt = Date.parse(input.last_verified_at);
  const computedAt = Date.parse(input.computed_at);
  if (!Number.isFinite(lastVerifiedAt)) throw new Error(`Invalid last_verified_at: ${input.last_verified_at}`);
  if (!Number.isFinite(computedAt)) throw new Error(`Invalid computed_at: ${input.computed_at}`);
  const ageDays = Math.max(0, Math.floor((computedAt - lastVerifiedAt) / (24 * 60 * 60 * 1000)));
  if (ageDays <= 180) return { age_days: ageDays, freshness_score: 1, decay_model: "methodology.v1" };
  if (ageDays <= 365) return { age_days: ageDays, freshness_score: 0.85, decay_model: "methodology.v1" };
  if (ageDays <= 730) return { age_days: ageDays, freshness_score: 0.7, decay_model: "methodology.v1" };
  return {
    age_days: ageDays,
    // 近期有独立再确认时，不把老证据本身降权到最低；真正降权只发生在 risk view。
    freshness_score: input.recent_corroboration_within_180d === true ? 0.7 : 0.5,
    decay_model: "methodology.v1"
  };
}

export function normalizeAlias(input: string): string {
  return input.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function toIsoDateOnly(value: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match?.[1];
}
