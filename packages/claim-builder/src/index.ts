import { createHash } from "node:crypto";
import type pg from "pg";
import type { ClaimType, DocumentType, EvidenceLevel, RelationType } from "@supplystrata/core";
import {
  getClaim,
  linkClaimEvidence,
  linkClaimUnknown,
  listClaimEvidenceLinks,
  listClaimUnknownLinks,
  recordSemanticChange,
  resolveUnknownItem,
  tryResolveEntityId,
  upsertClaim,
  upsertUnknownItem,
  type ClaimRow,
  type ClaimStatus,
  type DatabaseStore,
  type DbClient,
  type NewClaimInput
} from "@supplystrata/db";
import {
  buildClaimConflictReviewCandidate,
  type ClaimConflictReviewCandidate,
  type ClaimConflictReviewPayload,
  type ClaimConflictReviewRecommendedAction,
  type ClaimConflictReviewSeverity,
  type ClaimConflictReviewState,
  type ClaimConflictReviewStep as CandidateClaimConflictReviewStep,
  type SemanticChangeReviewCandidate
} from "@supplystrata/review-candidates";
import { enqueueReviewCandidates } from "@supplystrata/review-store";
import { getSourceById, sourceAuthorityFor, type PublisherType, type RelationAuthority, type SourceCategory } from "@supplystrata/source-registry";
export {
  adjudicateClaimConflict,
  buildClaimConflictContext,
  buildClaimConflictReviewPacket,
  type ClaimConflictAdjudication,
  type ClaimConflictContext,
  type ClaimConflictAdjudicationEvidenceRef,
  type ClaimConflictAdjudicationInput,
  type ClaimConflictAdjudicationSeverity,
  type ClaimConflictAdjudicationState,
  type ClaimConflictAdjudicationUnknownRef,
  type ClaimConflictFactWritePolicy,
  type ClaimConflictRecommendedAction,
  type ClaimConflictReviewPacket,
  type ClaimConflictReviewPacketInput,
  type ClaimConflictReviewQueueKind,
  type ClaimConflictReviewStep,
  type ClaimConflictSafeWriteStatus
} from "./claim-conflict.js";
import {
  buildClaimConflictReviewPacket,
  type ClaimConflictAdjudicationSeverity,
  type ClaimConflictAdjudicationState,
  type ClaimConflictRecommendedAction,
  type ClaimConflictReviewPacket,
  type ClaimConflictReviewStep
} from "./claim-conflict.js";

export interface ClaimableFactEdge {
  edge_id: string;
  subject_id: string;
  object_id: string;
  relation: RelationType;
  component: string | null;
  component_id: string | null;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  primary_evidence_id: string;
  last_verified_at: Date | string;
  subject_name: string;
  object_name: string;
}

interface ClaimableFactEdgeRow extends pg.QueryResultRow, ClaimableFactEdge {}

export type ClaimEvidenceFusionRole = "primary" | "supporting";

export type ClaimEvidenceIndependenceBasis =
  | "primary_evidence"
  | "same_doc_same_chunk"
  | "same_document_different_chunk"
  | "same_source_different_document"
  | "different_source_adapter";

export interface ClaimFusionEvidence {
  evidence_id: string;
  doc_id: string;
  chunk_id: string | null;
  evidence_level: EvidenceLevel;
  confidence: number;
  source_adapter_id: string;
  document_type: DocumentType;
}

interface ClaimFusionEvidenceRow extends pg.QueryResultRow, ClaimFusionEvidence {}

interface MatchingActiveClaimRow extends pg.QueryResultRow {
  claim_id: string;
  edge_id: string | null;
}

interface ClaimConflictTargetRow extends pg.QueryResultRow {
  claim_id: string;
  claim_text: string;
  status: string;
  edge_id: string | null;
}

interface ClaimConflictEvidenceRow extends pg.QueryResultRow {
  evidence_id: string;
  doc_id: string;
  cite_locator: string | null;
  source_adapter_id: string;
  document_type: DocumentType;
}

interface ClaimUnknownLinkRow extends pg.QueryResultRow {
  claim_id: string;
}

interface ClaimConflictReviewScanRow extends pg.QueryResultRow {
  claim_id: string;
  claim_text: string;
  status: "draft" | "active";
  edge_id: string | null;
}

interface ClaimLifecycleStatusUpdateRow extends pg.QueryResultRow {
  claim_id: string;
  status: ClaimStatus;
}

export interface ClaimFusionContribution {
  evidence_id: string;
  role: ClaimEvidenceFusionRole;
  source_adapter_id: string;
  document_type: DocumentType;
  source_category: SourceCategory;
  publisher_type: PublisherType;
  relation_authority: RelationAuthority;
  independence_basis: ClaimEvidenceIndependenceBasis;
  independence_weight: number;
  adjusted_confidence: number;
}

export interface ClaimFusionResult {
  confidence: number;
  base_confidence: number;
  supporting_evidence_count: number;
  independent_source_count: number;
  contributions: ClaimFusionContribution[];
}

export interface EdgeClaimDraft {
  claim_id: string;
  claim_type: ClaimType;
  claim_text: string;
  subject_id: string;
  object_id: string;
  component_id?: string;
  edge_id: string;
  evidence_id: string;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: false;
  generated_by: string;
  last_verified_at: string;
}

export interface SemanticChangeClaimDraft {
  claim_id: string;
  claim_type: ClaimType;
  claim_text: string;
  review_id: string;
  status: "draft";
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: true;
  generated_by: string;
  last_verified_at: string;
}

export interface SemanticChangeClaimDraftResult {
  claim_id: string;
  inserted: boolean;
  conflict_unknown_id?: string;
  linked_conflict_claim_ids?: string[];
}

export interface BuildEdgeClaimsInput {
  min_evidence_level?: 4 | 5;
  limit?: number;
  generated_by?: string;
}

export interface BuildEdgeClaimsSummary {
  scanned: number;
  inserted: number;
  updated: number;
  generated_by: string;
}

export interface EnqueueClaimConflictReviewsInput {
  limit?: number;
}

export interface EnqueueClaimConflictReviewsSummary {
  scanned: number;
  enqueued: number;
  skipped: number;
}

export interface LinkContradictingEvidenceInput {
  claim_id: string;
  evidence_id: string;
  reason: string;
  created_by: string;
  unknown_id?: string;
}

export interface LinkContradictingEvidenceResult {
  claim_id: string;
  evidence_id: string;
  unknown_id: string;
  inserted_unknown: boolean;
}

export interface ResolveClaimConflictUnknownInput {
  claim_id: string;
  unknown_id: string;
  resolved_evidence_ids: readonly string[];
  reviewer: string;
  reason?: string;
}

