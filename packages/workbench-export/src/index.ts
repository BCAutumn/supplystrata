import { buildClaimConflictContext } from "@supplystrata/claim-builder";
import {
  getClaim,
  getEvidence,
  listAlertCandidates,
  listClaimEvidenceLinks,
  listClaimUnknownLinks,
  listChangeTimeline,
  listActiveClaimsOnInactiveEdges,
  listEdgeFreshness,
  listEdgeStrengthEstimates,
  listDraftClaims,
  listEvidenceForEdges,
  listUnknownItems,
  resolveEntityId,
  type ClaimEvidenceRole,
  type ClaimUnknownRole,
  type DbClient
} from "@supplystrata/db";
import type { ChainViewModel, ChainViewSegmentModel } from "@supplystrata/chain-view";
import { buildCompanyChainView } from "@supplystrata/chain-view-builder";
import { listSourceHealthRows } from "@supplystrata/source-monitor";
import { planSourcesForComponents } from "@supplystrata/source-plan";
import {
  RELATION_TYPES,
  type ClaimType,
  type EdgeValidity,
  type EdgeFreshnessRecord,
  type EdgeStrengthEstimateRecord,
  type EvidenceLevel,
  type ExtractionMethod,
  type RelationType
} from "@supplystrata/core";
export { buildWorkbenchAttentionQueue } from "./attention-queue.js";
import { buildWorkbenchAttentionQueue } from "./attention-queue.js";
export type {
  WorkbenchAttentionItem,
  WorkbenchAttentionKind,
  WorkbenchAttentionPriority,
  WorkbenchAttentionStatus,
  WorkbenchClaimConflictRecommendedAction,
  WorkbenchClaimConflictState,
  WorkbenchClaimEvidenceRef,
  WorkbenchClaimLifecycleWarning,
  WorkbenchClaimStatus,
  WorkbenchClaimUnknownRef,
  WorkbenchCompanyNode,
  WorkbenchEdge,
  WorkbenchEdgeFreshness,
  WorkbenchEdgeStrength,
  WorkbenchEvidence,
  WorkbenchExportInput,
  WorkbenchIntelligenceContext,
  WorkbenchModel,
  WorkbenchOfficialDisclosureSignalDisposition,
  WorkbenchOfficialDisclosureSignalDispositionDecision,
  WorkbenchReviewCandidate,
  WorkbenchReviewCandidateSignal,
  WorkbenchReviewCandidateStatus,
  WorkbenchSourceHealth,
  WorkbenchUnknownItem
} from "./definitions.js";
import type {
  WorkbenchClaim,
  WorkbenchClaimEvidenceRef,
  WorkbenchClaimLifecycleWarning,
  WorkbenchClaimStatus,
  WorkbenchClaimUnknownRef,
  WorkbenchCompanyNode,
  WorkbenchEdge,
  WorkbenchEdgeFreshness,
  WorkbenchEdgeStrength,
  WorkbenchEvidence,
  WorkbenchExportInput,
  WorkbenchIntelligenceContext,
  WorkbenchModel,
  WorkbenchSourceHealth,
  WorkbenchUnknownItem
} from "./definitions.js";
import { loadWorkbenchReviewQueue, reviewQueueSourceAdapterIds } from "./review-queue.js";

