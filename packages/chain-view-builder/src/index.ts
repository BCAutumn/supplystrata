import { listComponentUpstreamLeads, type ComponentUpstreamLead } from "@supplystrata/component-context";
import {
  summarizeChainSegments,
  type ChainViewModel,
  type ChainViewRoot,
  type ChainViewSegmentModel,
  type ChainViewSourceHint
} from "@supplystrata/chain-view";
import {
  listLeadObservationsByScope,
  listObservationsByScope,
  listUnknownItems,
  resolveEntityId,
  type DbClient,
  type ObservationRow,
  type UnknownItemRow
} from "@supplystrata/db/read";
import { planSourcesForComponentLead } from "@supplystrata/source-plan";
import type { ChainFactRow, EntityHeaderRow } from "./db-rows.js";
import {
  segmentFromComponentUpstreamLead as mapComponentUpstreamLeadSegment,
  segmentFromLead,
  segmentFromObservation,
  segmentFromUnknown,
  segmentsFromFactRow,
  sourceHintFromPlanItem
} from "./segment-mappers.js";

export type { ChainFactRow } from "./db-rows.js";
export { segmentFromLead, segmentFromObservation, segmentFromUnknown, segmentsFromFactRow } from "./segment-mappers.js";

export function segmentFromComponentUpstreamLead(
  lead: ComponentUpstreamLead,
  input: { row: ChainFactRow; sequence_index: number; sourceHints?: readonly ChainViewSourceHint[] }
): ChainViewSegmentModel {
  return mapComponentUpstreamLeadSegment(lead, {
    ...input,
    sourceHints: input.sourceHints ?? sourceHintsForComponentLead(lead, input.row)
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
  const factSegments = rows.flatMap((row, index) => segmentsFromFactRow(row, index));
  const contextSegments = await loadContextSegments(client, { root: rootModel, rows, maxDepth, sequenceStart: factSegments.length });
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
  input: { root: ChainViewRoot; rows: readonly ChainFactRow[]; maxDepth: number; sequenceStart: number }
): Promise<ChainViewSegmentModel[]> {
  const rootObservations = await listObservationsByScope(client, { scope_kind: "company", scope_id: input.root.id, limit: 10 });
  const componentObservations = await loadComponentObservations(client, input.rows);
  const componentLeads = componentUpstreamLeadSegments(input.rows, input.maxDepth);
  const leads = await listLeadObservationsByScope(client, { scope_kind: "company", scope_id: input.root.id, status: "open", limit: 10 });
  const unknowns = await listUnknownItems(client, input.root.id);
  const edgeUnknowns = await loadEdgeUnknowns(client, input.rows);
  const segments: ChainViewSegmentModel[] = [];
  let sequenceIndex = input.sequenceStart;
  for (const observation of [...rootObservations, ...componentObservations]) {
    segments.push(segmentFromObservation(observation, { root: input.root, sequence_index: sequenceIndex }));
    sequenceIndex += 1;
  }
  for (const lead of componentLeads) {
    segments.push({ ...lead, sequence_index: sequenceIndex });
    sequenceIndex += 1;
  }
  for (const lead of leads) {
    segments.push(segmentFromLead(lead, { root: input.root, sequence_index: sequenceIndex }));
    sequenceIndex += 1;
  }
  for (const unknown of unknowns) {
    segments.push(segmentFromUnknown(unknown, { root: input.root, sequence_index: sequenceIndex }));
    sequenceIndex += 1;
  }
  for (const unknown of edgeUnknowns) {
    segments.push(segmentFromUnknown(unknown, { root: input.root, sequence_index: sequenceIndex }));
    sequenceIndex += 1;
  }
  return segments;
}

async function loadEdgeUnknowns(client: DbClient, rows: readonly ChainFactRow[]): Promise<UnknownItemRow[]> {
  const byUnknownId = new Map<string, UnknownItemRow>();
  for (const edgeId of [...new Set(rows.map((row) => row.edge_id))].sort()) {
    for (const unknown of await listUnknownItems(client, edgeId)) {
      byUnknownId.set(unknown.unknown_id, unknown);
    }
  }
  return [...byUnknownId.values()];
}

function componentUpstreamLeadSegments(rows: readonly ChainFactRow[], maxDepth: number): ChainViewSegmentModel[] {
  const segments: ChainViewSegmentModel[] = [];
  let sequenceIndex = 0;
  for (const row of rows) {
    if (row.component_id === null) continue;
    const remainingDepth = maxDepth - row.depth;
    if (remainingDepth < 1) continue;
    for (const lead of listComponentUpstreamLeads(row.component_id, remainingDepth)) {
      segments.push(
        segmentFromComponentUpstreamLead(lead, {
          row,
          sequence_index: sequenceIndex,
          sourceHints: sourceHintsForComponentLead(lead, row)
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

async function loadComponentObservations(client: DbClient, rows: readonly ChainFactRow[]): Promise<ObservationRow[]> {
  const componentIds = [...new Set(rows.flatMap((row) => (row.component_id === null ? [] : [row.component_id])))].sort();
  const observations: ObservationRow[] = [];
  for (const componentId of componentIds) {
    observations.push(...(await listObservationsByScope(client, { scope_kind: "component", scope_id: componentId, limit: 5 })));
  }
  return observations;
}

function clampDepth(value: number): number {
  if (!Number.isInteger(value)) throw new Error(`Unsupported chain depth: ${value}`);
  return Math.min(Math.max(value, 1), 5);
}

function sourceHintsForComponentLead(lead: ComponentUpstreamLead, row: ChainFactRow): ChainViewSourceHint[] {
  return planSourcesForComponentLead(lead, uniqueEntityIdsForLead(row)).map(sourceHintFromPlanItem).slice(0, 6);
}

function uniqueEntityIdsForLead(row: ChainFactRow): string[] {
  return [...new Set([row.subject_id, row.object_id, row.upstream_id])].sort();
}