export type ClaimConflictResolutionAction = "confirm_claim_valid" | "recommend_edge_deprecation" | "request_more_evidence";

export interface ResolveClaimConflictReviewInput {
  claim_id: string;
  action: ClaimConflictResolutionAction;
  reviewer: string;
  reason: string;
  unknown_id?: string;
  resolution_evidence_ids?: readonly string[];
}

export interface ResolveClaimConflictReviewResult {
  claim_id: string;
  action: ClaimConflictResolutionAction;
  edge_id: string | null;
  status: "recorded" | "unknown_resolved";
  unknown_id?: string;
  resolution_evidence_ids: string[];
}

export type ClaimLifecycleAction = "supersede_claim" | "reject_claim" | "keep_with_context";
export type ClaimLifecycleSourceKind = "evidence" | "review" | "claim" | "unknown" | "semantic_change";

export interface ClaimLifecycleSourceRef {
  kind: ClaimLifecycleSourceKind;
  id: string;
}

export interface ResolveClaimLifecycleInput {
  claim_id: string;
  action: ClaimLifecycleAction;
  reviewer: string;
  reason: string;
  source_refs: readonly ClaimLifecycleSourceRef[];
  superseded_by_claim_id?: string;
}

export interface ResolveClaimLifecycleResult {
  claim_id: string;
  action: ClaimLifecycleAction;
  status: "recorded" | "updated";
  previous_claim_status: ClaimStatus;
  new_claim_status: ClaimStatus;
  edge_id: string | null;
  edge_validity: ClaimRow["edge_validity"];
  source_refs: ClaimLifecycleSourceRef[];
  superseded_by_claim_id?: string;
}

export function claimTypeForRelation(relation: RelationType): ClaimType {
  if (relation === "MANUFACTURES_AT" || relation === "OPERATES_FACILITY") return "FACILITY_RELATION_CLAIM";
  if (relation === "USES_COMPONENT") return "COMPONENT_EXPOSURE_CLAIM";
  if (relation === "OWNS_SUBSIDIARY" || relation === "OWNS_BUSINESS_UNIT" || relation === "IS_A") return "ENTITY_FACT_CLAIM";
  return "SUPPLY_RELATION_CLAIM";
}

export function deterministicClaimIdForEdge(edgeId: string): string {
  const digest = createHash("sha256").update(`edge:${edgeId}`).digest("hex").slice(0, 24).toUpperCase();
  return `CLM-EDGE-${digest}`;
}

export function deterministicClaimIdForSemanticReview(reviewId: string): string {
  const digest = createHash("sha256").update(`semantic-review:${reviewId}`).digest("hex").slice(0, 24).toUpperCase();
  return `CLM-REVIEW-${digest}`;
}

export function deterministicConflictUnknownIdForSemanticReview(reviewId: string): string {
  const digest = createHash("sha256").update(`semantic-conflict:${reviewId}`).digest("hex").slice(0, 24).toUpperCase();
  return `UNK-CONFLICT-${digest}`;
}

export function deterministicConflictUnknownIdForClaimEvidence(claimId: string, evidenceId: string): string {
  const digest = createHash("sha256").update(`claim-evidence-conflict:${claimId}:${evidenceId}`).digest("hex").slice(0, 24).toUpperCase();
  return `UNK-CONFLICT-${digest}`;
}

export function isConflictingSemanticChange(changeType: string): boolean {
  return changeType.endsWith("_REMOVED");
}

export function buildClaimDraftFromEdge(edge: ClaimableFactEdge, input: { generated_by?: string } = {}): EdgeClaimDraft {
  if (edge.is_inferred) {
    throw new Error(`Cannot build active fact claim from inferred edge ${edge.edge_id}`);
  }
  const draftWithoutComponent: Omit<EdgeClaimDraft, "component_id"> = {
    claim_id: deterministicClaimIdForEdge(edge.edge_id),
    claim_type: claimTypeForRelation(edge.relation),
    claim_text: claimTextForEdge(edge),
    subject_id: edge.subject_id,
    object_id: edge.object_id,
    edge_id: edge.edge_id,
    evidence_id: edge.primary_evidence_id,
    evidence_level: edge.evidence_level,
    confidence: edge.confidence,
    is_inferred: false,
    generated_by: input.generated_by ?? "claim-builder.edge-fact.v1",
    last_verified_at: normalizeTimestamp(edge.last_verified_at)
  };
  if (edge.component_id === null) return draftWithoutComponent;
  return { ...draftWithoutComponent, component_id: edge.component_id };
}

export function fuseClaimConfidenceFromEvidence(
  evidences: readonly ClaimFusionEvidence[],
  input: { primary_evidence_id: string; base_confidence?: number }
): ClaimFusionResult {
  const primaryEvidence = evidences.find((evidence) => evidence.evidence_id === input.primary_evidence_id);
  if (primaryEvidence === undefined) {
    throw new Error(`Claim fusion cannot find primary evidence ${input.primary_evidence_id}`);
  }

  const baseConfidence = clampConfidence(input.base_confidence ?? primaryEvidence.confidence);
  const contributions = evidences.map((evidence) => contributionForEvidence(evidence, primaryEvidence));
  const remainingDoubt = contributions.reduce((product, contribution) => product * (1 - contribution.adjusted_confidence), 1);
  // 融合只提升 claim confidence；单条 evidence_level 保持原样，避免多条弱证据伪装成高等级事实。
  const fusedConfidence = Math.max(baseConfidence, Math.min(0.99, 1 - remainingDoubt));
  const independentSourceCount = new Set(contributions.filter((item) => item.adjusted_confidence > 0).map((item) => item.source_adapter_id)).size;

  return {
    confidence: roundConfidence(fusedConfidence),
    base_confidence: roundConfidence(baseConfidence),
    supporting_evidence_count: contributions.filter((item) => item.role === "supporting").length,
    independent_source_count: independentSourceCount,
    contributions
  };
}

export function buildClaimDraftFromSemanticChangeReview(
  candidate: SemanticChangeReviewCandidate,
  input: { generated_by?: string; reviewed_at?: string } = {}
): SemanticChangeClaimDraft {
  return {
    claim_id: deterministicClaimIdForSemanticReview(candidate.review_id),
    claim_type: claimTypeForSemanticChange(candidate),
    claim_text: claimTextForSemanticChange(candidate),
    review_id: candidate.review_id,
    status: "draft",
    evidence_level: 3,
    confidence: candidate.confidence,
    is_inferred: true,
    generated_by: input.generated_by ?? "claim-builder.semantic-change-draft.v1",
    last_verified_at: input.reviewed_at ?? new Date().toISOString()
  };
}

