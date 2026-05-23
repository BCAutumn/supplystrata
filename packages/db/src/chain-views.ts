import type pg from "pg";
import { createId, type ChainEndpointKind, type ChainViewRecord, type SemanticLayer } from "@supplystrata/core";
import type { DbClient, DbTxClient } from "./client.js";

export type ChainViewType = ChainViewRecord["view_type"];

export interface ChainViewRow extends pg.QueryResultRow {
  chain_id: string;
  root_kind: ChainEndpointKind;
  root_id: string;
  view_type: ChainViewType;
  title: string;
  generated_by: string;
  generated_at: Date;
  attrs: Record<string, unknown>;
}

export interface NewChainViewInput {
  chain_id?: string;
  root_kind: ChainEndpointKind;
  root_id: string;
  view_type: ChainViewType;
  title: string;
  generated_by: string;
  attrs?: Record<string, unknown>;
}

export async function insertChainView(client: DbTxClient, input: NewChainViewInput): Promise<{ chain_id: string }> {
  const chainId = input.chain_id ?? createId("CHAIN");
  await client.query(
    `INSERT INTO chain_views (chain_id, root_kind, root_id, view_type, title, generated_by, attrs)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [chainId, input.root_kind, input.root_id, input.view_type, input.title, input.generated_by, input.attrs ?? {}]
  );
  return { chain_id: chainId };
}

export async function getChainView(client: DbClient, chainId: string): Promise<ChainViewRow | undefined> {
  const result = await client.query<ChainViewRow>(
    `SELECT chain_id, root_kind, root_id, view_type, title, generated_by, generated_at, attrs
     FROM chain_views
     WHERE chain_id = $1`,
    [chainId]
  );
  return result.rows[0];
}

export interface ChainSegmentRow extends pg.QueryResultRow {
  segment_id: string;
  chain_id: string;
  sequence_index: number;
  from_kind: ChainEndpointKind;
  from_id: string;
  to_kind: ChainEndpointKind;
  to_id: string;
  semantic_layer: SemanticLayer;
  relation: string | null;
  component_id: string | null;
  edge_id: string | null;
  claim_id: string | null;
  observation_id: string | null;
  lead_id: string | null;
  unknown_id: string | null;
  evidence_ids: string[];
  confidence: number | null;
  attrs: Record<string, unknown>;
}

interface SemanticReference {
  edge_id?: string;
  claim_id?: string;
  observation_id?: string;
  lead_id?: string;
  unknown_id?: string;
}

interface ChainSegmentInsertRow
  extends Required<Pick<NewChainSegmentInput, "chain_id" | "sequence_index" | "from_kind" | "from_id" | "to_kind" | "to_id" | "semantic_layer">> {
  segment_id: string;
  relation: string | null;
  component_id: string | null;
  edge_id: string | null;
  claim_id: string | null;
  observation_id: string | null;
  lead_id: string | null;
  unknown_id: string | null;
  evidence_ids: string[];
  confidence: number | null;
  attrs: Record<string, unknown>;
}

export interface NewChainSegmentInput extends SemanticReference {
  segment_id?: string;
  chain_id: string;
  sequence_index: number;
  from_kind: ChainEndpointKind;
  from_id: string;
  to_kind: ChainEndpointKind;
  to_id: string;
  semantic_layer: SemanticLayer;
  relation?: string;
  component_id?: string;
  evidence_ids?: string[];
  confidence?: number;
  attrs?: Record<string, unknown>;
}

export async function insertChainSegment(client: DbTxClient, input: NewChainSegmentInput): Promise<{ segment_id: string }> {
  const segmentId = input.segment_id ?? createId("SEG");
  const references = semanticReferenceFor(input);
  await client.query(
    `INSERT INTO chain_segments (
       segment_id, chain_id, sequence_index, from_kind, from_id, to_kind, to_id, semantic_layer,
       relation, component_id, edge_id, claim_id, observation_id, lead_id, unknown_id,
       evidence_ids, confidence, attrs
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      segmentId,
      input.chain_id,
      input.sequence_index,
      input.from_kind,
      input.from_id,
      input.to_kind,
      input.to_id,
      input.semantic_layer,
      input.relation ?? null,
      input.component_id ?? null,
      references.edge_id ?? null,
      references.claim_id ?? null,
      references.observation_id ?? null,
      references.lead_id ?? null,
      references.unknown_id ?? null,
      input.evidence_ids ?? [],
      input.confidence ?? null,
      input.attrs ?? {}
    ]
  );
  return { segment_id: segmentId };
}

