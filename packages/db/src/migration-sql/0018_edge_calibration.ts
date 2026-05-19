import { EDGE_CALIBRATION_ERROR_CATEGORIES, EDGE_CALIBRATION_LABELS } from "@supplystrata/core";

export const sql = `
CREATE TABLE IF NOT EXISTS edge_calibration_labels (
  label_id TEXT PRIMARY KEY,
  edge_id TEXT NOT NULL REFERENCES edges(edge_id) ON DELETE CASCADE,
  evidence_id TEXT REFERENCES evidence(evidence_id) ON DELETE SET NULL,
  label TEXT NOT NULL CHECK (label IN (${EDGE_CALIBRATION_LABELS.map(sqlString).join(",")})),
  error_category TEXT CHECK (error_category IS NULL OR error_category IN (${EDGE_CALIBRATION_ERROR_CATEGORIES.map(sqlString).join(",")})),
  CHECK ((label = 'incorrect' AND error_category IS NOT NULL) OR (label <> 'incorrect' AND error_category IS NULL)),
  reviewer TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL,
  rationale TEXT,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_edge_calibration_label_with_evidence ON edge_calibration_labels(edge_id, evidence_id, reviewer)
WHERE evidence_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_edge_calibration_label_without_evidence ON edge_calibration_labels(edge_id, reviewer)
WHERE evidence_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_edge_calibration_labels_edge ON edge_calibration_labels(edge_id);
CREATE INDEX IF NOT EXISTS idx_edge_calibration_labels_reviewed_at ON edge_calibration_labels(reviewed_at DESC);

CREATE TABLE IF NOT EXISTS edge_calibration_runs (
  run_id TEXT PRIMARY KEY,
  generated_at TIMESTAMPTZ NOT NULL,
  model_version TEXT NOT NULL,
  inputs_fingerprint TEXT NOT NULL,
  min_evidence_level SMALLINT NOT NULL CHECK (min_evidence_level BETWEEN 1 AND 5),
  sample_size INT NOT NULL,
  evaluated_count INT NOT NULL,
  correct_count INT NOT NULL,
  incorrect_count INT NOT NULL,
  uncertain_count INT NOT NULL,
  precision NUMERIC,
  reliability_buckets JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_edge_calibration_run_inputs ON edge_calibration_runs(model_version, inputs_fingerprint);
CREATE INDEX IF NOT EXISTS idx_edge_calibration_runs_generated_at ON edge_calibration_runs(generated_at DESC);

CREATE TABLE IF NOT EXISTS edge_calibration_run_items (
  run_id TEXT NOT NULL REFERENCES edge_calibration_runs(run_id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES edge_calibration_labels(label_id) ON DELETE CASCADE,
  edge_id TEXT NOT NULL REFERENCES edges(edge_id) ON DELETE CASCADE,
  evidence_id TEXT REFERENCES evidence(evidence_id) ON DELETE SET NULL,
  evidence_level SMALLINT NOT NULL,
  predicted_confidence REAL NOT NULL CHECK (predicted_confidence >= 0 AND predicted_confidence <= 1),
  confidence_bucket TEXT NOT NULL,
  label TEXT NOT NULL CHECK (label IN (${EDGE_CALIBRATION_LABELS.map(sqlString).join(",")})),
  error_category TEXT CHECK (error_category IS NULL OR error_category IN (${EDGE_CALIBRATION_ERROR_CATEGORIES.map(sqlString).join(",")})),
  CHECK ((label = 'incorrect' AND error_category IS NOT NULL) OR (label <> 'incorrect' AND error_category IS NULL)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_edge_calibration_run_items_edge ON edge_calibration_run_items(edge_id);
CREATE INDEX IF NOT EXISTS idx_edge_calibration_run_items_bucket ON edge_calibration_run_items(run_id, confidence_bucket);
`;

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
