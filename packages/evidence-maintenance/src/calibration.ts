import { createHash } from "node:crypto";
import type { EdgeCalibrationErrorCategory, EdgeCalibrationLabel, EvidenceLevel } from "@supplystrata/core";
import type { DbClient } from "@supplystrata/db";
import { replaceEdgeCalibrationRun, upsertEdgeCalibrationLabel } from "@supplystrata/db";
import type { EdgeCalibrationSampleRow } from "./db-rows.js";

export interface RecordEdgeCalibrationLabelInput {
  label_id?: string;
  edge_id: string;
  evidence_id?: string;
  label: EdgeCalibrationLabel;
  error_category?: EdgeCalibrationErrorCategory;
  reviewer: string;
  reviewed_at?: string;
  rationale?: string;
}

export interface RefreshEdgeCalibrationRunInput {
  min_evidence_level?: EvidenceLevel;
  limit?: number;
  generated_at?: string;
  generated_by?: string;
}

export interface EdgeCalibrationRunSummary {
  run_id: string;
  sample_size: number;
  evaluated_count: number;
  correct_count: number;
  incorrect_count: number;
  uncertain_count: number;
  precision?: number;
  reliability_buckets: readonly ReliabilityBucket[];
  error_summary: Record<string, number>;
  model_version: string;
  inputs_fingerprint: string;
}

interface ReliabilityBucket {
  bucket: string;
  sample_size: number;
  evaluated_count: number;
  correct_count: number;
  incorrect_count: number;
  uncertain_count: number;
  average_confidence: number;
  empirical_precision?: number;
}

const EDGE_CALIBRATION_MODEL_VERSION = "edge-calibration-baseline.v1";

type StableJsonArray = readonly StableJsonValue[];
type StableJsonObject = { readonly [key: string]: StableJsonValue };
type StableJsonValue = null | string | number | boolean | StableJsonArray | StableJsonObject;

export async function recordEdgeCalibrationLabel(client: DbClient, input: RecordEdgeCalibrationLabelInput): Promise<{ label_id: string; inserted: boolean }> {
  if (input.label === "incorrect" && input.error_category === undefined) throw new Error("Incorrect calibration labels require an error_category");
  if (input.label !== "incorrect" && input.error_category !== undefined) throw new Error("Only incorrect calibration labels may include an error_category");
  return upsertEdgeCalibrationLabel(client, {
    ...(input.label_id === undefined ? {} : { label_id: input.label_id }),
    edge_id: input.edge_id,
    ...(input.evidence_id === undefined ? {} : { evidence_id: input.evidence_id }),
    label: input.label,
    ...(input.error_category === undefined ? {} : { error_category: input.error_category }),
    reviewer: input.reviewer,
    ...(input.reviewed_at === undefined ? {} : { reviewed_at: input.reviewed_at }),
    ...(input.rationale === undefined ? {} : { rationale: input.rationale }),
    attrs: { recorded_by: "evidence-maintenance.edge-calibration.v1" }
  });
}

export async function refreshEdgeCalibrationRun(client: DbClient, input: RefreshEdgeCalibrationRunInput = {}): Promise<EdgeCalibrationRunSummary> {
  const minEvidenceLevel = input.min_evidence_level ?? 4;
  const limit = input.limit ?? 1000;
  validateRefreshInput({ minEvidenceLevel, limit });
  const generatedAt = input.generated_at ?? new Date().toISOString();
  const generatedBy = input.generated_by ?? "evidence-maintenance.edge-calibration.v1";
  const rows = await listCalibrationSamples(client, { minEvidenceLevel, limit });
  const counts = calibrationCounts(rows);
  const reliabilityBuckets = buildReliabilityBuckets(rows);
  const errorSummary = buildErrorSummary(rows);
  const fingerprint = calibrationInputsFingerprint({ minEvidenceLevel, rows });
  const runId = deterministicCalibrationRunId(fingerprint);

  await replaceEdgeCalibrationRun(client, {
    run_id: runId,
    generated_at: generatedAt,
    model_version: EDGE_CALIBRATION_MODEL_VERSION,
    inputs_fingerprint: fingerprint,
    min_evidence_level: minEvidenceLevel,
    sample_size: rows.length,
    evaluated_count: counts.evaluated_count,
    correct_count: counts.correct_count,
    incorrect_count: counts.incorrect_count,
    uncertain_count: counts.uncertain_count,
    ...(counts.precision === undefined ? {} : { precision: counts.precision }),
    reliability_buckets: reliabilityBuckets,
    error_summary: errorSummary,
    attrs: { generated_by: generatedBy },
    items: rows.map((row) => ({
      label_id: row.label_id,
      edge_id: row.edge_id,
      ...(row.evidence_id === null ? {} : { evidence_id: row.evidence_id }),
      evidence_level: row.evidence_level,
      predicted_confidence: row.confidence,
      confidence_bucket: confidenceBucket(row.confidence),
      label: row.label,
      ...(row.error_category === null ? {} : { error_category: row.error_category })
    }))
  });

  return {
    run_id: runId,
    sample_size: rows.length,
    evaluated_count: counts.evaluated_count,
    correct_count: counts.correct_count,
    incorrect_count: counts.incorrect_count,
    uncertain_count: counts.uncertain_count,
    ...(counts.precision === undefined ? {} : { precision: counts.precision }),
    reliability_buckets: reliabilityBuckets,
    error_summary: errorSummary,
    model_version: EDGE_CALIBRATION_MODEL_VERSION,
    inputs_fingerprint: fingerprint
  };
}

