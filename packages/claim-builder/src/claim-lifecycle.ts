import { getClaim, type ClaimRow, type ClaimStatus, type DbClient } from "@supplystrata/db/read";
import { recordSemanticChange, type DatabaseStore, type DbTxClient } from "@supplystrata/db/write";
import type { ClaimLifecycleSourceRefRow, ClaimLifecycleStatusUpdateRow } from "./db-rows.js";

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

export async function resolveClaimLifecycle(client: DbTxClient, input: ResolveClaimLifecycleInput): Promise<ResolveClaimLifecycleResult> {
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

async function requireClaimLifecycleTarget(client: DbClient, claimId: string): Promise<ClaimRow> {
  const claim = await getClaim(client, claimId);
  if (claim === undefined) throw new Error(`Claim not found for lifecycle action: ${claimId}`);
  if (claim.status === "rejected" || claim.status === "superseded") {
    throw new Error(`Cannot apply lifecycle action to inactive claim ${claimId} with status ${claim.status}`);
  }
  return claim;
}

async function updateClaimLifecycleStatus(
  client: DbTxClient,
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
  const result = await client.query<ClaimLifecycleSourceRefRow>(`SELECT ${idColumn} AS id FROM ${tableName} WHERE ${idColumn} = ANY($1::text[])`, [[...ids]]);
  const found = new Set(result.rows.map((row) => row.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) throw new Error(`Missing ${kind} source refs for claim lifecycle action: ${missing.join(", ")}`);
}

function claimLifecycleIdsByKind(sourceRefs: readonly ClaimLifecycleSourceRef[], kind: ClaimLifecycleSourceKind): string[] {
  return sourceRefs.filter((sourceRef) => sourceRef.kind === kind).map((sourceRef) => sourceRef.id);
}

async function recordClaimLifecycleAction(
  client: DbTxClient,
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
