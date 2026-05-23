import { listComponentUpstreamLeads, type ComponentUpstreamLead } from "@supplystrata/component-context";
import {
  summarizeChainSegments,
  type ChainViewModel,
  type ChainViewRoot,
  type ChainViewSegmentModel,
  type ChainViewSourceHint
} from "@supplystrata/chain-view";
import { listLeadObservationsByScope, listObservationsByScope, listUnknownItems, resolveEntityId, type DbClient } from "@supplystrata/db/read";
import { planSourcesForComponentLead } from "@supplystrata/source-plan";
import type { ChainFactRow, EntityHeaderRow } from "./db-rows.js";
import type { ChainFact, ChainObservation, ChainUnknown } from "./definitions.js";
import { chainFactFromRow, chainLeadFromRow, chainObservationFromRow, chainUnknownFromRow } from "./dto-mappers.js";
import {
  segmentFromComponentUpstreamLead as mapComponentUpstreamLeadSegment,
  segmentFromLead,
  segmentFromObservation,
  segmentFromUnknown,
  segmentsFromFact,
  sourceHintFromPlanItem
} from "./segment-mappers.js";

export type { ChainFact, ChainLead, ChainObservation, ChainUnknown } from "./definitions.js";
export { segmentFromLead, segmentFromObservation, segmentFromUnknown, segmentsFromFact } from "./segment-mappers.js";

export function segmentFromComponentUpstreamLead(
  lead: ComponentUpstreamLead,
  input: { fact: ChainFact; sequence_index: number; sourceHints?: readonly ChainViewSourceHint[] }
): ChainViewSegmentModel {
  return mapComponentUpstreamLeadSegment(lead, {
    ...input,
    sourceHints: input.sourceHints ?? sourceHintsForComponentLead(lead, input.fact)
  });
}

export interface BuildCompanyChainViewInput {
  query: string;
  depth?: number;
  generated_by?: string;
}

export async function buildCompanyChainView(client: DbClient, input: BuildCompanyChainViewInput): Promise<ChainViewModel> {
  const rootEntityId = await resolveEntityId(client, input.query);
  const root = await loadRoot(client, rootEntityId);
  const rootModel: ChainViewRoot = { kind: "company", id: root.entity_id, name: root.display_name };
  const maxDepth = clampDepth(input.depth ?? 2);
  const rows = await loadChainFactRows(client, rootEntityId, maxDepth);
  const facts = rows.map(chainFactFromRow);
  const factSegments = facts.flatMap((fact, index) => segmentsFromFact(fact, index));
  const contextSegments = await loadContextSegments(client, { root: rootModel, facts, maxDepth, sequenceStart: factSegments.length });
  const segments = [...factSegments, ...contextSegments];
  return {
    schema_version: "1.0.0",
    view_type: "company_chain",
    root: rootModel,
    max_depth: maxDepth,
    generated_by: input.generated_by ?? "chain-view.company.v1",
    segments,
    stats: summarizeChainSegments(segments)
  };
}