export async function upsertSemanticChangeClaimDraft(
  client: DbClient,
  candidate: SemanticChangeReviewCandidate,
  input: { generated_by?: string; reviewed_at?: string; caused_by?: string } = {}
): Promise<SemanticChangeClaimDraftResult> {
  const draft = buildClaimDraftFromSemanticChangeReview(candidate, input);
  const resolvedScope = await resolveSemanticChangeScope(client, candidate);
  const result = await upsertClaim(client, {
    claim_id: draft.claim_id,
    claim_type: draft.claim_type,
    claim_text: draft.claim_text,
    ...(resolvedScope.subject_id === undefined ? {} : { subject_id: resolvedScope.subject_id }),
    ...(resolvedScope.object_id === undefined ? {} : { object_id: resolvedScope.object_id }),
    ...(candidate.payload.component_id === undefined ? {} : { component_id: candidate.payload.component_id }),
    review_id: draft.review_id,
    status: draft.status,
    evidence_level: draft.evidence_level,
    confidence: draft.confidence,
    is_inferred: draft.is_inferred,
    generated_by: draft.generated_by,
    last_verified_at: draft.last_verified_at
  });
  await recordSemanticChange(client, {
    scope_kind: "claim",
    scope_id: result.claim_id,
    change_type: result.inserted ? "CLAIM_DRAFT_ADDED" : "CLAIM_DRAFT_UPDATED",
    after: {
      claim_type: draft.claim_type,
      review_id: candidate.review_id,
      change_type: candidate.payload.change_type,
      semantic_relation_kind: candidate.payload.semantic_relation_kind,
      relation: candidate.payload.relation,
      source_adapter_id: candidate.payload.source_adapter_id,
      doc_id: candidate.payload.doc_id
    },
    caused_by: input.caused_by ?? draft.generated_by
  });
  const conflictUnknown = await upsertConflictUnknownForSemanticChange(client, {
    candidate,
    draft,
    draft_claim_id: result.claim_id,
    resolved_scope: resolvedScope,
    created_by: input.caused_by ?? draft.generated_by
  });
  if (conflictUnknown === undefined) return result;
  return {
    ...result,
    conflict_unknown_id: conflictUnknown.unknown_id,
    linked_conflict_claim_ids: conflictUnknown.linked_claim_ids
  };
}

async function resolveSemanticChangeScope(client: DbClient, candidate: SemanticChangeReviewCandidate): Promise<{ subject_id?: string; object_id?: string }> {
  const subjectId = await tryResolveEntityId(client, candidate.payload.subject_surface);
  const objectId = await tryResolveEntityId(client, candidate.payload.object_surface);
  return {
    ...(subjectId === undefined ? {} : { subject_id: subjectId }),
    ...(objectId === undefined ? {} : { object_id: objectId })
  };
}

async function upsertConflictUnknownForSemanticChange(
  client: DbClient,
  input: {
    candidate: SemanticChangeReviewCandidate;
    draft: SemanticChangeClaimDraft;
    draft_claim_id: string;
    resolved_scope: { subject_id?: string; object_id?: string };
    created_by: string;
  }
): Promise<{ unknown_id: string; linked_claim_ids: string[] } | undefined> {
  if (!isConflictingSemanticChange(input.candidate.payload.change_type)) return undefined;
  const activeClaims = await listActiveClaimsForSemanticChange(client, input.candidate, input.resolved_scope);
  const primaryActiveClaim = activeClaims[0];
  const unknown = await upsertUnknownItem(client, {
    unknown_id: deterministicConflictUnknownIdForSemanticReview(input.candidate.review_id),
    scope_kind: primaryActiveClaim?.edge_id === null || primaryActiveClaim === undefined ? "claim" : "edge",
    scope_id: primaryActiveClaim?.edge_id ?? input.draft_claim_id,
    question: conflictUnknownQuestion(input.candidate),
    why_unknown: conflictUnknownReason(input.candidate),
    blocking_data_sources: conflictUnknownBlockingSources(input.candidate),
    proxies: conflictUnknownProxies(input.candidate),
    created_by: input.created_by
  });

  await linkClaimUnknown(client, { claim_id: input.draft_claim_id, unknown_id: unknown.unknown_id, role: "boundary" });
  const linkedClaimIds = [input.draft_claim_id];
  for (const claim of activeClaims) {
    await linkClaimUnknown(client, { claim_id: claim.claim_id, unknown_id: unknown.unknown_id, role: "blocking" });
    linkedClaimIds.push(claim.claim_id);
  }
  await recordSemanticChange(client, {
    scope_kind: "claim",
    scope_id: input.draft_claim_id,
    change_type: "CLAIM_CONFLICT_UNKNOWN_LINKED",
    after: {
      unknown_id: unknown.unknown_id,
      active_claim_ids: activeClaims.map((claim) => claim.claim_id),
      source_change_type: input.candidate.payload.change_type,
      relation: input.candidate.payload.relation,
      source_adapter_id: input.candidate.payload.source_adapter_id,
      doc_id: input.candidate.payload.doc_id
    },
    caused_by: input.created_by
  });
  return { unknown_id: unknown.unknown_id, linked_claim_ids: linkedClaimIds };
}

async function listActiveClaimsForSemanticChange(
  client: DbClient,
  candidate: SemanticChangeReviewCandidate,
  resolvedScope: { subject_id?: string; object_id?: string }
): Promise<MatchingActiveClaimRow[]> {
  if (resolvedScope.subject_id === undefined || resolvedScope.object_id === undefined) return [];
  const result = await client.query<MatchingActiveClaimRow>(
    `SELECT c.claim_id, c.edge_id
     FROM claims c
     JOIN edges e ON e.edge_id = c.edge_id
     WHERE c.status = 'active'
       AND c.is_inferred = false
       AND e.validity = 'current'
       AND e.is_inferred = false
       AND e.relation = $1
       AND c.subject_id = $2
       AND c.object_id = $3
       AND (($4::text IS NULL AND c.component_id IS NULL) OR c.component_id = $4)
     ORDER BY c.evidence_level DESC, c.confidence DESC, c.claim_id`,
    [candidate.payload.relation, resolvedScope.subject_id, resolvedScope.object_id, candidate.payload.component_id ?? null]
  );
  return result.rows;
}

