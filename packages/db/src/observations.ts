import type pg from "pg";
import { createId, type ObservationType } from "@supplystrata/core";
import type { DbClient, DbTxClient } from "./client.js";
import { recordSemanticChange } from "./changes.js";

export interface ObservationRow extends pg.QueryResultRow {
  observation_id: string;
  observation_type: ObservationType;
  source_adapter_id: string;
  source_item_id: string | null;
  doc_id: string | null;
  scope_kind: string;
  scope_id: string;
  geography_kind: string | null;
  geography_id: string | null;
  component_id: string | null;
  metric_name: string;
  metric_value: string | null;
  metric_unit: string | null;
  time_window_start: Date | null;
  time_window_end: Date | null;
  baseline_value: string | null;
  change_value: string | null;
  change_percent: number | null;
  confidence: number;
  provenance: Record<string, unknown>;
  attrs: Record<string, unknown>;
  created_at: Date;
}

export interface NewObservationInput {
  observation_id?: string;
  observation_type: ObservationType;
  source_adapter_id: string;
  source_item_id?: string;
  doc_id?: string;
  scope_kind: string;
  scope_id: string;
  geography_kind?: string;
  geography_id?: string;
  component_id?: string;
  metric_name: string;
  metric_value?: string;
  metric_unit?: string;
  time_window_start?: string;
  time_window_end?: string;
  baseline_value?: string;
  change_value?: string;
  change_percent?: number;
  confidence: number;
  provenance?: Record<string, unknown>;
  attrs?: Record<string, unknown>;
}

interface UpsertObservationRow extends pg.QueryResultRow {
  observation_id: string;
  inserted: boolean;
}

interface ObservationPatchRow extends pg.QueryResultRow {
  observation_id: string;
}

interface ObservationMeasurementSnapshotRow extends pg.QueryResultRow {
  observation_id: string;
  observation_type: ObservationType;
  source_adapter_id: string;
  source_item_id: string | null;
  doc_id: string | null;
  scope_kind: string;
  scope_id: string;
  metric_name: string;
  metric_value: string | null;
  metric_unit: string | null;
  baseline_value: string | null;
  change_value: string | null;
  change_percent: number | null;
  confidence: number;
}

export interface UpsertObservationResult {
  observation_id: string;
  inserted: boolean;
}

export interface PatchObservationMetadataInput {
  observation_id: string;
  provenance_patch?: Record<string, unknown>;
  attrs_patch?: Record<string, unknown>;
}

export interface CorrectObservationMeasurementInput {
  observation_id: string;
  reason: string;
  corrected_by: string;
  metric_value?: string | null;
  metric_unit?: string | null;
  baseline_value?: string | null;
  change_value?: string | null;
  change_percent?: number | null;
  confidence?: number;
}

export interface CorrectObservationMeasurementResult {
  observation_id: string;
  change_id: string;
}

