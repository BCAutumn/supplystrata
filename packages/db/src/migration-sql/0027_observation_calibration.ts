import { OBSERVATION_CALIBRATION_LABELS } from "@supplystrata/core";

export const sql = `
CREATE TABLE IF NOT EXISTS observation_calibration_labels (
  label_id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL REFERENCES observations(observation_id) ON DELETE CASCADE,
  candidate_id TEXT,
  label TEXT NOT NULL CHECK (label IN (${OBSERVATION_CALIBRATION_LABELS.map(sqlString).join(",")})),
  reviewer TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL,
  rationale TEXT,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_observation_calibration_label_reviewer ON observation_calibration_labels(observation_id, reviewer);
CREATE INDEX IF NOT EXISTS idx_observation_calibration_labels_observation ON observation_calibration_labels(observation_id);
CREATE INDEX IF NOT EXISTS idx_observation_calibration_labels_label ON observation_calibration_labels(label);
CREATE INDEX IF NOT EXISTS idx_observation_calibration_labels_reviewed_at ON observation_calibration_labels(reviewed_at DESC);
`;

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