export async function buildEdgeClaimsFromCurrentEdges(client: DbClient, input: BuildEdgeClaimsInput = {}): Promise<BuildEdgeClaimsSummary> {
  const generatedBy = input.generated_by ?? "claim-builder.edge-fact.v1";
  const edges = await listClaimableFactEdges(client, { min_evidence_level: input.min_evidence_level ?? 4, limit: input.limit ?? 500 });
  let inserted = 0;
  let updated = 0;

  for (const edge of edges) {
    const draft = buildClaimDraftFromEdge(edge, { generated_by: generatedBy });
    const evidenceSet = await listCurrentEvidenceForEdge(client, edge.edge_id, draft.evidence_id);
    const fusion = fuseClaimConfidenceFromEvidence(evidenceSet, {
      primary_evidence_id: draft.evidence_id,
      base_confidence: draft.confidence
    });
    const claimInput: Omit<NewClaimInput, "component_id"> = {
      claim_id: draft.claim_id,
      claim_type: draft.claim_type,
      claim_text: draft.claim_text,
      subject_id: draft.subject_id,
      object_id: draft.object_id,
      edge_id: draft.edge_id,
      status: "active",
      evidence_level: draft.evidence_level,
      confidence: fusion.confidence,
      is_inferred: draft.is_inferred,
      generated_by: draft.generated_by,
      last_verified_at: draft.last_verified_at
    };
    const result = await upsertClaim(client, draft.component_id === undefined ? claimInput : { ...claimInput, component_id: draft.component_id });
    for (const contribution of fusion.contributions) {
      await linkClaimEvidence(client, { claim_id: result.claim_id, evidence_id: contribution.evidence_id, role: contribution.role });
    }
    await recordSemanticChange(client, {
      scope_kind: "claim",
      scope_id: result.claim_id,
      change_type: result.inserted ? "CLAIM_ADDED" : "CLAIM_UPDATED",
      after: {
        claim_type: draft.claim_type,
        edge_id: draft.edge_id,
        subject_id: draft.subject_id,
        object_id: draft.object_id,
        component_id: draft.component_id,
        evidence_level: draft.evidence_level,
        confidence: fusion.confidence,
        base_confidence: fusion.base_confidence,
        supporting_evidence_count: fusion.supporting_evidence_count,
        independent_source_count: fusion.independent_source_count,
        source_independence: fusion.contributions.map((contribution) => ({
          evidence_id: contribution.evidence_id,
          role: contribution.role,
          source_adapter_id: contribution.source_adapter_id,
          document_type: contribution.document_type,
          source_category: contribution.source_category,
          publisher_type: contribution.publisher_type,
          relation_authority: contribution.relation_authority,
          independence_basis: contribution.independence_basis,
          independence_weight: contribution.independence_weight,
          adjusted_confidence: contribution.adjusted_confidence
        }))
      },
      evidence_ids: fusion.contributions.map((contribution) => contribution.evidence_id),
      caused_by: generatedBy
    });
    if (result.inserted) {
      inserted += 1;
    } else {
      updated += 1;
    }
  }

  return { scanned: edges.length, inserted, updated, generated_by: generatedBy };
}

export async function buildEdgeClaimsFromCurrentEdgesTransactionally(store: DatabaseStore, input: BuildEdgeClaimsInput = {}): Promise<BuildEdgeClaimsSummary> {
  return store.transaction((client) => buildEdgeClaimsFromCurrentEdges(client, input));
}

export async function enqueueClaimConflictReviewCandidates(
  client: DbClient,
  input: EnqueueClaimConflictReviewsInput = {}
): Promise<EnqueueClaimConflictReviewsSummary> {
  const rows = await listClaimsWithUnresolvedConflict(client, { limit: input.limit ?? 500 });
  const candidates: ClaimConflictReviewCandidate[] = [];

  for (const row of rows) {
    const [evidenceRefs, unknownRefs] = await Promise.all([listClaimEvidenceLinks(client, row.claim_id), listClaimUnknownLinks(client, row.claim_id)]);
    const packet = buildClaimConflictReviewPacket({
      claim_id: row.claim_id,
      claim_text: row.claim_text,
      claim_status: row.status,
      edge_id: row.edge_id,
      evidence_refs: evidenceRefs.map((ref) => ({ evidence_id: ref.evidence_id, role: ref.role })),
      unknown_refs: unknownRefs.map((ref) => ({ unknown_id: ref.unknown_id, role: ref.role, status: ref.status }))
    });
    const payload = claimConflictPacketToReviewPayload(packet, row.edge_id);
    if (payload === undefined) continue;
    candidates.push(buildClaimConflictReviewCandidate({ payload }));
  }

  const enqueue = await enqueueReviewCandidates(client, candidates);
  return { scanned: rows.length, enqueued: enqueue.inserted, skipped: enqueue.skipped };
}

export async function enqueueClaimConflictReviewCandidatesTransactionally(
  store: DatabaseStore,
  input: EnqueueClaimConflictReviewsInput = {}
): Promise<EnqueueClaimConflictReviewsSummary> {
  return store.transaction((client) => enqueueClaimConflictReviewCandidates(client, input));
}

export async function linkContradictingEvidenceToClaim(client: DbClient, input: LinkContradictingEvidenceInput): Promise<LinkContradictingEvidenceResult> {
  const claim = await requireConflictTargetClaim(client, input.claim_id);
  const evidence = await requireConflictEvidence(client, input.evidence_id);
  const unknown = await upsertUnknownItem(client, {
    unknown_id: input.unknown_id ?? deterministicConflictUnknownIdForClaimEvidence(input.claim_id, input.evidence_id),
    scope_kind: claim.edge_id === null ? "claim" : "edge",
    scope_id: claim.edge_id ?? claim.claim_id,
    question: `Does this claim remain valid: ${claim.claim_text}`,
    why_unknown: contradictingEvidenceUnknownReason(input.reason, evidence),
    blocking_data_sources: [evidence.source_adapter_id, "supporting evidence review", "counterparty official disclosure"],
    proxies: [evidence.doc_id, evidence.cite_locator ?? evidence.document_type],
    created_by: input.created_by
  });

  await linkClaimEvidence(client, { claim_id: claim.claim_id, evidence_id: evidence.evidence_id, role: "contradicting" });
  await linkClaimUnknown(client, { claim_id: claim.claim_id, unknown_id: unknown.unknown_id, role: "blocking" });
  await recordSemanticChange(client, {
    scope_kind: "claim",
    scope_id: claim.claim_id,
    change_type: "CLAIM_CONTRADICTING_EVIDENCE_LINKED",
    after: {
      unknown_id: unknown.unknown_id,
      evidence_id: evidence.evidence_id,
      doc_id: evidence.doc_id,
      source_adapter_id: evidence.source_adapter_id,
      document_type: evidence.document_type,
      reason: input.reason
    },
    evidence_ids: [evidence.evidence_id],
    caused_by: input.created_by
  });
  return { claim_id: claim.claim_id, evidence_id: evidence.evidence_id, unknown_id: unknown.unknown_id, inserted_unknown: unknown.inserted };
}

