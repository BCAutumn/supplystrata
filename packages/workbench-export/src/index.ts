import {
  getClaim,
  getEvidence,
  listChangeTimeline,
  listDraftClaims,
  listEvidenceForEdges,
  listUnknownItems,
  resolveEntityId,
  type ChangeTimelineItem,
  type DbClient
} from "@supplystrata/db";
import { buildCompanyChainView, type ChainViewModel, type ChainViewSegmentModel } from "@supplystrata/chain-view";
import { listSourceHealthRows } from "@supplystrata/source-monitor";
import { planSourcesForComponents, type SourcePlanItem } from "@supplystrata/source-plan";
import { RELATION_TYPES, type ClaimType, type EvidenceLevel, type ExtractionMethod, type RelationType } from "@supplystrata/core";

export interface WorkbenchExportInput {
  company: string;
  depth?: number;
  since?: string;
  changeLimit?: number;
  sourceLimit?: number;
  draftClaimLimit?: number;
}

export interface WorkbenchCompanyNode {
  entity_id: string;
  name: string;
  role: "root" | "counterparty";
}

export interface WorkbenchEdge {
  edge_id: string;
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  relation: RelationType;
  component: string | null;
  component_id: string | null;
  evidence_level: EvidenceLevel;
  confidence: number;
  evidence_ids: string[];
}

export type WorkbenchClaimStatus = "draft" | "active" | "superseded" | "rejected";

export interface WorkbenchClaim {
  claim_id: string;
  claim_type: ClaimType;
  claim_text: string;
  subject_id: string | null;
  object_id: string | null;
  component_id: string | null;
  edge_id: string | null;
  review_id: string | null;
  status: WorkbenchClaimStatus;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  generated_by: string;
  last_verified_at: string;
  created_at: string;
  updated_at: string;
}

export interface WorkbenchEvidence {
  evidence_id: string;
  edge_id: string | null;
  superseded_by: string | null;
  cite_text: string;
  cite_locator: string | null;
  cite_start_char: number | null;
  cite_end_char: number | null;
  cite_text_sha256: string | null;
  normalized_cite_text_sha256: string | null;
  source_snapshot_sha256: string | null;
  parser_version: string | null;
  extractor_version: string | null;
  relation_candidate_hash: string | null;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  extraction_method: ExtractionMethod;
  source_url: string;
  source_date: string | null;
  fetched_at: string;
  source_adapter_id: string;
  document_type: string;
  subject_name: string | null;
  object_name: string | null;
  relation: RelationType | null;
}

export interface WorkbenchUnknownItem {
  unknown_id: string;
  question: string;
  why_unknown: string;
  blocking_data_sources: string[];
  proxies: string[];
  status: string;
}

export interface WorkbenchSourceHealth {
  source_adapter_id: string;
  tier: string;
  category: string;
  registry_status: string;
  automation: string;
  tos_url: string;
  official_url: string;
  requires_key: boolean;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  failure_count: number;
  last_change_at: string | null;
  last_error_message: string | null;
  policy_enabled: boolean | null;
  check_cadence_minutes: number | null;
  jitter_minutes: number | null;
  priority: number | null;
  next_check_at: string | null;
  policy_config_source: string | null;
  policy_notes: string | null;
}

export interface WorkbenchModel {
  schema_version: "1.0.0";
  generated_at: string;
  selected_company_id: string;
  companies: WorkbenchCompanyNode[];
  chain: ChainViewModel;
  chain_segments: ChainViewSegmentModel[];
  edges: WorkbenchEdge[];
  upstream_edges: WorkbenchEdge[];
  downstream_edges: WorkbenchEdge[];
  claims: WorkbenchClaim[];
  draft_claims: WorkbenchClaim[];
  evidences: WorkbenchEvidence[];
  unknown_items: WorkbenchUnknownItem[];
  sources: WorkbenchSourceHealth[];
  source_plan: SourcePlanItem[];
  changes: ChangeTimelineItem[];
}

