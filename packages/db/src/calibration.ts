import { createHash } from "node:crypto";
import type pg from "pg";
import type { EdgeCalibrationErrorCategory, EdgeCalibrationLabel, EvidenceLevel } from "@supplystrata/core";
import type { DbClient, DbTxClient } from "./client.js";
import { toIsoString } from "./time.js";

interface EdgeCalibrationLabelRow extends pg.QueryResultRow {
  label_id: string;
  edge_id: string;
  evidence_id: string | null;
  label: EdgeCalibrationLabel;
  error_category: EdgeCalibrationErrorCategory | null;
  reviewer: string;
  reviewed_at: Date | string;
  rationale: string | null;
  attrs: Record<string, unknown>;
}

export interface EdgeCalibrationLabelRecord {
  label_id: string;
  edge_id: string;
  evidence_id?: string;
  label: EdgeCalibrationLabel;
  error_category?: EdgeCalibrationErrorCategory;
  reviewer: string;
  reviewed_at: string;
  rationale?: string;
  attrs: Record<string, unknown>;
}

export interface UpsertEdgeCalibrationLabelInput {
  label_id?: string;
  edge_id: string;
  evidence_id?: string;
  label: EdgeCalibrationLabel;
  error_category?: EdgeCalibrationErrorCategory;
  reviewer: string;
  reviewed_at?: string;
  rationale?: string;
  attrs?: Record<string, unknown>;
}

export interface EdgeCalibrationRunItemInput {
  label_id: string;
  edge_id: string;
  evidence_id?: string;
  evidence_level: EvidenceLevel;
  predicted_confidence: number;
  confidence_bucket: string;
  label: EdgeCalibrationLabel;
  error_category?: EdgeCalibrationErrorCategory;
}

export interface ReplaceEdgeCalibrationRunInput {
  run_id: string;
  generated_at: string;
  model_version: string;
  inputs_fingerprint: string;
  min_evidence_level: EvidenceLevel;
  sample_size: number;
  evaluated_count: number;
  correct_count: number;
  incorrect_count: number;
  uncertain_count: number;
  precision?: number;
  reliability_buckets: readonly unknown[];
  error_summary: Record<string, unknown>;
  attrs?: Record<string, unknown>;
  items: readonly EdgeCalibrationRunItemInput[];
}