export async function buildWorkbenchModel(client: DbClient, input: WorkbenchExportInput): Promise<WorkbenchModel> {
  const generatedAt = new Date().toISOString();
  const rootEntityId = await resolveEntityId(client, input.company);
  const chain = await buildCompanyChainView(client, { query: rootEntityId, depth: input.depth ?? 2, generated_by: "workbench-export.v1" });
  const edgeSegments = chain.segments.filter(isEdgeSegment);
  const edges = edgeSegments.map(workbenchEdgeFromSegment);
  const edgeIds = uniqueStrings(edgeSegments.map((segment) => segment.edge_id));
  const claimIds = uniqueStrings(chain.segments.flatMap((segment) => (segment.claim_id === undefined ? [] : [segment.claim_id])));
  const evidenceIds = uniqueStrings(chain.segments.flatMap((segment) => segment.evidence_ids));
  const claims = mergeWorkbenchClaims([
    ...(await loadClaims(client, claimIds)),
    ...(await enrichClaims(
      client,
      await listActiveClaimsOnInactiveEdges(client, { scope: { kind: "entity", id: rootEntityId }, limit: input.lifecycleClaimLimit ?? 25 })
    ))
  ]);
  const draftClaims = await enrichClaims(
    client,
    await listDraftClaims(client, { scope: { kind: "entity", id: rootEntityId }, limit: input.draftClaimLimit ?? 25 })
  );
  const evidences = await loadWorkbenchEvidences(client, { evidenceIds, edgeIds });
  const intelligence = await loadWorkbenchIntelligence(client, { edgeIds, computedAt: generatedAt });
  const claimUnknownIds = uniqueStrings([...claims, ...draftClaims].flatMap((claim) => claim.unknown_refs.map((ref) => ref.unknown_id)));
  const unknownItems = (await loadWorkbenchUnknowns(client, { rootEntityId, edgeIds, unknownIds: claimUnknownIds })).map(unknownItemToDto);
  const sources = (await listSourceHealthRows(client)).slice(0, input.sourceLimit ?? 50).map(sourceHealthToDto);
  const alerts = await listAlertCandidates(client, { status: "open", limit: input.alertLimit ?? 50 });
  const sourcePlan = planSourcesForComponents({
    component_ids: componentIdsFromSegments(chain.segments),
    entity_ids: [rootEntityId],
    maxTierDepth: input.depth ?? 2
  });
  const reviewQueue = await loadWorkbenchReviewQueue(client, {
    sourceAdapterIds: reviewQueueSourceAdapterIds({ evidences, sourcePlan }),
    limit: input.reviewCandidateLimit ?? 50
  });
  const changes = await listChangeTimeline(client, {
    since: input.since ?? defaultSince(30),
    limit: input.changeLimit ?? 50,
    scope: { kind: "company", id: rootEntityId }
  });
  const attentionQueue = buildWorkbenchAttentionQueue({
    claims,
    draftClaims,
    alerts,
    sources,
    changes,
    limit: input.attentionLimit ?? 100
  });

  return {
    schema_version: "1.0.0",
    generated_at: generatedAt,
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
    changes,
    attention_queue: attentionQueue,
    review_queue: reviewQueue,
    intelligence
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
    if (claim !== undefined) claims.push(await claimToDto(client, claim));
  }
  return claims;
}

