import type pg from "pg";
import { createId, type ClaimType, type EdgeValidity, type EvidenceLevel } from "@supplystrata/core";
import type { DbClient } from "./client.js";

export type ClaimStatus = "draft" | "active" | "superseded" | "rejected";
export type ClaimEvidenceRole = "primary" | "supporting" | "contradicting" | "context";
export type ClaimUnknownRole = "boundary" | "blocking" | "context";

export interface ClaimRow extends pg.QueryResultRow {
  claim_id: string;
  claim_type: ClaimType;
  claim_text: string;
  subject_id: string | null;
  object_id: string | null;
  component_id: string | null;
  edge_id: string | null;
  review_id: string | null;
  status: ClaimStatus;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  generated_by: string;
  last_verified_at: Date;
  created_at: Date;
  updated_at: Date;
  edge_validity: EdgeValidity | null;
  edge_deprecated_reason: string | null;
  edge_superseded_by_edge_id: string | null;
}

interface UpsertClaimRow extends pg.QueryResultRow {
  claim_id: string;
  inserted: boolean;
}

export interface ClaimEvidenceLinkRow extends pg.QueryResultRow {
  claim_id: string;
  evidence_id: string;
  role: ClaimEvidenceRole;
}

export interface ClaimUnknownLinkRow extends pg.QueryResultRow {
  claim_id: string;
  unknown_id: string;
  role: ClaimUnknownRole;
  status: string;
}

export interface NewClaimInput {
  claim_id?: string;
  claim_type: ClaimType;
  claim_text: string;
  subject_id?: string;
  object_id?: string;
  component_id?: string;
  edge_id?: string;
  review_id?: string;
  status?: ClaimStatus;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  generated_by: string;
  last_verified_at?: string;
}

export interface UpsertClaimResult {
  claim_id: string;
  inserted: boolean;
}

export async function insertClaim(client: DbClient, input: NewClaimInput): Promise<{ claim_id: string }> {
  const claimId = input.claim_id ?? createId("CLM");
  await client.query(
    `INSERT INTO claims (
       claim_id, claim_type, claim_text, subject_id, object_id, component_id, edge_id, review_id,
       status, evidence_level, confidence, is_inferred, generated_by, last_verified_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14::timestamptz, now()))`,
    [
      claimId,
      input.claim_type,
      input.claim_text,
      input.subject_id ?? null,
      input.object_id ?? null,
      input.component_id ?? null,
      input.edge_id ?? null,
      input.review_id ?? null,
      input.status ?? "active",
      input.evidence_level,
      input.confidence,
      input.is_inferred,
      input.generated_by,
      input.last_verified_at ?? null
    ]
  );
  return { claim_id: claimId };
}

