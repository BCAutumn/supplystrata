import { RISK_METRIC_KINDS } from "@supplystrata/core";

export const sql = `
CREATE TABLE IF NOT EXISTS risk_views (
  risk_view_id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  model_version TEXT NOT NULL,
  inputs_fingerprint TEXT NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_risk_views_scope ON risk_views(scope_kind, scope_id, generated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_risk_views_scope_model_inputs ON risk_views(scope_kind, scope_id, model_version, inputs_fingerprint);

CREATE TABLE IF NOT EXISTS risk_metrics (
  metric_id TEXT PRIMARY KEY,
  risk_view_id TEXT NOT NULL REFERENCES risk_views(risk_view_id) ON DELETE CASCADE,
  metric_kind TEXT NOT NULL CHECK (metric_kind IN (${RISK_METRIC_KINDS.map(sqlString).join(",")})),
  subject_kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  component_id TEXT REFERENCES components(component_id),
  value NUMERIC,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_risk_metrics_view ON risk_metrics(risk_view_id);
CREATE INDEX IF NOT EXISTS idx_risk_metrics_component ON risk_metrics(component_id) WHERE component_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_risk_metric_identity ON risk_metrics(
  risk_view_id,
  metric_kind,
  subject_kind,
  subject_id,
  COALESCE(component_id, '')
);
`;

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