export async function resolveClaimConflictUnknown(
  client: DbClient,
  input: ResolveClaimConflictUnknownInput
): Promise<{ claim_id: string; unknown_id: string }> {
  await requireClaimUnknownLink(client, input.claim_id, input.unknown_id);
  await resolveUnknownItem(client, {
    unknown_id: input.unknown_id,
    resolved_evidence_ids: input.resolved_evidence_ids,
    reviewer: input.reviewer
  });
  await recordSemanticChange(client, {
    scope_kind: "claim",
    scope_id: input.claim_id,
    change_type: "CLAIM_CONFLICT_UNKNOWN_RESOLVED",
    after: {
      unknown_id: input.unknown_id,
      reason: input.reason
    },
    evidence_ids: input.resolved_evidence_ids,
    caused_by: input.reviewer
  });
  return { claim_id: input.claim_id, unknown_id: input.unknown_id };
}

export async function resolveClaimConflictReview(client: DbClient, input: ResolveClaimConflictReviewInput): Promise<ResolveClaimConflictReviewResult> {
  const claim = await requireConflictTargetClaim(client, input.claim_id);
  const resolutionEvidenceIds = [...(input.resolution_evidence_ids ?? [])];

  if (input.action === "confirm_claim_valid") {
    if (input.unknown_id === undefined) throw new Error("confirm_claim_valid requires unknown_id");
    if (resolutionEvidenceIds.length === 0) throw new Error("confirm_claim_valid requires at least one resolution evidence id");
    await resolveClaimConflictUnknown(client, {
      claim_id: claim.claim_id,
      unknown_id: input.unknown_id,
      resolved_evidence_ids: resolutionEvidenceIds,
      reviewer: input.reviewer,
      reason: input.reason
    });
    await recordClaimConflictResolutionAction(client, { ...input, claim, resolutionEvidenceIds, unknownId: input.unknown_id });
    return {
      claim_id: claim.claim_id,
      action: input.action,
      edge_id: claim.edge_id,
      status: "unknown_resolved",
      unknown_id: input.unknown_id,
      resolution_evidence_ids: resolutionEvidenceIds
    };
  }

  if (input.action === "recommend_edge_deprecation" && claim.edge_id === null) {
    throw new Error(`recommend_edge_deprecation requires claim ${claim.claim_id} to be linked to a fact edge`);
  }

  await recordClaimConflictResolutionAction(client, {
    ...input,
    claim,
    resolutionEvidenceIds,
    ...(input.unknown_id === undefined ? {} : { unknownId: input.unknown_id })
  });
  return {
    claim_id: claim.claim_id,
    action: input.action,
    edge_id: claim.edge_id,
    status: "recorded",
    ...(input.unknown_id === undefined ? {} : { unknown_id: input.unknown_id }),
    resolution_evidence_ids: resolutionEvidenceIds
  };
}

export async function resolveClaimConflictReviewTransactionally(
  store: DatabaseStore,
  input: ResolveClaimConflictReviewInput
): Promise<ResolveClaimConflictReviewResult> {
  return store.transaction((client) => resolveClaimConflictReview(client, input));
}

export async function resolveClaimLifecycle(client: DbClient, input: ResolveClaimLifecycleInput): Promise<ResolveClaimLifecycleResult> {
  const claim = await requireClaimLifecycleTarget(client, input.claim_id);
  const sourceRefs = normalizeClaimLifecycleSourceRefs(input.source_refs);
  if (input.reason.trim().length === 0) throw new Error("claim lifecycle action requires a non-empty reason");
  await requireClaimLifecycleSourceRefs(client, sourceRefs);

  if (input.action === "supersede_claim") {
    if (input.superseded_by_claim_id === undefined) throw new Error("supersede_claim requires superseded_by_claim_id");
    if (input.superseded_by_claim_id === claim.claim_id) throw new Error(`Claim ${claim.claim_id} cannot supersede itself`);
    await requireExistingClaim(client, input.superseded_by_claim_id);
    const updated = await updateClaimLifecycleStatus(client, claim.claim_id, "superseded");
    await recordClaimLifecycleAction(client, { input, claim, sourceRefs, newStatus: updated.status });
    return claimLifecycleResult(input, claim, sourceRefs, updated.status, "updated");
  }

  if (input.action === "reject_claim") {
    const updated = await updateClaimLifecycleStatus(client, claim.claim_id, "rejected");
    await recordClaimLifecycleAction(client, { input, claim, sourceRefs, newStatus: updated.status });
    return claimLifecycleResult(input, claim, sourceRefs, updated.status, "updated");
  }

  await recordClaimLifecycleAction(client, { input, claim, sourceRefs, newStatus: claim.status });
  return claimLifecycleResult(input, claim, sourceRefs, claim.status, "recorded");
}

export async function resolveClaimLifecycleTransactionally(store: DatabaseStore, input: ResolveClaimLifecycleInput): Promise<ResolveClaimLifecycleResult> {
  return store.transaction((client) => resolveClaimLifecycle(client, input));
}

async function listClaimableFactEdges(client: DbClient, input: { min_evidence_level: 4 | 5; limit: number }): Promise<ClaimableFactEdgeRow[]> {
  const result = await client.query<ClaimableFactEdgeRow>(
    `SELECT e.edge_id, e.subject_id, e.object_id, e.relation, e.component, e.component_id,
            e.evidence_level, e.confidence, e.is_inferred, e.primary_evidence_id, e.last_verified_at,
            s.display_name AS subject_name, o.display_name AS object_name
     FROM edges e
     JOIN entity_master s ON s.entity_id = e.subject_id
     JOIN entity_master o ON o.entity_id = e.object_id
     WHERE e.validity = 'current'
       AND e.evidence_level >= $1
       AND e.is_inferred = false
       AND e.primary_evidence_id IS NOT NULL
     ORDER BY e.evidence_level DESC, e.confidence DESC, e.edge_id
     LIMIT $2`,
    [input.min_evidence_level, input.limit]
  );
  return result.rows;
}

