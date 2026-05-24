import type pg from "pg";
import {
  calculateEdgeFreshness,
  createId,
  type EdgeFreshnessDecayModel,
  type EdgeFreshnessRecord,
  type EdgeStrengthEstimateRecord,
  type EdgeStrengthKind
} from "@supplystrata/core";
import type { DbClient, DbTxClient } from "./client.js";
import { toIsoDateString, toIsoString } from "./time.js";

interface EdgeStrengthEstimateRow extends pg.QueryResultRow {
  strength_id: string;
  edge_id: string;
  strength_kind: EdgeStrengthKind;
  value: string | null;
  lower_bound: string | null;
  upper_bound: string | null;
  unit: string | null;
  evidence_id: string | null;
  method: string;
  valid_from: Date | string | null;
  valid_to: Date | string | null;
  attrs: Record<string, unknown>;
}

interface EdgeFreshnessSourceRow extends pg.QueryResultRow {
  edge_id: string;
  last_verified_at: Date | string;
  primary_evidence_id: string | null;
}

interface EdgeFreshnessRow extends pg.QueryResultRow {
  edge_id: string;
  last_verified_at: Date | string;
  decay_model: EdgeFreshnessDecayModel;
  age_days: number;
  freshness_score: number;
  computed_at: Date | string;
  source_evidence_id: string | null;
  attrs: Record<string, unknown>;
}

interface EdgeFreshnessUpsertInputRow {
  edge_id: string;
  last_verified_at: string;
  decay_model: EdgeFreshnessDecayModel;
  age_days: number;
  freshness_score: number;
  computed_at: string;
  source_evidence_id: string | null;
}

export interface UpsertEdgeStrengthEstimateInput {
  strength_id?: string;
  edge_id: string;
  strength_kind: EdgeStrengthKind;
  value?: string;
  lower_bound?: string;
  upper_bound?: string;
  unit?: string;
  evidence_id?: string;
  method: string;
  valid_from?: string;
  valid_to?: string;
  attrs?: Record<string, unknown>;
}

