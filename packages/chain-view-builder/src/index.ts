import type pg from "pg";
import { listComponentUpstreamLeads, type ComponentUpstreamLead } from "@supplystrata/component-context";
import type { EvidenceLevel, RelationType } from "@supplystrata/core";
import { summarizeChainSegments, type ChainViewEndpoint, type ChainViewModel, type ChainViewRoot, type ChainViewSegmentModel } from "@supplystrata/chain-view";
import {
  listLeadObservationsByScope,
  listObservationsByScope,
  listUnknownItems,
  resolveEntityId,
  type DbClient,
  type LeadObservationRow,
  type ObservationRow,
  type UnknownItemRow
} from "@supplystrata/db";

export interface BuildCompanyChainViewInput {
  query: string;
  depth?: number;
  generated_by?: string;
}

interface EntityHeaderRow extends pg.QueryResultRow {
  entity_id: string;
  display_name: string;
}

export interface ChainFactRow extends pg.QueryResultRow {
  depth: number;
  edge_id: string;
  relation: RelationType;
  subject_id: string;
  subject_name: string;
  object_id: string;
  object_name: string;
  upstream_id: string;
  upstream_name: string;
  component: string | null;
  component_id: string | null;
  evidence_level: EvidenceLevel;
  confidence: number;
  primary_evidence_id: string | null;
  claim_id: string | null;
  claim_text: string | null;
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

export function segmentsFromFactRow(row: ChainFactRow, rowIndex: number): ChainViewSegmentModel[] {
  const factSegment = edgeSegmentFromFactRow(row, rowIndex * 2);
  if (row.claim_id === null || row.claim_text === null) return [factSegment];
  return [factSegment, claimSegmentFromFactRow(row, rowIndex * 2 + 1)];
}

export function segmentFromObservation(row: ObservationRow, input: { root: ChainViewRoot; sequence_index: number }): ChainViewSegmentModel {
  const target: ChainViewEndpoint = row.component_id === null ? input.root : { kind: "component", id: row.component_id, name: row.component_id };
  return {
    sequence_index: input.sequence_index,
    depth: 0,
    semantic_layer: "observation",
    from: input.root,
    to: target,
    relation: "OBSERVES",
    component: null,
    component_id: row.component_id,
    observation_id: row.observation_id,
    evidence_ids: [],
    confidence: row.confidence,
    label: observationLabel(row)
  };
}

export function segmentFromLead(row: LeadObservationRow, input: { root: ChainViewRoot; sequence_index: number }): ChainViewSegmentModel {
  return {
    sequence_index: input.sequence_index,
    depth: 0,
    semantic_layer: "lead",
    from: input.root,
    to: input.root,
    relation: "LEADS_TO",
    component: null,
    component_id: null,
    lead_id: row.lead_id,
    evidence_ids: [],
    confidence: leadConfidence(row),
    label: `${row.title}: ${row.summary}`
  };
}

export function segmentFromComponentUpstreamLead(lead: ComponentUpstreamLead, input: { row: ChainFactRow; sequence_index: number }): ChainViewSegmentModel {
  return {
    sequence_index: input.sequence_index,
    depth: input.row.depth + lead.tier_depth,
    semantic_layer: "lead",
    from: { kind: "company", id: input.row.upstream_id, name: input.row.upstream_name },
    to: { kind: lead.target_kind, id: lead.target_id, name: lead.target_name },
    relation: "LEADS_TO",
    component: lead.target_name,
    component_id: lead.target_kind === "component" ? lead.target_id : input.row.component_id,
    lead_id: lead.dependency_id,
    evidence_ids: [],
    confidence: lead.confidence,
    label: componentLeadLabel(lead, input.row)
  };
}

export function segmentFromUnknown(row: UnknownItemRow, input: { root: ChainViewRoot; sequence_index: number }): ChainViewSegmentModel {
  return {
    sequence_index: input.sequence_index,
    depth: 0,
    semantic_layer: "unknown",
    from: input.root,
    to: input.root,
    relation: "UNKNOWN_BOUNDARY",
    component: null,
    component_id: null,
    unknown_id: row.unknown_id,
    evidence_ids: [],
    confidence: 0,
    label: `${row.question} — ${row.why_unknown}`
  };
}

function edgeSegmentFromFactRow(row: ChainFactRow, sequenceIndex: number): ChainViewSegmentModel {
  return {
    sequence_index: sequenceIndex,
    depth: row.depth,
    semantic_layer: "edge",
    from: { kind: "company", id: row.subject_id, name: row.subject_name },
    to: { kind: "company", id: row.object_id, name: row.object_name },
    relation: row.relation,
    component: row.component,
    component_id: row.component_id,
    edge_id: row.edge_id,
    evidence_ids: row.primary_evidence_id === null ? [] : [row.primary_evidence_id],
    evidence_level: row.evidence_level,
    confidence: row.confidence,
    label: `${row.subject_name} -${row.relation}-> ${row.object_name}`
  };
}

function claimSegmentFromFactRow(row: ChainFactRow, sequenceIndex: number): ChainViewSegmentModel {
  const claimId = requirePresent(row.claim_id, "claim_id");
  const claimText = requirePresent(row.claim_text, "claim_text");
  return {
    sequence_index: sequenceIndex,
    depth: row.depth,
    semantic_layer: "claim",
    from: { kind: "company", id: row.subject_id, name: row.subject_name },
    to: { kind: "company", id: row.object_id, name: row.object_name },
    relation: "CLAIMS",
    component: row.component,
    component_id: row.component_id,
    claim_id: claimId,
    evidence_ids: row.primary_evidence_id === null ? [] : [row.primary_evidence_id],
    evidence_level: row.evidence_level,
    confidence: row.confidence,
    label: claimText
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
  return segments;
}

function componentUpstreamLeadSegments(rows: readonly ChainFactRow[], maxDepth: number): ChainViewSegmentModel[] {
  const segments: ChainViewSegmentModel[] = [];
  let sequenceIndex = 0;
  for (const row of rows) {
    if (row.component_id === null) continue;
    const remainingDepth = maxDepth - row.depth;
    if (remainingDepth < 1) continue;
    for (const lead of listComponentUpstreamLeads(row.component_id, remainingDepth)) {
      segments.push(segmentFromComponentUpstreamLead(lead, { row, sequence_index: sequenceIndex }));
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

function requirePresent(value: string | null, field: string): string {
  if (value === null) throw new Error(`${field} is required`);
  return value;
}

function observationLabel(row: ObservationRow): string {
  const value = row.metric_value === null ? "" : ` = ${row.metric_value}${row.metric_unit === null ? "" : ` ${row.metric_unit}`}`;
  return `${row.observation_type}: ${row.metric_name}${value}`;
}

function leadConfidence(row: LeadObservationRow): number {
  if (row.status === "promoted") return 0.8;
  if (row.status === "in_review") return 0.5;
  if (row.status === "open") return 0.25;
  return 0;
}

function componentLeadLabel(lead: ComponentUpstreamLead, row: ChainFactRow): string {
  const unknowns = lead.unknowns.length === 0 ? "" : ` Unknowns: ${lead.unknowns.join("; ")}.`;
  return `${lead.title}. Trigger: ${row.upstream_name} is linked by ${row.relation} (${row.component ?? row.component_id ?? "component"}). ${lead.summary}${unknowns}`;
}