export async function buildWorkbenchModel(client: DbClient, input: WorkbenchExportInput): Promise<WorkbenchModel> {
  const rootEntityId = await resolveEntityId(client, input.company);
  const chain = await buildCompanyChainView(client, { query: rootEntityId, depth: input.depth ?? 2, generated_by: "workbench-export.v1" });
  const edgeSegments = chain.segments.filter(isEdgeSegment);
  const edges = edgeSegments.map(workbenchEdgeFromSegment);
  const edgeIds = uniqueStrings(edgeSegments.map((segment) => segment.edge_id));
  const claimIds = uniqueStrings(chain.segments.flatMap((segment) => (segment.claim_id === undefined ? [] : [segment.claim_id])));
  const evidenceIds = uniqueStrings(chain.segments.flatMap((segment) => segment.evidence_ids));
  const claims = await loadClaims(client, claimIds);
  const draftClaims = (await listDraftClaims(client, { scope: { kind: "entity", id: rootEntityId }, limit: input.draftClaimLimit ?? 25 })).map(claimToDto);
  const evidences = await loadWorkbenchEvidences(client, { evidenceIds, edgeIds });
  const unknownItems = (await listUnknownItems(client, rootEntityId)).map(unknownItemToDto);
  const sources = (await listSourceHealthRows(client)).slice(0, input.sourceLimit ?? 50).map(sourceHealthToDto);
  const sourcePlan = planSourcesForComponents({
    component_ids: componentIdsFromSegments(chain.segments),
    entity_ids: [rootEntityId],
    maxTierDepth: input.depth ?? 2
  });
  const changes = await listChangeTimeline(client, {
    since: input.since ?? defaultSince(30),
    limit: input.changeLimit ?? 50,
    scope: { kind: "company", id: rootEntityId }
  });

  return {
    schema_version: "1.0.0",
    generated_at: new Date().toISOString(),
    selected_company_id: rootEntityId,
    companies: companiesFromChain(chain, rootEntityId),
    chain,
    chain_segments: chain.segments,
    edges,
    upstream_edges: edges,
    downstream_edges: [],
    claims,
    draft_claims: draftClaims,
    evidences,
    unknown_items: unknownItems,
    sources,
    source_plan: sourcePlan,
    changes
  };
}

export function workbenchEdgeFromSegment(segment: ChainViewSegmentModel): WorkbenchEdge {
  if (!isEdgeSegment(segment)) throw new Error(`Segment is not a fact edge: ${segment.sequence_index}`);
  return {
    edge_id: segment.edge_id,
    from_id: segment.from.id,
    from_name: segment.from.name,
    to_id: segment.to.id,
    to_name: segment.to.name,
    relation: segment.relation,
    component: segment.component,
    component_id: segment.component_id,
    evidence_level: segment.evidence_level,
    confidence: segment.confidence,
    evidence_ids: segment.evidence_ids
  };
}

function isEdgeSegment(
  segment: ChainViewSegmentModel
): segment is ChainViewSegmentModel & { edge_id: string; evidence_level: EvidenceLevel; relation: RelationType } {
  return segment.semantic_layer === "edge" && segment.edge_id !== undefined && segment.evidence_level !== undefined && isRelationType(segment.relation);
}

function isRelationType(value: string): value is RelationType {
  for (const relationType of RELATION_TYPES) {
    if (value === relationType) return true;
  }
  return false;
}

function companiesFromChain(chain: ChainViewModel, rootEntityId: string): WorkbenchCompanyNode[] {
  const byId = new Map<string, WorkbenchCompanyNode>();
  byId.set(chain.root.id, { entity_id: chain.root.id, name: chain.root.name, role: "root" });
  for (const segment of chain.segments) {
    addCompanyEndpoint(byId, segment.from, rootEntityId);
    addCompanyEndpoint(byId, segment.to, rootEntityId);
  }
  return [...byId.values()].sort((left, right) => roleOrder(left.role) - roleOrder(right.role) || left.name.localeCompare(right.name));
}

