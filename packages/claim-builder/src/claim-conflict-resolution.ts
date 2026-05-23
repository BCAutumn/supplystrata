import {
  linkClaimEvidence,
  linkClaimUnknown,
  recordSemanticChange,
  resolveUnknownItem,
  upsertUnknownItem,
  type DatabaseStore,
  type DbTxClient
} from "@supplystrata/db/write";
import type { DbClient } from "@supplystrata/db/read";
import type { ClaimConflictEvidenceRow, ClaimConflictTargetRow, ClaimUnknownLinkRow } from "./db-rows.js";
import { deterministicConflictUnknownIdForClaimEvidence } from "./claim-drafts.js";

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

function contradictingEvidenceUnknownReason(reason: string, evidence: ClaimConflictEvidenceRow): string {
  return [
    reason,
    `Evidence ${evidence.evidence_id} from ${evidence.source_adapter_id} (${evidence.document_type}) has been linked as contradicting context.`,
    "The claim must be treated as contested until reviewed; this does not deprecate the fact edge or create a replacement edge."
  ].join(" ");
}
