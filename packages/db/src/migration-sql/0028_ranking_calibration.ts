import { RANKING_CALIBRATION_LABELS } from "@supplystrata/core";

export const sql = `
CREATE TABLE IF NOT EXISTS ranking_calibration_labels (
  label_id TEXT PRIMARY KEY,
  ranking_context_id TEXT NOT NULL,
  ranking_kind TEXT NOT NULL,
  model_version TEXT NOT NULL,
  candidate_entity_id TEXT NOT NULL,
  candidate_rank INT NOT NULL CHECK (candidate_rank > 0),
  label TEXT NOT NULL CHECK (label IN (${RANKING_CALIBRATION_LABELS.map(sqlString).join(",")})),
  reviewer TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL,
  rationale TEXT,
  score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_ranking_calibration_label_reviewer
  ON ranking_calibration_labels(ranking_context_id, candidate_entity_id, reviewer);
CREATE INDEX IF NOT EXISTS idx_ranking_calibration_labels_context
  ON ranking_calibration_labels(ranking_context_id);
CREATE INDEX IF NOT EXISTS idx_ranking_calibration_labels_label
  ON ranking_calibration_labels(label);
CREATE INDEX IF NOT EXISTS idx_ranking_calibration_labels_reviewed_at
  ON ranking_calibration_labels(reviewed_at DESC);
`;

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