async function loadRoot(client: DbClient, entityId: string): Promise<EntityHeaderRow> {
  const result = await client.query<EntityHeaderRow>("SELECT entity_id, display_name FROM entity_master WHERE entity_id = $1", [entityId]);
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Entity not found: ${entityId}`);
  return row;
}

async function loadChainFactRows(client: DbClient, rootEntityId: string, maxDepth: number): Promise<ChainFactRow[]> {
  const result = await client.query<ChainFactRow>(
    `WITH RECURSIVE walk AS (
       SELECT $1::text AS node_id, ARRAY[$1::text] AS path, 0 AS depth
       UNION ALL
       SELECT next_edge.upstream_id,
              walk.path || next_edge.upstream_id,
              walk.depth + 1
       FROM walk
       JOIN LATERAL (
         SELECT CASE
                  WHEN e.relation IN ('BUYS_FROM','USES_FOUNDRY') AND e.subject_id = walk.node_id THEN e.object_id
                  WHEN e.relation = 'SUPPLIES_TO' AND e.object_id = walk.node_id THEN e.subject_id
                  WHEN e.relation = 'MANUFACTURES_AT' AND e.subject_id = walk.node_id THEN e.object_id
                END AS upstream_id
         FROM edges e
         WHERE e.validity = 'current'
           AND e.evidence_level >= 4
           AND e.is_inferred = false
           AND (
             (e.relation IN ('BUYS_FROM','USES_FOUNDRY','MANUFACTURES_AT') AND e.subject_id = walk.node_id)
             OR (e.relation = 'SUPPLIES_TO' AND e.object_id = walk.node_id)
           )
       ) next_edge ON next_edge.upstream_id IS NOT NULL
       WHERE walk.depth < $2
         AND NOT next_edge.upstream_id = ANY(walk.path)
     ),
     chain_edges AS (
       SELECT walk.depth + 1 AS depth,
              e.edge_id, e.relation,
              e.subject_id, s.display_name AS subject_name,
              e.object_id, o.display_name AS object_name,
              CASE
                WHEN e.relation IN ('BUYS_FROM','USES_FOUNDRY','MANUFACTURES_AT') AND e.subject_id = walk.node_id THEN e.object_id
                WHEN e.relation = 'SUPPLIES_TO' AND e.object_id = walk.node_id THEN e.subject_id
              END AS upstream_id,
              CASE
                WHEN e.relation IN ('BUYS_FROM','USES_FOUNDRY','MANUFACTURES_AT') AND e.subject_id = walk.node_id THEN o.display_name
                WHEN e.relation = 'SUPPLIES_TO' AND e.object_id = walk.node_id THEN s.display_name
              END AS upstream_name,
              e.component, e.component_id, e.evidence_level, e.confidence, e.primary_evidence_id,
              c.claim_id, c.claim_text
       FROM walk
       JOIN edges e ON e.validity = 'current'
        AND e.evidence_level >= 4
        AND e.is_inferred = false
        AND (
          (e.relation IN ('BUYS_FROM','USES_FOUNDRY','MANUFACTURES_AT') AND e.subject_id = walk.node_id)
          OR (e.relation = 'SUPPLIES_TO' AND e.object_id = walk.node_id)
        )
       JOIN entity_master s ON s.entity_id = e.subject_id
       JOIN entity_master o ON o.entity_id = e.object_id
       LEFT JOIN LATERAL (
         SELECT claims.claim_id, claims.claim_text
         FROM claims
         WHERE claims.edge_id = e.edge_id
           AND claims.status = 'active'
         ORDER BY claims.evidence_level DESC, claims.confidence DESC, claims.updated_at DESC
         LIMIT 1
       ) c ON true
       WHERE walk.depth < $2
     )
     SELECT depth, edge_id, relation, subject_id, subject_name, object_id, object_name,
            upstream_id, upstream_name, component, component_id, evidence_level, confidence,
            primary_evidence_id, claim_id, claim_text
     FROM chain_edges
     WHERE upstream_id IS NOT NULL
     ORDER BY depth, subject_name, relation, object_name`,
    [rootEntityId, maxDepth]
  );
  return result.rows;
}

async function loadContextSegments(
  client: DbClient,
  input: { root: ChainViewRoot; facts: readonly ChainFact[]; maxDepth: number; sequenceStart: number }
): Promise<ChainViewSegmentModel[]> {
  const rootObservations = await listObservationsByScope(client, { scope_kind: "company", scope_id: input.root.id, limit: 10 });
  const componentObservations = await loadComponentObservations(client, input.facts);
  const componentLeads = componentUpstreamLeadSegments(input.facts, input.maxDepth);
  const leads = await listLeadObservationsByScope(client, { scope_kind: "company", scope_id: input.root.id, status: "open", limit: 10 });
  const unknowns = await listUnknownItems(client, input.root.id);
  const edgeUnknowns = await loadEdgeUnknowns(client, input.facts);
  const segments: ChainViewSegmentModel[] = [];
  let sequenceIndex = input.sequenceStart;
  for (const observation of [...rootObservations.map(chainObservationFromRow), ...componentObservations]) {
    segments.push(segmentFromObservation(observation, { root: input.root, sequence_index: sequenceIndex }));
    sequenceIndex += 1;
  }
  for (const lead of componentLeads) {
    segments.push({ ...lead, sequence_index: sequenceIndex });
    sequenceIndex += 1;
  }
  for (const lead of leads) {
    segments.push(segmentFromLead(chainLeadFromRow(lead), { root: input.root, sequence_index: sequenceIndex }));
    sequenceIndex += 1;
  }
  for (const unknown of unknowns) {
    segments.push(segmentFromUnknown(chainUnknownFromRow(unknown), { root: input.root, sequence_index: sequenceIndex }));
    sequenceIndex += 1;
  }
  for (const unknown of edgeUnknowns) {
    segments.push(segmentFromUnknown(unknown, { root: input.root, sequence_index: sequenceIndex }));
    sequenceIndex += 1;
  }
  return segments;
}

async function loadEdgeUnknowns(client: DbClient, facts: readonly ChainFact[]): Promise<ChainUnknown[]> {
  const byUnknownId = new Map<string, ChainUnknown>();
  for (const edgeId of [...new Set(facts.map((fact) => fact.edge_id))].sort()) {
    for (const unknown of await listUnknownItems(client, edgeId)) {
      byUnknownId.set(unknown.unknown_id, chainUnknownFromRow(unknown));
    }
  }
  return [...byUnknownId.values()];
}

function componentUpstreamLeadSegments(facts: readonly ChainFact[], maxDepth: number): ChainViewSegmentModel[] {
  const segments: ChainViewSegmentModel[] = [];
  let sequenceIndex = 0;
  for (const fact of facts) {
    if (fact.component_id === null) continue;
    const remainingDepth = maxDepth - fact.depth;
    if (remainingDepth < 1) continue;
    for (const lead of listComponentUpstreamLeads(fact.component_id, remainingDepth)) {
      segments.push(
        segmentFromComponentUpstreamLead(lead, {
          fact,
          sequence_index: sequenceIndex,
          sourceHints: sourceHintsForComponentLead(lead, fact)
        })
      );
      sequenceIndex += 1;
    }
  }
  return dedupeComponentLeadSegments(segments);
}

function dedupeComponentLeadSegments(segments: readonly ChainViewSegmentModel[]): ChainViewSegmentModel[] {
  const seen = new Set<string>();
  const output: ChainViewSegmentModel[] = [];
  for (const segment of segments) {
    const key = `${segment.from.id}:${segment.lead_id ?? ""}:${segment.to.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ ...segment, sequence_index: output.length });
  }
  return output;
}

async function loadComponentObservations(client: DbClient, facts: readonly ChainFact[]): Promise<ChainObservation[]> {
  const componentIds = [...new Set(facts.flatMap((fact) => (fact.component_id === null ? [] : [fact.component_id])))].sort();
  const observations: ChainObservation[] = [];
  for (const componentId of componentIds) {
    observations.push(...(await listObservationsByScope(client, { scope_kind: "component", scope_id: componentId, limit: 5 })).map(chainObservationFromRow));
  }
  return observations;
}

function clampDepth(value: number): number {
  if (!Number.isInteger(value)) throw new Error(`Unsupported chain depth: ${value}`);
  return Math.min(Math.max(value, 1), 5);
}

function sourceHintsForComponentLead(lead: ComponentUpstreamLead, fact: ChainFact): ChainViewSourceHint[] {
  return planSourcesForComponentLead(lead, uniqueEntityIdsForLead(fact)).map(sourceHintFromPlanItem).slice(0, 6);
}

function uniqueEntityIdsForLead(fact: ChainFact): string[] {
  return [...new Set([fact.subject_id, fact.object_id, fact.upstream_id])].sort();
}
