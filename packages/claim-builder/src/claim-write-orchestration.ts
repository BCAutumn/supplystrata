import {
  linkClaimEvidence,
  linkClaimUnknown,
  recordSemanticChange,
  resolveUnknownItem,
  tryResolveEntityId,
  upsertClaim,
  upsertUnknownItem,
  type DatabaseStore,
  type DbClient,
  type DbTxClient,
  type NewClaimInput
} from "@supplystrata/db";
import type { SemanticChangeReviewCandidate } from "@supplystrata/review-candidates";
import type {
  ClaimableFactEdgeRow,
  ClaimConflictEvidenceRow,
  ClaimConflictTargetRow,
  ClaimFusionEvidenceRow,
  ClaimUnknownLinkRow,
  MatchingActiveClaimRow
} from "./db-rows.js";
import {
  buildClaimDraftFromEdge,
  buildClaimDraftFromSemanticChangeReview,
  deterministicConflictUnknownIdForClaimEvidence,
  deterministicConflictUnknownIdForSemanticReview,
  isConflictingSemanticChange,
  type SemanticChangeClaimDraft
} from "./claim-drafts.js";
import { fuseClaimConfidenceFromEvidence } from "./claim-fusion.js";

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

export async function upsertSemanticChangeClaimDraft(
  client: DbTxClient,
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
  client: DbTxClient,
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

export async function buildEdgeClaimsFromCurrentEdges(client: DbTxClient, input: BuildEdgeClaimsInput = {}): Promise<BuildEdgeClaimsSummary> {
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

export async function linkContradictingEvidenceToClaim(client: DbTxClient, input: LinkContradictingEvidenceInput): Promise<LinkContradictingEvidenceResult> {
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
  client: DbTxClient,
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

export async function resolveClaimConflictReview(client: DbTxClient, input: ResolveClaimConflictReviewInput): Promise<ResolveClaimConflictReviewResult> {
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

async function recordClaimConflictResolutionAction(
  client: DbTxClient,
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