async function listCurrentEvidenceForEdge(client: DbClient, edgeId: string, primaryEvidenceId: string): Promise<ClaimFusionEvidenceRow[]> {
  const result = await client.query<ClaimFusionEvidenceRow>(
    `SELECT ev.evidence_id, ev.doc_id, ev.chunk_id, ev.evidence_level, ev.confidence,
            d.source_adapter_id, d.document_type
     FROM evidence ev
     JOIN documents d ON d.doc_id = ev.doc_id
     WHERE ev.edge_id = $1
       AND ev.superseded_by IS NULL
       AND ev.is_inferred = false
     ORDER BY CASE WHEN ev.evidence_id = $2 THEN 0 ELSE 1 END,
              ev.evidence_level DESC, ev.confidence DESC, ev.evidence_id`,
    [edgeId, primaryEvidenceId]
  );
  if (result.rows.every((row) => row.evidence_id !== primaryEvidenceId)) {
    throw new Error(`Current evidence for edge ${edgeId} did not include primary evidence ${primaryEvidenceId}`);
  }
  return result.rows;
}

async function requireConflictTargetClaim(client: DbClient, claimId: string): Promise<ClaimConflictTargetRow> {
  const result = await client.query<ClaimConflictTargetRow>(
    `SELECT claim_id, claim_text, status, edge_id
     FROM claims
     WHERE claim_id = $1`,
    [claimId]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Claim not found for contradicting evidence: ${claimId}`);
  if (row.status === "rejected" || row.status === "superseded") {
    throw new Error(`Cannot link contradicting evidence to inactive claim ${claimId} with status ${row.status}`);
  }
  return row;
}

async function requireConflictEvidence(client: DbClient, evidenceId: string): Promise<ClaimConflictEvidenceRow> {
  const result = await client.query<ClaimConflictEvidenceRow>(
    `SELECT ev.evidence_id, ev.doc_id, ev.cite_locator, d.source_adapter_id, d.document_type
     FROM evidence ev
     JOIN documents d ON d.doc_id = ev.doc_id
     WHERE ev.evidence_id = $1
       AND ev.superseded_by IS NULL`,
    [evidenceId]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Contradicting evidence not found or superseded: ${evidenceId}`);
  return row;
}

async function requireClaimUnknownLink(client: DbClient, claimId: string, unknownId: string): Promise<void> {
  const result = await client.query<ClaimUnknownLinkRow>(
    `SELECT claim_id
     FROM claim_unknowns
     WHERE claim_id = $1 AND unknown_id = $2`,
    [claimId, unknownId]
  );
  if (result.rows[0] === undefined) throw new Error(`Conflict unknown ${unknownId} is not linked to claim ${claimId}`);
}

async function requireClaimLifecycleTarget(client: DbClient, claimId: string): Promise<ClaimRow> {
  const claim = await getClaim(client, claimId);
  if (claim === undefined) throw new Error(`Claim not found for lifecycle action: ${claimId}`);
  if (claim.status === "rejected" || claim.status === "superseded") {
    throw new Error(`Cannot apply lifecycle action to inactive claim ${claimId} with status ${claim.status}`);
  }
  return claim;
}

async function updateClaimLifecycleStatus(
  client: DbClient,
  claimId: string,
  status: Extract<ClaimStatus, "superseded" | "rejected">
): Promise<{ status: ClaimStatus }> {
  const result = await client.query<ClaimLifecycleStatusUpdateRow>(
    `UPDATE claims
     SET status = $2,
         updated_at = now()
     WHERE claim_id = $1
       AND status NOT IN ('superseded','rejected')
     RETURNING claim_id, status`,
    [claimId, status]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Claim not found or already inactive: ${claimId}`);
  return { status: row.status };
}

async function requireExistingClaim(client: DbClient, claimId: string): Promise<void> {
  const claim = await getClaim(client, claimId);
  if (claim === undefined) throw new Error(`Superseding claim not found: ${claimId}`);
}

function normalizeClaimLifecycleSourceRefs(sourceRefs: readonly ClaimLifecycleSourceRef[]): ClaimLifecycleSourceRef[] {
  if (sourceRefs.length === 0) throw new Error("claim lifecycle action requires at least one source ref");
  const seen = new Set<string>();
  const normalized: ClaimLifecycleSourceRef[] = [];
  for (const sourceRef of sourceRefs) {
    const id = sourceRef.id.trim();
    if (id.length === 0) throw new Error(`claim lifecycle source ref has empty id for kind ${sourceRef.kind}`);
    const key = `${sourceRef.kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ kind: sourceRef.kind, id });
  }
  return normalized;
}

async function requireClaimLifecycleSourceRefs(client: DbClient, sourceRefs: readonly ClaimLifecycleSourceRef[]): Promise<void> {
  await requireExistingLifecycleRefs(client, "evidence", "evidence", "evidence_id", claimLifecycleIdsByKind(sourceRefs, "evidence"));
  await requireExistingLifecycleRefs(client, "review_candidates", "review", "review_id", claimLifecycleIdsByKind(sourceRefs, "review"));
  await requireExistingLifecycleRefs(client, "claims", "claim", "claim_id", claimLifecycleIdsByKind(sourceRefs, "claim"));
  await requireExistingLifecycleRefs(client, "unknown_items", "unknown", "unknown_id", claimLifecycleIdsByKind(sourceRefs, "unknown"));
  await requireExistingLifecycleRefs(client, "change_records", "semantic_change", "change_id", claimLifecycleIdsByKind(sourceRefs, "semantic_change"));
}

async function requireExistingLifecycleRefs(
  client: DbClient,
  tableName: "evidence" | "review_candidates" | "claims" | "unknown_items" | "change_records",
  kind: ClaimLifecycleSourceKind,
  idColumn: "evidence_id" | "review_id" | "claim_id" | "unknown_id" | "change_id",
  ids: readonly string[]
): Promise<void> {
  if (ids.length === 0) return;
  const result = await client.query<pg.QueryResultRow>(`SELECT ${idColumn} AS id FROM ${tableName} WHERE ${idColumn} = ANY($1::text[])`, [[...ids]]);
  const found = new Set(result.rows.map((row) => String(row["id"])));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) throw new Error(`Missing ${kind} source refs for claim lifecycle action: ${missing.join(", ")}`);
}

function claimLifecycleIdsByKind(sourceRefs: readonly ClaimLifecycleSourceRef[], kind: ClaimLifecycleSourceKind): string[] {
  return sourceRefs.filter((sourceRef) => sourceRef.kind === kind).map((sourceRef) => sourceRef.id);
}