export async function insertChainSegments(client: DbTxClient, inputs: readonly NewChainSegmentInput[]): Promise<{ inserted: number }> {
  if (inputs.length === 0) return { inserted: 0 };
  const rows = inputs.map(chainSegmentInsertRow);
  await client.query(
    `WITH input_rows AS (
       SELECT segment_id, chain_id, sequence_index, from_kind, from_id, to_kind, to_id,
              semantic_layer, relation, component_id, edge_id, claim_id, observation_id,
              lead_id, unknown_id, evidence_ids, confidence, attrs
       FROM jsonb_to_recordset($1::jsonb) AS row(
         segment_id text,
         chain_id text,
         sequence_index integer,
         from_kind text,
         from_id text,
         to_kind text,
         to_id text,
         semantic_layer text,
         relation text,
         component_id text,
         edge_id text,
         claim_id text,
         observation_id text,
         lead_id text,
         unknown_id text,
         evidence_ids jsonb,
         confidence double precision,
         attrs jsonb
       )
     )
     INSERT INTO chain_segments (
       segment_id, chain_id, sequence_index, from_kind, from_id, to_kind, to_id, semantic_layer,
       relation, component_id, edge_id, claim_id, observation_id, lead_id, unknown_id,
       evidence_ids, confidence, attrs
     )
     SELECT segment_id, chain_id, sequence_index, from_kind, from_id, to_kind, to_id, semantic_layer,
            relation, component_id, edge_id, claim_id, observation_id, lead_id, unknown_id,
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(evidence_ids)), ARRAY[]::text[]),
            confidence,
            COALESCE(attrs, '{}'::jsonb)
     FROM input_rows`,
    [JSON.stringify(rows)]
  );
  return { inserted: inputs.length };
}

export async function listChainSegments(client: DbClient, chainId: string): Promise<ChainSegmentRow[]> {
  const result = await client.query<ChainSegmentRow>(
    `SELECT segment_id, chain_id, sequence_index, from_kind, from_id, to_kind, to_id, semantic_layer,
            relation, component_id, edge_id, claim_id, observation_id, lead_id, unknown_id,
            evidence_ids, confidence, attrs
     FROM chain_segments
     WHERE chain_id = $1
     ORDER BY sequence_index, segment_id`,
    [chainId]
  );
  return result.rows;
}

function semanticReferenceFor(input: NewChainSegmentInput): SemanticReference {
  // 存储层只保留当前 semantic_layer 对应的引用，避免一段链路同时像事实边又像观测。
  if (input.semantic_layer === "edge") return { edge_id: requireReference(input.edge_id, "edge_id", input.semantic_layer) };
  if (input.semantic_layer === "claim") return { claim_id: requireReference(input.claim_id, "claim_id", input.semantic_layer) };
  if (input.semantic_layer === "observation") return { observation_id: requireReference(input.observation_id, "observation_id", input.semantic_layer) };
  if (input.semantic_layer === "lead") return { lead_id: requireReference(input.lead_id, "lead_id", input.semantic_layer) };
  return { unknown_id: requireReference(input.unknown_id, "unknown_id", input.semantic_layer) };
}

function chainSegmentInsertRow(input: NewChainSegmentInput): ChainSegmentInsertRow {
  const references = semanticReferenceFor(input);
  return {
    segment_id: input.segment_id ?? createId("SEG"),
    chain_id: input.chain_id,
    sequence_index: input.sequence_index,
    from_kind: input.from_kind,
    from_id: input.from_id,
    to_kind: input.to_kind,
    to_id: input.to_id,
    semantic_layer: input.semantic_layer,
    relation: input.relation ?? null,
    component_id: input.component_id ?? null,
    edge_id: references.edge_id ?? null,
    claim_id: references.claim_id ?? null,
    observation_id: references.observation_id ?? null,
    lead_id: references.lead_id ?? null,
    unknown_id: references.unknown_id ?? null,
    evidence_ids: input.evidence_ids ?? [],
    confidence: input.confidence ?? null,
    attrs: input.attrs ?? {}
  };
}

function requireReference(value: string | undefined, field: string, semanticLayer: SemanticLayer): string {
  if (value === undefined || value.trim().length === 0) throw new Error(`${field} is required for chain segment semantic_layer=${semanticLayer}`);
  return value;
}