async function enrichClaims(client: DbClient, rows: readonly ClaimDbShape[]): Promise<WorkbenchClaim[]> {
  const claims: WorkbenchClaim[] = [];
  for (const row of rows) {
    claims.push(await claimToDto(client, row));
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

async function loadWorkbenchIntelligence(client: DbClient, input: { edgeIds: readonly string[]; computedAt: string }): Promise<WorkbenchIntelligenceContext> {
  const [strengths, freshness] = await Promise.all([
    listEdgeStrengthEstimates(client, input.edgeIds),
    listEdgeFreshness(client, { edgeIds: input.edgeIds, computedAt: input.computedAt })
  ]);
  return {
    edge_strengths: strengths.map(edgeStrengthToDto),
    edge_freshness: freshness.map(edgeFreshnessToDto)
  };
}

async function loadWorkbenchUnknowns(
  client: DbClient,
  input: { rootEntityId: string; edgeIds: readonly string[]; unknownIds: readonly string[] }
): Promise<UnknownDbShape[]> {
  const byId = new Map<string, UnknownDbShape>();
  for (const unknown of await listUnknownItems(client, input.rootEntityId)) {
    byId.set(unknown.unknown_id, unknown);
  }
  for (const edgeId of input.edgeIds) {
    for (const unknown of await listUnknownItems(client, edgeId)) {
      byId.set(unknown.unknown_id, unknown);
    }
  }
  for (const unknown of await listUnknownsByIds(client, input.unknownIds)) {
    byId.set(unknown.unknown_id, unknown);
  }
  return [...byId.values()];
}

async function listUnknownsByIds(client: DbClient, unknownIds: readonly string[]): Promise<UnknownDbShape[]> {
  const ids = uniqueStrings(unknownIds);
  if (ids.length === 0) return [];
  const result = await client.query<UnknownDbShape>(
    `SELECT unknown_id, scope_kind, scope_id, question, why_unknown, blocking_data_sources, proxies, status
     FROM unknown_items
     WHERE unknown_id = ANY($1::text[])
     ORDER BY unknown_id`,
    [ids]
  );
  return result.rows;
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
  edge_validity: EdgeValidity | null;
  edge_deprecated_reason: string | null;
  edge_superseded_by_edge_id: string | null;
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
  scope_kind: string;
  scope_id: string;
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

async function claimToDto(client: DbClient, row: ClaimDbShape): Promise<WorkbenchClaim> {
  const [evidenceRefs, unknownRefs] = await Promise.all([listClaimEvidenceLinks(client, row.claim_id), listClaimUnknownLinks(client, row.claim_id)]);
  const evidenceRefsDto = claimEvidenceRefsToDto(evidenceRefs);
  const unknownRefsDto = claimUnknownRefsToDto(unknownRefs);
  const conflictContext = buildClaimConflictContext({
    claim_id: row.claim_id,
    claim_text: row.claim_text,
    claim_status: row.status,
    edge_id: row.edge_id,
    evidence_refs: evidenceRefsDto,
    unknown_refs: unknownRefsDto
  });
  return {
    claim_id: row.claim_id,
    claim_type: row.claim_type,
    claim_text: row.claim_text,
    subject_id: row.subject_id,
    object_id: row.object_id,
    component_id: row.component_id,
    edge_id: row.edge_id,
    edge_validity: row.edge_validity ?? null,
    edge_deprecated_reason: row.edge_deprecated_reason ?? null,
    edge_superseded_by_edge_id: row.edge_superseded_by_edge_id ?? null,
    review_id: row.review_id,
    status: row.status,
    evidence_level: row.evidence_level,
    confidence: row.confidence,
    is_inferred: row.is_inferred,
    generated_by: row.generated_by,
    last_verified_at: toIsoString(row.last_verified_at),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
    evidence_refs: evidenceRefsDto,
    unknown_refs: unknownRefsDto,
    conflict_state: conflictContext.conflict_state,
    conflict_adjudication: conflictContext.adjudication,
    conflict_review: conflictContext.review_packet,
    lifecycle_warnings: claimLifecycleWarnings(row)
  };
}

function mergeWorkbenchClaims(claims: readonly WorkbenchClaim[]): WorkbenchClaim[] {
  const byId = new Map<string, WorkbenchClaim>();
  for (const claim of claims) byId.set(claim.claim_id, claim);
  return [...byId.values()].sort(compareWorkbenchClaims);
}

function compareWorkbenchClaims(left: WorkbenchClaim, right: WorkbenchClaim): number {
  const lifecycleOrder = Number(right.lifecycle_warnings.length > 0) - Number(left.lifecycle_warnings.length > 0);
  if (lifecycleOrder !== 0) return lifecycleOrder;
  return right.evidence_level - left.evidence_level || right.confidence - left.confidence || left.claim_id.localeCompare(right.claim_id);
}

function claimLifecycleWarnings(row: ClaimDbShape): WorkbenchClaimLifecycleWarning[] {
  if (row.status !== "active") return [];
  if (row.edge_id === null || row.edge_validity === null || row.edge_validity === "current") return [];
  const replacement = row.edge_superseded_by_edge_id === null ? "" : `; superseded by ${row.edge_superseded_by_edge_id}`;
  return [
    {
      code: "active_claim_on_inactive_edge",
      severity: "warn",
      message: `Active claim is still linked to ${row.edge_validity} edge ${row.edge_id}${replacement}`
    }
  ];
}

function claimEvidenceRefsToDto(evidenceRefs: readonly { evidence_id: string; role: ClaimEvidenceRole }[]): WorkbenchClaimEvidenceRef[] {
  return evidenceRefs.map((ref) => ({ evidence_id: ref.evidence_id, role: ref.role }));
}

function claimUnknownRefsToDto(unknownRefs: readonly { unknown_id: string; role: ClaimUnknownRole; status: string }[]): WorkbenchClaimUnknownRef[] {
  return unknownRefs.map((ref) => ({ unknown_id: ref.unknown_id, role: ref.role, status: ref.status }));
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
    scope_kind: row.scope_kind,
    scope_id: row.scope_id,
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

function edgeStrengthToDto(row: EdgeStrengthEstimateRecord): WorkbenchEdgeStrength {
  return {
    strength_id: row.strength_id,
    edge_id: row.edge_id,
    strength_kind: row.strength_kind,
    value: row.value ?? null,
    lower_bound: row.lower_bound ?? null,
    upper_bound: row.upper_bound ?? null,
    unit: row.unit ?? null,
    evidence_id: row.evidence_id ?? null,
    method: row.method,
    valid_from: row.valid_from ?? null,
    valid_to: row.valid_to ?? null
  };
}

function edgeFreshnessToDto(row: EdgeFreshnessRecord): WorkbenchEdgeFreshness {
  return {
    edge_id: row.edge_id,
    last_verified_at: row.last_verified_at,
    decay_model: row.decay_model,
    age_days: row.age_days,
    freshness_score: row.freshness_score,
    computed_at: row.computed_at,
    source_evidence_id: row.source_evidence_id ?? null
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