async function recordClaimLifecycleAction(
  client: DbClient,
  input: {
    input: ResolveClaimLifecycleInput;
    claim: ClaimRow;
    sourceRefs: ClaimLifecycleSourceRef[];
    newStatus: ClaimStatus;
  }
): Promise<void> {
  await recordSemanticChange(client, {
    scope_kind: "claim",
    scope_id: input.claim.claim_id,
    change_type: "CLAIM_LIFECYCLE_ACTION_RECORDED",
    before: {
      status: input.claim.status,
      edge_id: input.claim.edge_id,
      edge_validity: input.claim.edge_validity
    },
    after: {
      action: input.input.action,
      status: input.newStatus,
      reason: input.input.reason,
      source_refs: input.sourceRefs,
      superseded_by_claim_id: input.input.superseded_by_claim_id,
      edge_id: input.claim.edge_id,
      edge_validity: input.claim.edge_validity,
      edge_deprecated_reason: input.claim.edge_deprecated_reason,
      edge_superseded_by_edge_id: input.claim.edge_superseded_by_edge_id
    },
    evidence_ids: claimLifecycleIdsByKind(input.sourceRefs, "evidence"),
    caused_by: input.input.reviewer
  });
}

function claimLifecycleResult(
  input: ResolveClaimLifecycleInput,
  claim: ClaimRow,
  sourceRefs: ClaimLifecycleSourceRef[],
  newStatus: ClaimStatus,
  status: ResolveClaimLifecycleResult["status"]
): ResolveClaimLifecycleResult {
  return {
    claim_id: claim.claim_id,
    action: input.action,
    status,
    previous_claim_status: claim.status,
    new_claim_status: newStatus,
    edge_id: claim.edge_id,
    edge_validity: claim.edge_validity,
    source_refs: sourceRefs,
    ...(input.superseded_by_claim_id === undefined ? {} : { superseded_by_claim_id: input.superseded_by_claim_id })
  };
}

async function recordClaimConflictResolutionAction(
  client: DbClient,
  input: ResolveClaimConflictReviewInput & {
    claim: ClaimConflictTargetRow;
    resolutionEvidenceIds: string[];
    unknownId?: string;
  }
): Promise<void> {
  await recordSemanticChange(client, {
    scope_kind: "claim",
    scope_id: input.claim.claim_id,
    change_type: "CLAIM_CONFLICT_RESOLUTION_ACTION_RECORDED",
    after: {
      action: input.action,
      edge_id: input.claim.edge_id,
      unknown_id: input.unknownId,
      reason: input.reason,
      safe_write_policy: {
        automatic_fact_mutation_allowed: false,
        allowed_edge_mutation: "none",
        claim_status_mutation_allowed: false
      }
    },
    evidence_ids: input.resolutionEvidenceIds,
    caused_by: input.reviewer
  });
}

async function listClaimsWithUnresolvedConflict(client: DbClient, input: { limit: number }): Promise<ClaimConflictReviewScanRow[]> {
  const result = await client.query<ClaimConflictReviewScanRow>(
    `SELECT c.claim_id, c.claim_text, c.status, c.edge_id
     FROM claims c
     WHERE c.status IN ('draft','active')
       AND (
         EXISTS (
           SELECT 1
           FROM claim_evidence ce
           WHERE ce.claim_id = c.claim_id
             AND ce.role = 'contradicting'
         )
         OR EXISTS (
           SELECT 1
           FROM claim_unknowns cu
           JOIN unknown_items ui ON ui.unknown_id = cu.unknown_id
           WHERE cu.claim_id = c.claim_id
             AND cu.role IN ('blocking','boundary')
             AND ui.status = 'open'
         )
       )
     ORDER BY c.updated_at DESC, c.claim_id
     LIMIT $1`,
    [input.limit]
  );
  return result.rows;
}

function claimConflictPacketToReviewPayload(packet: ClaimConflictReviewPacket, edgeId: string | null): ClaimConflictReviewPayload | undefined {
  if (packet.safe_write_status !== "blocked_pending_review") return undefined;
  const conflictState = claimConflictReviewState(packet.conflict_state);
  const severity = claimConflictReviewSeverity(packet.severity);
  const recommendedAction = claimConflictReviewRecommendedAction(packet.recommended_action);
  const reviewSteps = claimConflictReviewStepsForCandidate(packet.required_review_steps);
  if (conflictState === undefined || severity === undefined || recommendedAction === undefined || reviewSteps === undefined) return undefined;

  return {
    claim_id: packet.claim_id,
    claim_text: packet.claim_text,
    edge_id: edgeId,
    conflict_state: conflictState,
    severity,
    recommended_action: recommendedAction,
    safe_write_status: "blocked_pending_review",
    edge_review_required: packet.edge_review_required,
    required_review_steps: reviewSteps,
    evidence_refs: packet.evidence_refs.map((ref) => ({ evidence_id: ref.evidence_id, role: ref.role })),
    unknown_refs: packet.unknown_refs.map((ref) => ({ unknown_id: ref.unknown_id, role: ref.role, status: ref.status })),
    fact_write_policy: {
      automatic_fact_mutation_allowed: false,
      allowed_edge_mutation: "none",
      requires_human_review: true,
      reason_codes: [...packet.fact_write_policy.reason_codes]
    }
  };
}

function claimConflictReviewState(state: ClaimConflictAdjudicationState): ClaimConflictReviewState | undefined {
  if (state === "open_conflict" || state === "contradicting_evidence") return state;
  return undefined;
}

function claimConflictReviewSeverity(severity: ClaimConflictAdjudicationSeverity): ClaimConflictReviewSeverity | undefined {
  if (severity === "medium" || severity === "high") return severity;
  return undefined;
}

function claimConflictReviewRecommendedAction(action: ClaimConflictRecommendedAction): ClaimConflictReviewRecommendedAction | undefined {
  if (action === "review_claim" || action === "review_edge_for_deprecation" || action === "collect_resolution_evidence") return action;
  return undefined;
}

function claimConflictReviewStepsForCandidate(steps: readonly ClaimConflictReviewStep[]): CandidateClaimConflictReviewStep[] | undefined {
  const result: CandidateClaimConflictReviewStep[] = [];
  for (const step of steps) {
    if (step === "record_resolution_context") return undefined;
    result.push(step);
  }
  return result;
}

function contributionForEvidence(evidence: ClaimFusionEvidence, primaryEvidence: ClaimFusionEvidence): ClaimFusionContribution {
  const role: ClaimEvidenceFusionRole = evidence.evidence_id === primaryEvidence.evidence_id ? "primary" : "supporting";
  const independence = role === "primary" ? { basis: "primary_evidence" as const, weight: 1 } : sourceIndependenceAgainstPrimary(evidence, primaryEvidence);
  const source = getSourceById(evidence.source_adapter_id);
  const authority = sourceAuthorityFor({ source_adapter_id: evidence.source_adapter_id, document_type: evidence.document_type });

  return {
    evidence_id: evidence.evidence_id,
    role,
    source_adapter_id: evidence.source_adapter_id,
    document_type: evidence.document_type,
    source_category: source?.category ?? "manual",
    publisher_type: authority.publisher_type,
    relation_authority: authority.relation_authority,
    independence_basis: independence.basis,
    independence_weight: independence.weight,
    adjusted_confidence: roundConfidence(clampConfidence(evidence.confidence) * independence.weight)
  };
}