export async function upsertClaim(client: DbClient, input: NewClaimInput): Promise<UpsertClaimResult> {
  const claimId = input.claim_id ?? createId("CLM");
  const result = await client.query<UpsertClaimRow>(
    `INSERT INTO claims (
       claim_id, claim_type, claim_text, subject_id, object_id, component_id, edge_id, review_id,
       status, evidence_level, confidence, is_inferred, generated_by, last_verified_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14::timestamptz, now()))
     ON CONFLICT (claim_id) DO UPDATE SET
       claim_type = EXCLUDED.claim_type,
       claim_text = EXCLUDED.claim_text,
       subject_id = EXCLUDED.subject_id,
       object_id = EXCLUDED.object_id,
       component_id = EXCLUDED.component_id,
       edge_id = EXCLUDED.edge_id,
       review_id = EXCLUDED.review_id,
       status = CASE
         WHEN claims.status IN ('superseded','rejected') THEN claims.status
         ELSE EXCLUDED.status
       END,
       evidence_level = EXCLUDED.evidence_level,
       confidence = EXCLUDED.confidence,
       is_inferred = EXCLUDED.is_inferred,
       generated_by = EXCLUDED.generated_by,
       last_verified_at = EXCLUDED.last_verified_at,
       updated_at = now()
     RETURNING claim_id, (xmax = 0) AS inserted`,
    [
      claimId,
      input.claim_type,
      input.claim_text,
      input.subject_id ?? null,
      input.object_id ?? null,
      input.component_id ?? null,
      input.edge_id ?? null,
      input.review_id ?? null,
      input.status ?? "active",
      input.evidence_level,
      input.confidence,
      input.is_inferred,
      input.generated_by,
      input.last_verified_at ?? null
    ]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Claim upsert did not return a row: ${claimId}`);
  return { claim_id: row.claim_id, inserted: row.inserted };
}

export async function linkClaimEvidence(client: DbClient, input: { claim_id: string; evidence_id: string; role: ClaimEvidenceRole }): Promise<void> {
  await client.query(
    `INSERT INTO claim_evidence (claim_id, evidence_id, role)
     VALUES ($1,$2,$3)
     ON CONFLICT (claim_id, evidence_id) DO UPDATE SET role = EXCLUDED.role`,
    [input.claim_id, input.evidence_id, input.role]
  );
}

export async function linkClaimUnknown(client: DbClient, input: { claim_id: string; unknown_id: string; role: ClaimUnknownRole }): Promise<void> {
  await client.query(
    `INSERT INTO claim_unknowns (claim_id, unknown_id, role)
     VALUES ($1,$2,$3)
     ON CONFLICT (claim_id, unknown_id) DO UPDATE SET role = EXCLUDED.role`,
    [input.claim_id, input.unknown_id, input.role]
  );
}

export async function listClaimEvidenceLinks(client: DbClient, claimId: string): Promise<ClaimEvidenceLinkRow[]> {
  const result = await client.query<ClaimEvidenceLinkRow>(
    `SELECT claim_id, evidence_id, role
     FROM claim_evidence
     WHERE claim_id = $1
     ORDER BY CASE role
       WHEN 'primary' THEN 0
       WHEN 'supporting' THEN 1
       WHEN 'contradicting' THEN 2
       ELSE 3
     END, evidence_id`,
    [claimId]
  );
  return result.rows;
}

export async function listClaimUnknownLinks(client: DbClient, claimId: string): Promise<ClaimUnknownLinkRow[]> {
  const result = await client.query<ClaimUnknownLinkRow>(
    `SELECT cu.claim_id, cu.unknown_id, cu.role, ui.status
     FROM claim_unknowns cu
     JOIN unknown_items ui ON ui.unknown_id = cu.unknown_id
     WHERE cu.claim_id = $1
     ORDER BY CASE ui.status WHEN 'open' THEN 0 ELSE 1 END,
              CASE cu.role WHEN 'blocking' THEN 0 WHEN 'boundary' THEN 1 ELSE 2 END,
              cu.unknown_id`,
    [claimId]
  );
  return result.rows;
}

export async function getClaim(client: DbClient, claimId: string): Promise<ClaimRow | undefined> {
  const result = await client.query<ClaimRow>(
    `SELECT c.claim_id, c.claim_type, c.claim_text, c.subject_id, c.object_id, c.component_id, c.edge_id, c.review_id,
            c.status, c.evidence_level, c.confidence, c.is_inferred, c.generated_by, c.last_verified_at, c.created_at, c.updated_at,
            e.validity AS edge_validity,
            e.deprecated_reason AS edge_deprecated_reason,
            e.superseded_by_edge_id AS edge_superseded_by_edge_id
     FROM claims c
     LEFT JOIN edges e ON e.edge_id = c.edge_id
     WHERE c.claim_id = $1`,
    [claimId]
  );
  return result.rows[0];
}

export type ClaimScope = { kind: "entity"; id: string } | { kind: "component"; id: string } | { kind: "edge"; id: string };

export async function listClaimsByScope(client: DbClient, input: { scope: ClaimScope; includeInactive?: boolean; limit?: number }): Promise<ClaimRow[]> {
  const limit = input.limit ?? 50;
  const statusPredicate = input.includeInactive === true ? "true" : "c.status = 'active'";
  const result = await client.query<ClaimRow>(
    `SELECT c.claim_id, c.claim_type, c.claim_text, c.subject_id, c.object_id, c.component_id, c.edge_id, c.review_id,
            c.status, c.evidence_level, c.confidence, c.is_inferred, c.generated_by, c.last_verified_at, c.created_at, c.updated_at,
            e.validity AS edge_validity,
            e.deprecated_reason AS edge_deprecated_reason,
            e.superseded_by_edge_id AS edge_superseded_by_edge_id
     FROM claims c
     LEFT JOIN edges e ON e.edge_id = c.edge_id
     WHERE ${scopePredicate(input.scope, "c")} AND ${statusPredicate}
     ORDER BY c.evidence_level DESC, c.confidence DESC, c.updated_at DESC, c.claim_id
     LIMIT $2`,
    [input.scope.id, limit]
  );
  return result.rows;
}

export async function listDraftClaims(client: DbClient, input: { scope?: ClaimScope; limit?: number } = {}): Promise<ClaimRow[]> {
  const limit = input.limit ?? 50;
  const scopeSql = input.scope === undefined ? "" : ` AND ${scopePredicate(input.scope, "c")}`;
  const params = input.scope === undefined ? [limit] : [input.scope.id, limit];
  const result = await client.query<ClaimRow>(
    `SELECT c.claim_id, c.claim_type, c.claim_text, c.subject_id, c.object_id, c.component_id, c.edge_id, c.review_id,
            c.status, c.evidence_level, c.confidence, c.is_inferred, c.generated_by, c.last_verified_at, c.created_at, c.updated_at,
            e.validity AS edge_validity,
            e.deprecated_reason AS edge_deprecated_reason,
            e.superseded_by_edge_id AS edge_superseded_by_edge_id
     FROM claims c
     LEFT JOIN edges e ON e.edge_id = c.edge_id
     WHERE c.status = 'draft'
       ${scopeSql}
     ORDER BY c.updated_at DESC, c.confidence DESC, c.claim_id
     LIMIT $${params.length}`,
    params
  );
  return result.rows;
}

export async function listActiveClaimsOnInactiveEdges(client: DbClient, input: { scope: ClaimScope; limit?: number }): Promise<ClaimRow[]> {
  const limit = input.limit ?? 50;
  const result = await client.query<ClaimRow>(
    `SELECT c.claim_id, c.claim_type, c.claim_text, c.subject_id, c.object_id, c.component_id, c.edge_id, c.review_id,
            c.status, c.evidence_level, c.confidence, c.is_inferred, c.generated_by, c.last_verified_at, c.created_at, c.updated_at,
            e.validity AS edge_validity,
            e.deprecated_reason AS edge_deprecated_reason,
            e.superseded_by_edge_id AS edge_superseded_by_edge_id
     FROM claims c
     JOIN edges e ON e.edge_id = c.edge_id
     WHERE c.status = 'active'
       AND e.validity <> 'current'
       AND ${scopePredicate(input.scope, "c")}
     ORDER BY e.updated_at DESC, c.updated_at DESC, c.claim_id
     LIMIT $2`,
    [input.scope.id, limit]
  );
  return result.rows;
}

function scopePredicate(scope: ClaimScope, alias: string): string {
  if (scope.kind === "entity") return `(${alias}.subject_id = $1 OR ${alias}.object_id = $1)`;
  if (scope.kind === "component") return `${alias}.component_id = $1`;
  return `${alias}.edge_id = $1`;
}