function addCompanyEndpoint(byId: Map<string, WorkbenchCompanyNode>, endpoint: { kind: string; id: string; name: string }, rootEntityId: string): void {
  if (endpoint.kind !== "company") return;
  if (byId.has(endpoint.id)) return;
  byId.set(endpoint.id, { entity_id: endpoint.id, name: endpoint.name, role: endpoint.id === rootEntityId ? "root" : "counterparty" });
}

function roleOrder(role: WorkbenchCompanyNode["role"]): number {
  return role === "root" ? 0 : 1;
}

async function loadClaims(client: DbClient, claimIds: readonly string[]): Promise<WorkbenchClaim[]> {
  const claims: WorkbenchClaim[] = [];
  for (const claimId of claimIds) {
    const claim = await getClaim(client, claimId);
    if (claim !== undefined) claims.push(claimToDto(claim));
  }
  return claims;
}

async function loadEvidences(client: DbClient, evidenceIds: readonly string[]): Promise<WorkbenchEvidence[]> {
  const evidences: WorkbenchEvidence[] = [];
  for (const evidenceId of evidenceIds) {
    const evidence = await getEvidence(client, evidenceId);
    if (evidence !== undefined) evidences.push(evidenceToDto(evidence));
  }
  return evidences;
}

async function loadWorkbenchEvidences(client: DbClient, input: { evidenceIds: readonly string[]; edgeIds: readonly string[] }): Promise<WorkbenchEvidence[]> {
  const byId = new Map<string, WorkbenchEvidence>();
  for (const evidence of await listEvidenceForEdges(client, input.edgeIds)) {
    byId.set(evidence.evidence_id, evidenceToDto(evidence));
  }
  for (const evidence of await loadEvidences(client, input.evidenceIds)) {
    byId.set(evidence.evidence_id, evidence);
  }
  return [...byId.values()].sort(compareWorkbenchEvidence);
}

function compareWorkbenchEvidence(left: WorkbenchEvidence, right: WorkbenchEvidence): number {
  const leftEdge = left.edge_id ?? "";
  const rightEdge = right.edge_id ?? "";
  const edgeOrder = leftEdge.localeCompare(rightEdge);
  if (edgeOrder !== 0) return edgeOrder;
  const activeOrder = Number(left.superseded_by !== null) - Number(right.superseded_by !== null);
  if (activeOrder !== 0) return activeOrder;
  return right.evidence_level - left.evidence_level || right.confidence - left.confidence || left.evidence_id.localeCompare(right.evidence_id);
}

interface ClaimDbShape {
  claim_id: string;
  claim_type: ClaimType;
  claim_text: string;
  subject_id: string | null;
  object_id: string | null;
  component_id: string | null;
  edge_id: string | null;
  review_id: string | null;
  status: WorkbenchClaimStatus;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  generated_by: string;
  last_verified_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface EvidenceDbShape {
  evidence_id: string;
  edge_id: string | null;
  superseded_by: string | null;
  cite_text: string;
  cite_locator: string | null;
  cite_start_char: number | null;
  cite_end_char: number | null;
  cite_text_sha256: string | null;
  normalized_cite_text_sha256: string | null;
  source_snapshot_sha256: string | null;
  parser_version: string | null;
  extractor_version: string | null;
  relation_candidate_hash: string | null;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  extraction_method: ExtractionMethod;
  source_url: string;
  source_date: Date | string | null;
  fetched_at: Date | string;
  source_adapter_id: string;
  document_type: string;
  subject_name: string | null;
  object_name: string | null;
  relation: RelationType | null;
}

interface UnknownDbShape {
  unknown_id: string;
  question: string;
  why_unknown: string;
  blocking_data_sources: string[];
  proxies: string[];
  status: string;
}

interface SourceHealthDbShape {
  source_adapter_id: string;
  tier: string;
  category: string;
  registry_status: string;
  automation: string;
  tos_url: string;
  official_url: string;
  requires_key: boolean;
  last_checked_at: Date | string | null;
  last_success_at: Date | string | null;
  last_failure_at: Date | string | null;
  failure_count: number;
  last_change_at: Date | string | null;
  last_error_message: string | null;
  policy_enabled: boolean | null;
  check_cadence_minutes: number | null;
  jitter_minutes: number | null;
  priority: number | null;
  next_check_at: Date | string | null;
  policy_config_source: string | null;
  policy_notes: string | null;
}

function claimToDto(row: ClaimDbShape): WorkbenchClaim {
  return {
    claim_id: row.claim_id,
    claim_type: row.claim_type,
    claim_text: row.claim_text,
    subject_id: row.subject_id,
    object_id: row.object_id,
    component_id: row.component_id,
    edge_id: row.edge_id,
    review_id: row.review_id,
    status: row.status,
    evidence_level: row.evidence_level,
    confidence: row.confidence,
    is_inferred: row.is_inferred,
    generated_by: row.generated_by,
    last_verified_at: toIsoString(row.last_verified_at),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at)
  };
}