function sourceIndependenceAgainstPrimary(
  evidence: ClaimFusionEvidence,
  primaryEvidence: ClaimFusionEvidence
): { basis: Exclude<ClaimEvidenceIndependenceBasis, "primary_evidence">; weight: number } {
  if (evidence.doc_id === primaryEvidence.doc_id && evidence.chunk_id === primaryEvidence.chunk_id) {
    return { basis: "same_doc_same_chunk", weight: 0 };
  }
  if (evidence.doc_id === primaryEvidence.doc_id) {
    return { basis: "same_document_different_chunk", weight: 0.25 };
  }
  if (evidence.source_adapter_id === primaryEvidence.source_adapter_id) {
    return { basis: "same_source_different_document", weight: 0.5 };
  }
  return { basis: "different_source_adapter", weight: 1 };
}

function claimTextForEdge(edge: ClaimableFactEdge): string {
  const componentObject = componentObjectText(edge.component);
  const componentContext = componentContextText(edge.component);
  if (edge.relation === "BUYS_FROM") return `${edge.subject_name} publicly discloses that it buys${componentObject} from ${edge.object_name}.`;
  if (edge.relation === "SUPPLIES_TO") return `${edge.subject_name} publicly discloses that it supplies${componentObject} to ${edge.object_name}.`;
  if (edge.relation === "USES_FOUNDRY") return `${edge.subject_name} publicly discloses that it uses ${edge.object_name} as a foundry${componentContext}.`;
  if (edge.relation === "USES_COMPONENT") return `${edge.subject_name} publicly discloses exposure to${componentObject} through ${edge.object_name}.`;
  if (edge.relation === "MANUFACTURES_AT") return `${edge.subject_name} publicly discloses manufacturing activity at ${edge.object_name}${componentContext}.`;
  if (edge.relation === "OPERATES_FACILITY") return `${edge.subject_name} publicly discloses that it operates ${edge.object_name}${componentContext}.`;
  if (edge.relation === "OWNS_SUBSIDIARY") return `${edge.subject_name} publicly discloses ownership of subsidiary ${edge.object_name}.`;
  if (edge.relation === "OWNS_BUSINESS_UNIT") return `${edge.subject_name} publicly discloses ownership of business unit ${edge.object_name}.`;
  if (edge.relation === "IS_A") return `${edge.subject_name} publicly discloses that ${edge.object_name} is part of its entity structure.`;
  return `${edge.subject_name} publicly discloses a ${edge.relation} relationship with ${edge.object_name}${componentContext}.`;
}

function claimTypeForSemanticChange(candidate: SemanticChangeReviewCandidate): ClaimType {
  const changeType = candidate.payload.change_type;
  if (changeType.includes("CUSTOMER")) return "DEMAND_SIGNAL_CLAIM";
  if (changeType.includes("PURCHASE_OBLIGATION") || changeType.includes("CAPACITY_RESERVATION") || changeType.includes("SINGLE_SOURCE_RISK"))
    return "RISK_SIGNAL_CLAIM";
  return "SUPPLY_RELATION_CLAIM";
}

function claimTextForSemanticChange(candidate: SemanticChangeReviewCandidate): string {
  const payload = candidate.payload;
  const component = payload.component ?? payload.component_id;
  const componentText = component === undefined ? "" : ` (${component})`;
  const direction = semanticChangeDirection(payload.change_type);
  return [
    "Reviewed official-disclosure monitoring",
    direction,
    `${payload.semantic_relation_kind}:`,
    `${payload.subject_surface} -${payload.relation}-> ${payload.object_surface}${componentText}.`,
    "This is a draft signal and is not an active fact edge."
  ].join(" ");
}

function conflictUnknownQuestion(candidate: SemanticChangeReviewCandidate): string {
  const payload = candidate.payload;
  const component = payload.component ?? payload.component_id;
  const componentText = component === undefined ? "" : ` for ${component}`;
  return `Does ${payload.subject_surface} still have a publicly disclosed ${payload.relation} relationship with ${payload.object_surface}${componentText}?`;
}

function conflictUnknownReason(candidate: SemanticChangeReviewCandidate): string {
  const payload = candidate.payload;
  return [
    `A reviewed official-disclosure semantic change reported ${payload.change_type}.`,
    "That means the monitored relation disappeared from the latest comparable disclosure text, or no longer matched the deterministic relation fingerprint.",
    "The existing fact claim must be treated as contested until the underlying edge/evidence is reviewed; this unknown does not deprecate or create a fact edge."
  ].join(" ");
}

function conflictUnknownBlockingSources(candidate: SemanticChangeReviewCandidate): string[] {
  return [candidate.payload.source_adapter_id, "latest official disclosure", "historical supporting evidence", "counterparty official disclosure"];
}

function conflictUnknownProxies(candidate: SemanticChangeReviewCandidate): string[] {
  return [candidate.evidence.source_url, candidate.payload.cite_locator, candidate.payload.fingerprint].filter((value) => value.trim().length > 0);
}

function contradictingEvidenceUnknownReason(reason: string, evidence: ClaimConflictEvidenceRow): string {
  return [
    reason,
    `Evidence ${evidence.evidence_id} from ${evidence.source_adapter_id} (${evidence.document_type}) has been linked as contradicting context.`,
    "The claim must be treated as contested until reviewed; this does not deprecate the fact edge or create a replacement edge."
  ].join(" ");
}

function semanticChangeDirection(changeType: string): string {
  if (changeType.endsWith("_ADDED")) return "flagged a newly observed candidate";
  if (changeType.endsWith("_REMOVED")) return "flagged a no-longer-observed candidate";
  if (changeType.endsWith("_CHANGED")) return "flagged changed wording for a monitored candidate";
  return "flagged a monitored candidate change";
}

function componentObjectText(component: string | null): string {
  const value = component?.trim();
  if (value === undefined || value.length === 0) return "";
  return ` ${value}`;
}

function componentContextText(component: string | null): string {
  const value = component?.trim();
  if (value === undefined || value.length === 0) return "";
  return ` for ${value}`;
}

function normalizeTimestamp(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) throw new Error(`Invalid confidence value: ${value}`);
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function roundConfidence(value: number): number {
  return Math.round(value * 10000) / 10000;
}