export async function upsertEdgeCalibrationLabel(client: DbTxClient, input: UpsertEdgeCalibrationLabelInput): Promise<{ label_id: string; inserted: boolean }> {
  const labelId = input.label_id ?? deterministicEdgeCalibrationLabelId(input);
  const result = await client.query<{ label_id: string; inserted: boolean } & pg.QueryResultRow>(
    `INSERT INTO edge_calibration_labels (
       label_id, edge_id, evidence_id, label, error_category, reviewer, reviewed_at, rationale, attrs
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     ON CONFLICT (label_id)
     DO UPDATE SET
       label = EXCLUDED.label,
       error_category = EXCLUDED.error_category,
       reviewed_at = EXCLUDED.reviewed_at,
       rationale = EXCLUDED.rationale,
       attrs = edge_calibration_labels.attrs || EXCLUDED.attrs,
       updated_at = now()
     RETURNING label_id, (xmax = 0) AS inserted`,
    [
      labelId,
      input.edge_id,
      input.evidence_id ?? null,
      input.label,
      input.error_category ?? null,
      input.reviewer,
      input.reviewed_at ?? new Date().toISOString(),
      input.rationale ?? null,
      JSON.stringify(input.attrs ?? {})
    ]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Failed to upsert edge calibration label for edge ${input.edge_id}`);
  return { label_id: row.label_id, inserted: row.inserted };
}

export async function listEdgeCalibrationLabels(client: DbClient, input: { edge_id?: string; limit?: number } = {}): Promise<EdgeCalibrationLabelRecord[]> {
  const params: unknown[] = [];
  const predicates: string[] = [];
  if (input.edge_id !== undefined) {
    params.push(input.edge_id);
    predicates.push(`edge_id = $${params.length}`);
  }
  params.push(input.limit ?? 100);
  const limitParam = `$${params.length}`;
  const where = predicates.length === 0 ? "" : `WHERE ${predicates.join(" AND ")}`;
  const result = await client.query<EdgeCalibrationLabelRow>(
    `SELECT label_id, edge_id, evidence_id, label, error_category, reviewer, reviewed_at, rationale, attrs
     FROM edge_calibration_labels
     ${where}
     ORDER BY reviewed_at DESC, label_id
     LIMIT ${limitParam}`,
    params
  );
  return result.rows.map(edgeCalibrationLabelRowToRecord);
}

export async function replaceEdgeCalibrationRun(client: DbTxClient, input: ReplaceEdgeCalibrationRunInput): Promise<{ run_id: string; items: number }> {
  const result = await client.query<{ run_id: string } & pg.QueryResultRow>(
    `INSERT INTO edge_calibration_runs (
       run_id, generated_at, model_version, inputs_fingerprint, min_evidence_level,
       sample_size, evaluated_count, correct_count, incorrect_count, uncertain_count,
       precision, reliability_buckets, error_summary, attrs
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb)
     ON CONFLICT (run_id)
     DO UPDATE SET
       generated_at = EXCLUDED.generated_at,
       model_version = EXCLUDED.model_version,
       inputs_fingerprint = EXCLUDED.inputs_fingerprint,
       min_evidence_level = EXCLUDED.min_evidence_level,
       sample_size = EXCLUDED.sample_size,
       evaluated_count = EXCLUDED.evaluated_count,
       correct_count = EXCLUDED.correct_count,
       incorrect_count = EXCLUDED.incorrect_count,
       uncertain_count = EXCLUDED.uncertain_count,
       precision = EXCLUDED.precision,
       reliability_buckets = EXCLUDED.reliability_buckets,
       error_summary = EXCLUDED.error_summary,
       attrs = edge_calibration_runs.attrs || EXCLUDED.attrs
     RETURNING run_id`,
    [
      input.run_id,
      input.generated_at,
      input.model_version,
      input.inputs_fingerprint,
      input.min_evidence_level,
      input.sample_size,
      input.evaluated_count,
      input.correct_count,
      input.incorrect_count,
      input.uncertain_count,
      input.precision ?? null,
      JSON.stringify(input.reliability_buckets),
      JSON.stringify(input.error_summary),
      JSON.stringify(input.attrs ?? {})
    ]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Failed to upsert edge calibration run ${input.run_id}`);

  await client.query("DELETE FROM edge_calibration_run_items WHERE run_id = $1", [row.run_id]);
  for (const item of input.items) {
    await client.query(
      `INSERT INTO edge_calibration_run_items (
         run_id, label_id, edge_id, evidence_id, evidence_level, predicted_confidence,
         confidence_bucket, label, error_category
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        row.run_id,
        item.label_id,
        item.edge_id,
        item.evidence_id ?? null,
        item.evidence_level,
        item.predicted_confidence,
        item.confidence_bucket,
        item.label,
        item.error_category ?? null
      ]
    );
  }
  return { run_id: row.run_id, items: input.items.length };
}

function edgeCalibrationLabelRowToRecord(row: EdgeCalibrationLabelRow): EdgeCalibrationLabelRecord {
  return {
    label_id: row.label_id,
    edge_id: row.edge_id,
    ...(row.evidence_id === null ? {} : { evidence_id: row.evidence_id }),
    label: row.label,
    ...(row.error_category === null ? {} : { error_category: row.error_category }),
    reviewer: row.reviewer,
    reviewed_at: toIsoString(row.reviewed_at),
    ...(row.rationale === null ? {} : { rationale: row.rationale }),
    attrs: row.attrs
  };
}

function deterministicEdgeCalibrationLabelId(input: UpsertEdgeCalibrationLabelInput): string {
  const digest = createHash("sha256")
    .update([input.edge_id, input.evidence_id ?? "", input.reviewer].join(":"))
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();
  return `CAL-LABEL-${digest}`;
}
