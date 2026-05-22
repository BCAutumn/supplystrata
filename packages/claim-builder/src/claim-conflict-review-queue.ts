import { listClaimEvidenceLinks, listClaimUnknownLinks, type DatabaseStore, type DbClient, type DbTxClient } from "@supplystrata/db";
import {
  buildClaimConflictReviewCandidate,
  type ClaimConflictReviewCandidate,
  type ClaimConflictReviewPayload,
  type ClaimConflictReviewRecommendedAction,
  type ClaimConflictReviewSeverity,
  type ClaimConflictReviewState,
  type ClaimConflictReviewStep as CandidateClaimConflictReviewStep
} from "@supplystrata/review-candidates";
import { enqueueReviewCandidates } from "@supplystrata/review-store";
import {
  buildClaimConflictReviewPacket,
  type ClaimConflictAdjudicationSeverity,
  type ClaimConflictAdjudicationState,
  type ClaimConflictRecommendedAction,
  type ClaimConflictReviewPacket,
  type ClaimConflictReviewStep
} from "./claim-conflict.js";
import type { ClaimConflictReviewScanRow } from "./db-rows.js";

export interface EnqueueClaimConflictReviewsInput {
  limit?: number;
}

export interface EnqueueClaimConflictReviewsSummary {
  scanned: number;
  enqueued: number;
  skipped: number;
}

export async function enqueueClaimConflictReviewCandidates(
  client: DbTxClient,
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
