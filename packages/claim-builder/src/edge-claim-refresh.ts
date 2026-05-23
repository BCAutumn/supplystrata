import { linkClaimEvidence, recordSemanticChange, upsertClaim, type DatabaseStore, type DbTxClient, type NewClaimInput } from "@supplystrata/db/write";
import type { DbClient } from "@supplystrata/db/read";
import type { ClaimableFactEdgeRow, ClaimFusionEvidenceRow } from "./db-rows.js";
import { buildClaimDraftFromEdge } from "./claim-drafts.js";
import { fuseClaimConfidenceFromEvidence } from "./claim-fusion.js";

export interface BuildEdgeClaimsInput {
  min_evidence_level?: 4 | 5;
  limit?: number;
  batch_size?: number;
  generated_by?: string;
}

export interface BuildEdgeClaimsSummary {
  scanned: number;
  inserted: number;
  updated: number;
  generated_by: string;
}

export async function buildEdgeClaimsFromCurrentEdges(client: DbTxClient, input: BuildEdgeClaimsInput = {}): Promise<BuildEdgeClaimsSummary> {
  const generatedBy = input.generated_by ?? "claim-builder.edge-fact.v1";
  const edges = await listClaimableFactEdges(client, { min_evidence_level: input.min_evidence_level ?? 4, limit: input.limit ?? 500 });
  return buildEdgeClaimsForEdges(client, edges, generatedBy);
}

async function buildEdgeClaimsForEdges(client: DbTxClient, edges: readonly ClaimableFactEdgeRow[], generatedBy: string): Promise<BuildEdgeClaimsSummary> {
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
  const generatedBy = input.generated_by ?? "claim-builder.edge-fact.v1";
  const limit = input.limit ?? 500;
  const batchSize = input.batch_size ?? Math.min(limit, 50);
  if (!Number.isInteger(limit) || limit <= 0) throw new Error(`Claim build limit must be a positive integer: ${limit}`);
  if (!Number.isInteger(batchSize) || batchSize <= 0) throw new Error(`Claim build batch_size must be a positive integer: ${batchSize}`);

  const edges = await listClaimableFactEdges(store.read, { min_evidence_level: input.min_evidence_level ?? 4, limit });
  let inserted = 0;
  let updated = 0;
  for (let index = 0; index < edges.length; index += batchSize) {
    const batch = edges.slice(index, index + batchSize);
    const summary = await store.transaction((client) => buildEdgeClaimsForEdges(client, batch, generatedBy));
    inserted += summary.inserted;
    updated += summary.updated;
  }
  return { scanned: edges.length, inserted, updated, generated_by: generatedBy };
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