export async function insertObservation(client: DbTxClient, input: NewObservationInput): Promise<{ observation_id: string }> {
  const observationId = input.observation_id ?? createId("OBS");
  await client.query(
    `INSERT INTO observations (
       observation_id, observation_type, source_adapter_id, source_item_id, doc_id,
       scope_kind, scope_id, geography_kind, geography_id, component_id, metric_name,
       metric_value, metric_unit, time_window_start, time_window_end, baseline_value,
       change_value, change_percent, confidence, provenance, attrs
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
    observationParams(observationId, input)
  );
  return { observation_id: observationId };
}

export async function upsertObservation(client: DbTxClient, input: NewObservationInput): Promise<UpsertObservationResult> {
  const observationId = input.observation_id ?? createId("OBS");
  const result = await client.query<UpsertObservationRow>(
    `INSERT INTO observations (
       observation_id, observation_type, source_adapter_id, source_item_id, doc_id,
       scope_kind, scope_id, geography_kind, geography_id, component_id, metric_name,
       metric_value, metric_unit, time_window_start, time_window_end, baseline_value,
       change_value, change_percent, confidence, provenance, attrs
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT (observation_id) DO UPDATE SET
       observation_id = observations.observation_id
     RETURNING observation_id, (xmax = 0) AS inserted`,
    observationParams(observationId, input)
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Observation upsert did not return a row: ${observationId}`);
  return { observation_id: row.observation_id, inserted: row.inserted };
}

export async function patchObservationMetadata(client: DbTxClient, input: PatchObservationMetadataInput): Promise<{ observation_id: string } | undefined> {
  const result = await client.query<ObservationPatchRow>(
    `UPDATE observations
     SET provenance = provenance || $2::jsonb,
         attrs = attrs || $3::jsonb
     WHERE observation_id = $1
     RETURNING observation_id`,
    [input.observation_id, JSON.stringify(input.provenance_patch ?? {}), JSON.stringify(input.attrs_patch ?? {})]
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return { observation_id: row.observation_id };
}

export async function correctObservationMeasurement(
  client: DbTxClient,
  input: CorrectObservationMeasurementInput
): Promise<CorrectObservationMeasurementResult | undefined> {
  const correction = observationMeasurementCorrection(input);
  if (correction.field_count === 0) throw new Error("Observation measurement correction requires at least one corrected measurement field");
  if (input.reason.trim().length === 0) throw new Error("Observation measurement correction requires a reason");
  if (input.corrected_by.trim().length === 0) throw new Error("Observation measurement correction requires corrected_by");
  if (input.confidence !== undefined && (input.confidence < 0 || input.confidence > 1)) {
    throw new Error(`Observation correction confidence must be between 0 and 1: ${input.confidence}`);
  }

  const before = await selectObservationMeasurementForUpdate(client, input.observation_id);
  if (before === undefined) return undefined;
  const afterResult = await client.query<ObservationMeasurementSnapshotRow>(
    `UPDATE observations
     SET metric_value = CASE WHEN $2 THEN $3::numeric ELSE metric_value END,
         metric_unit = CASE WHEN $4 THEN $5::text ELSE metric_unit END,
         baseline_value = CASE WHEN $6 THEN $7::numeric ELSE baseline_value END,
         change_value = CASE WHEN $8 THEN $9::numeric ELSE change_value END,
         change_percent = CASE WHEN $10 THEN $11::real ELSE change_percent END,
         confidence = CASE WHEN $12 THEN $13::real ELSE confidence END
     WHERE observation_id = $1
     RETURNING observation_id, observation_type, source_adapter_id, source_item_id, doc_id, scope_kind, scope_id,
               metric_name, metric_value::text, metric_unit, baseline_value::text, change_value::text, change_percent, confidence`,
    [
      input.observation_id,
      correction.has_metric_value,
      correction.metric_value,
      correction.has_metric_unit,
      correction.metric_unit,
      correction.has_baseline_value,
      correction.baseline_value,
      correction.has_change_value,
      correction.change_value,
      correction.has_change_percent,
      correction.change_percent,
      correction.has_confidence,
      correction.confidence
    ]
  );
  const after = afterResult.rows[0];
  if (after === undefined) throw new Error(`Observation disappeared during correction: ${input.observation_id}`);
  const change = await recordSemanticChange(client, {
    scope_kind: "observation",
    scope_id: input.observation_id,
    change_type: "OBSERVATION_CORRECTED",
    before: observationMeasurementPayload(before),
    after: {
      ...observationMeasurementPayload(after),
      correction_reason: input.reason,
      corrected_by: input.corrected_by
    },
    caused_by: input.corrected_by
  });
  return { observation_id: after.observation_id, change_id: change.change_id };
}

export async function listObservationsByScope(
  client: DbClient,
  input: { scope_kind: string; scope_id: string; observation_type?: ObservationType; limit?: number }
): Promise<ObservationRow[]> {
  const limit = input.limit ?? 50;
  const params: unknown[] = [input.scope_kind, input.scope_id];
  const predicates = ["scope_kind = $1", "scope_id = $2"];
  if (input.observation_type !== undefined) {
    params.push(input.observation_type);
    predicates.push(`observation_type = $${params.length}`);
  }
  params.push(limit);
  const result = await client.query<ObservationRow>(
    `SELECT observation_id, observation_type, source_adapter_id, source_item_id, doc_id,
            scope_kind, scope_id, geography_kind, geography_id, component_id, metric_name,
            metric_value::text, metric_unit, time_window_start, time_window_end, baseline_value::text,
            change_value::text, change_percent, confidence, provenance, attrs, created_at
     FROM observations
     WHERE ${predicates.join(" AND ")}
     ORDER BY time_window_end DESC NULLS LAST, created_at DESC, observation_id
     LIMIT $${params.length}`,
    params
  );
  return result.rows;
}

async function selectObservationMeasurementForUpdate(client: DbTxClient, observationId: string): Promise<ObservationMeasurementSnapshotRow | undefined> {
  const result = await client.query<ObservationMeasurementSnapshotRow>(
    `SELECT observation_id, observation_type, source_adapter_id, source_item_id, doc_id, scope_kind, scope_id,
            metric_name, metric_value::text, metric_unit, baseline_value::text, change_value::text, change_percent, confidence
     FROM observations
     WHERE observation_id = $1
     FOR UPDATE`,
    [observationId]
  );
  return result.rows[0];
}

function observationMeasurementPayload(row: ObservationMeasurementSnapshotRow): Record<string, unknown> {
  return {
    observation_id: row.observation_id,
    observation_type: row.observation_type,
    source_adapter_id: row.source_adapter_id,
    source_item_id: row.source_item_id,
    doc_id: row.doc_id,
    scope_kind: row.scope_kind,
    scope_id: row.scope_id,
    metric_name: row.metric_name,
    metric_value: row.metric_value,
    metric_unit: row.metric_unit,
    baseline_value: row.baseline_value,
    change_value: row.change_value,
    change_percent: row.change_percent,
    confidence: row.confidence
  };
}

function observationMeasurementCorrection(input: CorrectObservationMeasurementInput): {
  has_metric_value: boolean;
  metric_value: string | null;
  has_metric_unit: boolean;
  metric_unit: string | null;
  has_baseline_value: boolean;
  baseline_value: string | null;
  has_change_value: boolean;
  change_value: string | null;
  has_change_percent: boolean;
  change_percent: number | null;
  has_confidence: boolean;
  confidence: number | null;
  field_count: number;
} {
  const hasMetricValue = hasCorrectionValue(input, "metric_value");
  const hasMetricUnit = hasCorrectionValue(input, "metric_unit");
  const hasBaselineValue = hasCorrectionValue(input, "baseline_value");
  const hasChangeValue = hasCorrectionValue(input, "change_value");
  const hasChangePercent = hasCorrectionValue(input, "change_percent");
  const hasConfidence = hasCorrectionValue(input, "confidence");
  return {
    has_metric_value: hasMetricValue,
    metric_value: input.metric_value ?? null,
    has_metric_unit: hasMetricUnit,
    metric_unit: input.metric_unit ?? null,
    has_baseline_value: hasBaselineValue,
    baseline_value: input.baseline_value ?? null,
    has_change_value: hasChangeValue,
    change_value: input.change_value ?? null,
    has_change_percent: hasChangePercent,
    change_percent: input.change_percent ?? null,
    has_confidence: hasConfidence,
    confidence: input.confidence ?? null,
    field_count: [hasMetricValue, hasMetricUnit, hasBaselineValue, hasChangeValue, hasChangePercent, hasConfidence].filter(Boolean).length
  };
}

function hasCorrectionValue(value: CorrectObservationMeasurementInput, key: keyof CorrectObservationMeasurementInput): boolean {
  return Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined;
}

export async function getObservation(client: DbClient, observationId: string): Promise<ObservationRow | undefined> {
  const result = await client.query<ObservationRow>(
    `SELECT observation_id, observation_type, source_adapter_id, source_item_id, doc_id,
            scope_kind, scope_id, geography_kind, geography_id, component_id, metric_name,
            metric_value::text, metric_unit, time_window_start, time_window_end, baseline_value::text,
            change_value::text, change_percent, confidence, provenance, attrs, created_at
     FROM observations
     WHERE observation_id = $1`,
    [observationId]
  );
  return result.rows[0];
}

function observationParams(observationId: string, input: NewObservationInput): readonly unknown[] {
  return [
    observationId,
    input.observation_type,
    input.source_adapter_id,
    input.source_item_id ?? null,
    input.doc_id ?? null,
    input.scope_kind,
    input.scope_id,
    input.geography_kind ?? null,
    input.geography_id ?? null,
    input.component_id ?? null,
    input.metric_name,
    input.metric_value ?? null,
    input.metric_unit ?? null,
    input.time_window_start ?? null,
    input.time_window_end ?? null,
    input.baseline_value ?? null,
    input.change_value ?? null,
    input.change_percent ?? null,
    input.confidence,
    input.provenance ?? {},
    input.attrs ?? {}
  ];
}
