import { buildClaimConflictContext } from "@supplystrata/claim-builder";
import { listClaimEvidenceLinks, listClaimUnknownLinks, type ClaimEvidenceRole, type ClaimUnknownRole, type DbClient } from "@supplystrata/db/read";
import type { ClaimDtoSource } from "./dto-source-records.js";
import type { WorkbenchClaim, WorkbenchClaimEvidenceRef, WorkbenchClaimLifecycleWarning, WorkbenchClaimUnknownRef } from "./definitions.js";
import { toIsoString } from "./dto-mappers.js";

export async function claimToDto(client: DbClient, row: ClaimDtoSource): Promise<WorkbenchClaim> {
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

export function mergeWorkbenchClaims(claims: readonly WorkbenchClaim[]): WorkbenchClaim[] {
  const byId = new Map<string, WorkbenchClaim>();
  for (const claim of claims) byId.set(claim.claim_id, claim);
  return [...byId.values()].sort(compareWorkbenchClaims);
}

function compareWorkbenchClaims(left: WorkbenchClaim, right: WorkbenchClaim): number {
  const lifecycleOrder = Number(right.lifecycle_warnings.length > 0) - Number(left.lifecycle_warnings.length > 0);
  if (lifecycleOrder !== 0) return lifecycleOrder;
  return right.evidence_level - left.evidence_level || right.confidence - left.confidence || left.claim_id.localeCompare(right.claim_id);
}

function claimLifecycleWarnings(row: ClaimDtoSource): WorkbenchClaimLifecycleWarning[] {
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
