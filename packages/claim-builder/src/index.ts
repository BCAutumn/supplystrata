import { createHash } from "node:crypto";
import type pg from "pg";
import type { ClaimType, EvidenceLevel, RelationType } from "@supplystrata/core";
import {
  linkClaimEvidence,
  recordSemanticChange,
  tryResolveEntityId,
  upsertClaim,
  type DatabaseStore,
  type DbClient,
  type NewClaimInput
} from "@supplystrata/db";
import type { SemanticChangeReviewCandidate } from "@supplystrata/review-candidates";

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
  return result;
}

async function resolveSemanticChangeScope(client: DbClient, candidate: SemanticChangeReviewCandidate): Promise<{ subject_id?: string; object_id?: string }> {
  const subjectId = await tryResolveEntityId(client, candidate.payload.subject_surface);
  const objectId = await tryResolveEntityId(client, candidate.payload.object_surface);
  return {
    ...(subjectId === undefined ? {} : { subject_id: subjectId }),
    ...(objectId === undefined ? {} : { object_id: objectId })
  };
}

export async function buildEdgeClaimsFromCurrentEdges(client: DbClient, input: BuildEdgeClaimsInput = {}): Promise<BuildEdgeClaimsSummary> {
  const generatedBy = input.generated_by ?? "claim-builder.edge-fact.v1";
  const edges = await listClaimableFactEdges(client, { min_evidence_level: input.min_evidence_level ?? 4, limit: input.limit ?? 500 });
  let inserted = 0;
  let updated = 0;

  for (const edge of edges) {
    const draft = buildClaimDraftFromEdge(edge, { generated_by: generatedBy });
    const claimInput: Omit<NewClaimInput, "component_id"> = {
      claim_id: draft.claim_id,
      claim_type: draft.claim_type,
      claim_text: draft.claim_text,
      subject_id: draft.subject_id,
      object_id: draft.object_id,
      edge_id: draft.edge_id,
      status: "active",
      evidence_level: draft.evidence_level,
      confidence: draft.confidence,
      is_inferred: draft.is_inferred,
      generated_by: draft.generated_by,
      last_verified_at: draft.last_verified_at
    };
    const result = await upsertClaim(client, draft.component_id === undefined ? claimInput : { ...claimInput, component_id: draft.component_id });
    await linkClaimEvidence(client, { claim_id: result.claim_id, evidence_id: draft.evidence_id, role: "primary" });
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
        evidence_level: draft.evidence_level
      },
      evidence_ids: [draft.evidence_id],
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
