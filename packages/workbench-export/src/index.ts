import {
  getClaim,
  getEvidence,
  listAlertCandidates,
  listChangeTimeline,
  listActiveClaimsOnInactiveEdges,
  listEdgeFreshness,
  listEdgeStrengthEstimates,
  listDraftClaims,
  listEvidenceForEdges,
  listUnknownItems,
  resolveEntityId,
  type DbClient
} from "@supplystrata/db/read";
import type { ChainViewModel, ChainViewSegmentModel } from "@supplystrata/chain-view";
import { buildCompanyChainView } from "@supplystrata/chain-view-builder";
import { listSourceHealthRows } from "@supplystrata/source-monitor";
import { planSourcesForComponents } from "@supplystrata/source-plan";
import { RELATION_TYPES, type EvidenceLevel, type RelationType } from "@supplystrata/core";
export { buildWorkbenchAttentionQueue } from "./attention-queue.js";
import { buildWorkbenchAttentionQueue } from "./attention-queue.js";
import { claimToDto, mergeWorkbenchClaims } from "./claim-dto.js";
export { claimToDto } from "./claim-dto.js";
export { toScbomDocument } from "./scbom-mapper.js";
export { assertScbomDocument } from "./scbom-validator.js";
import type { ClaimDbRow, UnknownDbRow } from "./db-rows.js";
import type { ChangeTimelineDtoSource } from "./dto-source-records.js";
export type {
  WorkbenchAttentionItem,
  WorkbenchAttentionKind,
  WorkbenchAttentionPriority,
  WorkbenchAttentionStatus,
  WorkbenchClaimConflictRecommendedAction,
  WorkbenchClaimConflictState,
  WorkbenchClaim,
  WorkbenchClaimEvidenceRef,
  WorkbenchClaimLifecycleWarning,
  WorkbenchClaimStatus,
  WorkbenchClaimUnknownRef,
  WorkbenchChangeTimelineItem,
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
  WorkbenchChangeTimelineItem,
  WorkbenchCompanyNode,
  WorkbenchEdge,
  WorkbenchEvidence,
  WorkbenchExportInput,
  WorkbenchIntelligenceContext,
  WorkbenchModel,
  WorkbenchUnknownItem
} from "./definitions.js";
import { compareWorkbenchEvidence, edgeFreshnessToDto, edgeStrengthToDto, evidenceToDto, sourceHealthToDto, unknownItemToDto } from "./dto-mappers.js";
import { loadWorkbenchReviewQueue, reviewQueueSourceAdapterIds } from "./review-queue.js";

