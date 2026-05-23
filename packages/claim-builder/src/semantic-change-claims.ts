import { linkClaimUnknown, recordSemanticChange, upsertClaim, upsertUnknownItem, type DbTxClient } from "@supplystrata/db/write";
import { tryResolveEntityId, type DbClient } from "@supplystrata/db/read";
import type { SemanticChangeReviewCandidate } from "@supplystrata/review-candidates";
import type { MatchingActiveClaimRow } from "./db-rows.js";
import {
  buildClaimDraftFromSemanticChangeReview,
  deterministicConflictUnknownIdForSemanticReview,
  isConflictingSemanticChange,
  type SemanticChangeClaimDraft
} from "./claim-drafts.js";

export interface SemanticChangeClaimDraftResult {
  claim_id: string;
  inserted: boolean;
  conflict_unknown_id?: string;
  linked_conflict_claim_ids?: string[];
}

export async function upsertSemanticChangeClaimDraft(
  client: DbTxClient,
  candidate: SemanticChangeReviewCandidate,
  input: { generated_by?: string; reviewed_at: string; caused_by?: string }
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