function evidenceToDto(row: EvidenceDbShape): WorkbenchEvidence {
  return {
    evidence_id: row.evidence_id,
    edge_id: row.edge_id,
    superseded_by: row.superseded_by,
    cite_text: row.cite_text,
    cite_locator: row.cite_locator,
    cite_start_char: row.cite_start_char,
    cite_end_char: row.cite_end_char,
    cite_text_sha256: row.cite_text_sha256,
    normalized_cite_text_sha256: row.normalized_cite_text_sha256,
    source_snapshot_sha256: row.source_snapshot_sha256,
    parser_version: row.parser_version,
    extractor_version: row.extractor_version,
    relation_candidate_hash: row.relation_candidate_hash,
    evidence_level: row.evidence_level,
    confidence: row.confidence,
    is_inferred: row.is_inferred,
    extraction_method: row.extraction_method,
    source_url: row.source_url,
    source_date: row.source_date === null ? null : toDateOnly(row.source_date),
    fetched_at: toIsoString(row.fetched_at),
    source_adapter_id: row.source_adapter_id,
    document_type: row.document_type,
    subject_name: row.subject_name,
    object_name: row.object_name,
    relation: row.relation
  };
}

function unknownItemToDto(row: UnknownDbShape): WorkbenchUnknownItem {
  return {
    unknown_id: row.unknown_id,
    question: row.question,
    why_unknown: row.why_unknown,
    blocking_data_sources: row.blocking_data_sources,
    proxies: row.proxies,
    status: row.status
  };
}

function sourceHealthToDto(row: SourceHealthDbShape): WorkbenchSourceHealth {
  return {
    source_adapter_id: row.source_adapter_id,
    tier: row.tier,
    category: row.category,
    registry_status: row.registry_status,
    automation: row.automation,
    tos_url: row.tos_url,
    official_url: row.official_url,
    requires_key: row.requires_key,
    last_checked_at: toNullableIsoString(row.last_checked_at),
    last_success_at: toNullableIsoString(row.last_success_at),
    last_failure_at: toNullableIsoString(row.last_failure_at),
    failure_count: row.failure_count,
    last_change_at: toNullableIsoString(row.last_change_at),
    last_error_message: row.last_error_message,
    policy_enabled: row.policy_enabled,
    check_cadence_minutes: row.check_cadence_minutes,
    jitter_minutes: row.jitter_minutes,
    priority: row.priority,
    next_check_at: toNullableIsoString(row.next_check_at),
    policy_config_source: row.policy_config_source,
    policy_notes: row.policy_notes
  };
}

function toNullableIsoString(value: Date | string | null): string | null {
  return value === null ? null : toIsoString(value);
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toDateOnly(value: Date | string): string {
  return toIsoString(value).slice(0, 10);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function componentIdsFromSegments(segments: readonly ChainViewSegmentModel[]): string[] {
  return uniqueStrings(segments.flatMap((segment) => (segment.component_id === null ? [] : [segment.component_id])));
}

function defaultSince(daysBack: number): string {
  return new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
}