export async function upsertEdgeStrengthEstimate(client: DbTxClient, input: UpsertEdgeStrengthEstimateInput): Promise<EdgeStrengthEstimateRecord> {
  const identityKey = edgeStrengthIdentityKey(input);
  const result = await client.query<EdgeStrengthEstimateRow>(
    `INSERT INTO edge_strength_estimates (
       strength_id, identity_key, edge_id, strength_kind, value, lower_bound, upper_bound, unit,
       evidence_id, method, valid_from, valid_to, attrs
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
     ON CONFLICT (identity_key)
     DO UPDATE SET
       value = EXCLUDED.value,
       lower_bound = EXCLUDED.lower_bound,
       upper_bound = EXCLUDED.upper_bound,
       unit = EXCLUDED.unit,
       attrs = edge_strength_estimates.attrs || EXCLUDED.attrs,
       updated_at = now()
     RETURNING strength_id, edge_id, strength_kind, value, lower_bound, upper_bound, unit,
               evidence_id, method, valid_from, valid_to, attrs`,
    [
      input.strength_id ?? createId("STR"),
      identityKey,
      input.edge_id,
      input.strength_kind,
      input.value ?? null,
      input.lower_bound ?? null,
      input.upper_bound ?? null,
      input.unit ?? null,
      input.evidence_id ?? null,
      input.method,
      input.valid_from ?? null,
      input.valid_to ?? null,
      JSON.stringify(input.attrs ?? {})
    ]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Failed to upsert edge strength estimate for edge ${input.edge_id}`);
  return strengthRowToRecord(row);
}

function edgeStrengthIdentityKey(input: UpsertEdgeStrengthEstimateInput): string {
  // 用显式身份键承载业务唯一性，避免把表达式索引语法泄漏进 upsert 调用点。
  return [input.edge_id, input.strength_kind, input.evidence_id ?? "", input.method, input.valid_from ?? "", input.valid_to ?? ""].join("\u001F");
}

export async function listEdgeStrengthEstimates(client: DbClient, edgeIds: readonly string[]): Promise<EdgeStrengthEstimateRecord[]> {
  if (edgeIds.length === 0) return [];
  const result = await client.query<EdgeStrengthEstimateRow>(
    `SELECT strength_id, edge_id, strength_kind, value, lower_bound, upper_bound, unit,
            evidence_id, method, valid_from, valid_to, attrs
     FROM edge_strength_estimates
     WHERE edge_id = ANY($1::text[])
     ORDER BY edge_id, strength_kind, method, strength_id`,
    [edgeIds]
  );
  return result.rows.map(strengthRowToRecord);
}

export async function refreshEdgeFreshness(client: DbTxClient, input: { edgeIds: readonly string[]; computedAt: string }): Promise<EdgeFreshnessRecord[]> {
  if (input.edgeIds.length === 0) return [];
  const sourceRows = await client.query<EdgeFreshnessSourceRow>(
    `SELECT edge_id, last_verified_at, primary_evidence_id
     FROM edges
     WHERE edge_id = ANY($1::text[])
     ORDER BY edge_id`,
    [input.edgeIds]
  );
  const rows: EdgeFreshnessUpsertInputRow[] = sourceRows.rows.map((row) => {
    const freshness = calculateEdgeFreshness({
      last_verified_at: toIsoString(row.last_verified_at),
      computed_at: input.computedAt
    });
    return {
      edge_id: row.edge_id,
      last_verified_at: toIsoString(row.last_verified_at),
      decay_model: freshness.decay_model,
      age_days: freshness.age_days,
      freshness_score: freshness.freshness_score,
      computed_at: input.computedAt,
      source_evidence_id: row.primary_evidence_id
    };
  });
  if (rows.length === 0) return [];
  const stored = await client.query<EdgeFreshnessRow>(
    `WITH input AS (
       SELECT *
       FROM jsonb_to_recordset($1::jsonb) AS row(
         edge_id text,
         last_verified_at timestamptz,
         decay_model text,
         age_days integer,
         freshness_score real,
         computed_at timestamptz,
         source_evidence_id text
       )
     )
     INSERT INTO edge_freshness (
         edge_id, last_verified_at, decay_model, age_days, freshness_score,
         computed_at, source_evidence_id, attrs
       )
     SELECT edge_id, last_verified_at, decay_model, age_days, freshness_score, computed_at, source_evidence_id, '{}'::jsonb
     FROM input
     ON CONFLICT (edge_id)
     DO UPDATE SET
         last_verified_at = EXCLUDED.last_verified_at,
         decay_model = EXCLUDED.decay_model,
         age_days = EXCLUDED.age_days,
         freshness_score = EXCLUDED.freshness_score,
         computed_at = EXCLUDED.computed_at,
         source_evidence_id = EXCLUDED.source_evidence_id
     RETURNING edge_id, last_verified_at, decay_model, age_days, freshness_score,
               computed_at, source_evidence_id, attrs`,
    [JSON.stringify(rows)]
  );
  return stored.rows.map(freshnessRowToRecord);
}

export async function listEdgeFreshness(client: DbClient, input: { edgeIds: readonly string[]; computedAt: string }): Promise<EdgeFreshnessRecord[]> {
  if (input.edgeIds.length === 0) return [];
  const stored = await client.query<EdgeFreshnessRow>(
    `SELECT edge_id, last_verified_at, decay_model, age_days, freshness_score,
            computed_at, source_evidence_id, attrs
     FROM edge_freshness
     WHERE edge_id = ANY($1::text[])`,
    [input.edgeIds]
  );
  const byEdgeId = new Map(stored.rows.map((row) => [row.edge_id, freshnessRowToRecord(row)]));
  const missing = input.edgeIds.filter((edgeId) => !byEdgeId.has(edgeId));
  if (missing.length > 0) {
    const sourceRows = await client.query<EdgeFreshnessSourceRow>(
      `SELECT edge_id, last_verified_at, primary_evidence_id
       FROM edges
       WHERE edge_id = ANY($1::text[])`,
      [missing]
    );
    for (const row of sourceRows.rows) {
      const calculated = calculateEdgeFreshness({
        last_verified_at: toIsoString(row.last_verified_at),
        computed_at: input.computedAt
      });
      byEdgeId.set(row.edge_id, {
        edge_id: row.edge_id,
        last_verified_at: toIsoString(row.last_verified_at),
        decay_model: calculated.decay_model,
        age_days: calculated.age_days,
        freshness_score: calculated.freshness_score,
        computed_at: input.computedAt,
        ...(row.primary_evidence_id === null ? {} : { source_evidence_id: row.primary_evidence_id }),
        attrs: { persisted: false }
      });
    }
  }
  return [...byEdgeId.values()].sort((left, right) => left.edge_id.localeCompare(right.edge_id));
}

function strengthRowToRecord(row: EdgeStrengthEstimateRow): EdgeStrengthEstimateRecord {
  return {
    strength_id: row.strength_id,
    edge_id: row.edge_id,
    strength_kind: row.strength_kind,
    ...(row.value === null ? {} : { value: row.value }),
    ...(row.lower_bound === null ? {} : { lower_bound: row.lower_bound }),
    ...(row.upper_bound === null ? {} : { upper_bound: row.upper_bound }),
    ...(row.unit === null ? {} : { unit: row.unit }),
    ...(row.evidence_id === null ? {} : { evidence_id: row.evidence_id }),
    method: row.method,
    ...(row.valid_from === null ? {} : { valid_from: toDateOnly(row.valid_from) }),
    ...(row.valid_to === null ? {} : { valid_to: toDateOnly(row.valid_to) }),
    attrs: row.attrs
  };
}

function freshnessRowToRecord(row: EdgeFreshnessRow): EdgeFreshnessRecord {
  return {
    edge_id: row.edge_id,
    last_verified_at: toIsoString(row.last_verified_at),
    decay_model: row.decay_model,
    age_days: row.age_days,
    freshness_score: row.freshness_score,
    computed_at: toIsoString(row.computed_at),
    ...(row.source_evidence_id === null ? {} : { source_evidence_id: row.source_evidence_id }),
    attrs: row.attrs
  };
}

function toDateOnly(value: Date | string): string {
  return toIsoDateString(value);
}