export async function buildWorkbenchModel(client: DbClient, input: WorkbenchExportInput): Promise<WorkbenchModel> {
  const generatedAt = input.generatedAt;
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
  const changes = (
    await listChangeTimeline(client, {
      since: input.since ?? defaultSince(generatedAt, 30),
      limit: input.changeLimit ?? 50,
      scope: { kind: "company", id: rootEntityId }
    })
  ).map(changeTimelineItemToDto);
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

async function enrichClaims(client: DbClient, rows: readonly ClaimDbRow[]): Promise<WorkbenchClaim[]> {
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
): Promise<UnknownDbRow[]> {
  const byId = new Map<string, UnknownDbRow>();
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

async function listUnknownsByIds(client: DbClient, unknownIds: readonly string[]): Promise<UnknownDbRow[]> {
  const ids = uniqueStrings(unknownIds);
  if (ids.length === 0) return [];
  const result = await client.query<UnknownDbRow>(
    `SELECT unknown_id, scope_kind, scope_id, question, why_unknown, blocking_data_sources, proxies, status
     FROM unknown_items
     WHERE unknown_id = ANY($1::text[])
     ORDER BY unknown_id`,
    [ids]
  );
  return result.rows;
}

export function changeTimelineItemToDto(item: ChangeTimelineDtoSource): WorkbenchChangeTimelineItem {
  return {
    event_id: item.event_id,
    event_family: item.event_family,
    event_type: item.event_type,
    occurred_at: item.occurred_at,
    caused_by: item.caused_by,
    requires_attention: item.requires_attention,
    ...(item.scope_kind === undefined ? {} : { scope_kind: item.scope_kind }),
    ...(item.scope_id === undefined ? {} : { scope_id: item.scope_id }),
    ...(item.source_adapter_id === undefined ? {} : { source_adapter_id: item.source_adapter_id }),
    ...(item.source_item_id === undefined ? {} : { source_item_id: item.source_item_id }),
    ...(item.doc_id === undefined ? {} : { doc_id: item.doc_id }),
    ...(item.previous_doc_id === undefined ? {} : { previous_doc_id: item.previous_doc_id }),
    ...(item.next_doc_id === undefined ? {} : { next_doc_id: item.next_doc_id }),
    ...(item.edge_id === undefined ? {} : { edge_id: item.edge_id }),
    ...(item.evidence_id === undefined ? {} : { evidence_id: item.evidence_id }),
    ...(item.evidence_level === undefined ? {} : { evidence_level: item.evidence_level }),
    ...(item.superseded_evidence_ids === undefined ? {} : { superseded_evidence_ids: item.superseded_evidence_ids }),
    ...(item.superseded_by_evidence_id === undefined ? {} : { superseded_by_evidence_id: item.superseded_by_evidence_id }),
    ...(item.subject_id === undefined ? {} : { subject_id: item.subject_id }),
    ...(item.subject_name === undefined ? {} : { subject_name: item.subject_name }),
    ...(item.object_id === undefined ? {} : { object_id: item.object_id }),
    ...(item.object_name === undefined ? {} : { object_name: item.object_name }),
    ...(item.relation === undefined ? {} : { relation: item.relation }),
    ...(item.component === undefined ? {} : { component: item.component }),
    ...(item.semantic_relation_kind === undefined ? {} : { semantic_relation_kind: item.semantic_relation_kind }),
    ...(item.relation_subject_surface === undefined ? {} : { relation_subject_surface: item.relation_subject_surface }),
    ...(item.relation_object_surface === undefined ? {} : { relation_object_surface: item.relation_object_surface }),
    ...(item.relation_fingerprint === undefined ? {} : { relation_fingerprint: item.relation_fingerprint }),
    ...(item.observation_scope_kind === undefined ? {} : { observation_scope_kind: item.observation_scope_kind }),
    ...(item.observation_scope_id === undefined ? {} : { observation_scope_id: item.observation_scope_id }),
    ...(item.metric_name === undefined ? {} : { metric_name: item.metric_name }),
    ...(item.metric_value === undefined ? {} : { metric_value: item.metric_value }),
    ...(item.metric_unit === undefined ? {} : { metric_unit: item.metric_unit }),
    ...(item.baseline_method === undefined ? {} : { baseline_method: item.baseline_method }),
    ...(item.baseline_value === undefined ? {} : { baseline_value: item.baseline_value }),
    ...(item.change_percent === undefined ? {} : { change_percent: item.change_percent }),
    ...(item.anomaly_severity === undefined ? {} : { anomaly_severity: item.anomaly_severity }),
    ...(item.anomaly_direction === undefined ? {} : { anomaly_direction: item.anomaly_direction }),
    ...(item.before === undefined ? {} : { before: item.before }),
    ...(item.after === undefined ? {} : { after: item.after })
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function componentIdsFromSegments(segments: readonly ChainViewSegmentModel[]): string[] {
  return uniqueStrings(segments.flatMap((segment) => (segment.component_id === null ? [] : [segment.component_id])));
}

function defaultSince(generatedAt: string, daysBack: number): string {
  const generatedAtMs = Date.parse(generatedAt);
  if (Number.isNaN(generatedAtMs)) throw new Error(`Invalid workbench generatedAt timestamp: ${generatedAt}`);
  return new Date(generatedAtMs - daysBack * 24 * 60 * 60 * 1000).toISOString();
}