async function listCalibrationSamples(client: DbClient, input: { minEvidenceLevel: EvidenceLevel; limit: number }): Promise<EdgeCalibrationSampleRow[]> {
  const result = await client.query<EdgeCalibrationSampleRow>(
    `SELECT labels.label_id, labels.edge_id, labels.evidence_id, labels.label, labels.error_category,
            labels.reviewer, labels.reviewed_at, labels.rationale,
            edges.subject_id, edges.object_id, edges.relation, edges.component_id,
            edges.evidence_level, edges.confidence, edges.is_inferred,
            evidence.extraction_method,
            documents.source_adapter_id,
            evidence.doc_id
     FROM edge_calibration_labels labels
     JOIN edges ON edges.edge_id = labels.edge_id
     LEFT JOIN evidence ON evidence.evidence_id = COALESCE(labels.evidence_id, edges.primary_evidence_id)
     LEFT JOIN documents ON documents.doc_id = evidence.doc_id
     WHERE edges.evidence_level >= $1
       AND edges.validity = 'current'
     ORDER BY labels.reviewed_at DESC, labels.label_id
     LIMIT $2`,
    [input.minEvidenceLevel, input.limit]
  );
  return result.rows;
}

function validateRefreshInput(input: { minEvidenceLevel: EvidenceLevel; limit: number }): void {
  if (!Number.isInteger(input.minEvidenceLevel) || input.minEvidenceLevel < 1 || input.minEvidenceLevel > 5) {
    throw new Error(`Calibration min_evidence_level must be between 1 and 5: ${input.minEvidenceLevel}`);
  }
  if (!Number.isInteger(input.limit) || input.limit <= 0) throw new Error(`Calibration limit must be a positive integer: ${input.limit}`);
}

function calibrationCounts(rows: readonly EdgeCalibrationSampleRow[]): {
  evaluated_count: number;
  correct_count: number;
  incorrect_count: number;
  uncertain_count: number;
  precision?: number;
} {
  const correctCount = rows.filter((row) => row.label === "correct").length;
  const incorrectCount = rows.filter((row) => row.label === "incorrect").length;
  const uncertainCount = rows.filter((row) => row.label === "uncertain").length;
  const evaluatedCount = correctCount + incorrectCount;
  return {
    evaluated_count: evaluatedCount,
    correct_count: correctCount,
    incorrect_count: incorrectCount,
    uncertain_count: uncertainCount,
    ...(evaluatedCount === 0 ? {} : { precision: roundSix(correctCount / evaluatedCount) })
  };
}

function buildReliabilityBuckets(rows: readonly EdgeCalibrationSampleRow[]): ReliabilityBucket[] {
  const byBucket = new Map<string, EdgeCalibrationSampleRow[]>();
  for (const row of rows) {
    const bucket = confidenceBucket(row.confidence);
    const group = byBucket.get(bucket) ?? [];
    group.push(row);
    byBucket.set(bucket, group);
  }
  return [...byBucket.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([bucket, bucketRows]) => {
      const counts = calibrationCounts(bucketRows);
      return {
        bucket,
        sample_size: bucketRows.length,
        evaluated_count: counts.evaluated_count,
        correct_count: counts.correct_count,
        incorrect_count: counts.incorrect_count,
        uncertain_count: counts.uncertain_count,
        average_confidence: roundSix(average(bucketRows.map((row) => row.confidence))),
        ...(counts.precision === undefined ? {} : { empirical_precision: counts.precision })
      };
    });
}

function buildErrorSummary(rows: readonly EdgeCalibrationSampleRow[]): Record<string, number> {
  const summary = new Map<string, number>();
  for (const row of rows) {
    if (row.label !== "incorrect") continue;
    const category = row.error_category ?? "other";
    summary.set(category, (summary.get(category) ?? 0) + 1);
  }
  return Object.fromEntries([...summary.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function confidenceBucket(confidence: number): string {
  const lower = Math.max(0, Math.min(0.9, Math.floor(confidence * 10) / 10));
  return `${lower.toFixed(1)}-${(lower + 0.1).toFixed(1)}`;
}

function calibrationInputsFingerprint(input: { minEvidenceLevel: EvidenceLevel; rows: readonly EdgeCalibrationSampleRow[] }): string {
  return createHash("sha256")
    .update(
      stableJson({
        model_version: EDGE_CALIBRATION_MODEL_VERSION,
        min_evidence_level: input.minEvidenceLevel,
        labels: input.rows.map((row) => ({
          label_id: row.label_id,
          edge_id: row.edge_id,
          evidence_id: row.evidence_id,
          label: row.label,
          error_category: row.error_category,
          reviewer: row.reviewer,
          reviewed_at: row.reviewed_at.toISOString(),
          subject_id: row.subject_id,
          object_id: row.object_id,
          relation: row.relation,
          component_id: row.component_id,
          evidence_level: row.evidence_level,
          confidence: row.confidence,
          is_inferred: row.is_inferred,
          extraction_method: row.extraction_method,
          source_adapter_id: row.source_adapter_id,
          doc_id: row.doc_id
        }))
      })
    )
    .digest("hex");
}

function deterministicCalibrationRunId(fingerprint: string): string {
  return `CAL-RUN-${fingerprint.slice(0, 24).toUpperCase()}`;
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function roundSix(value: number): number {
  return Number(value.toFixed(6));
}

function stableJson(value: StableJsonValue): string {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (isStableJsonArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key] ?? null)}`)
    .join(",")}}`;
}

function isStableJsonArray(value: StableJsonValue): value is StableJsonArray {
  return Array.isArray(value);
}
