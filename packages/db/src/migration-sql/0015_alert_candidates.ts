import { ALERT_KINDS } from "@supplystrata/core";

export const sql = `
CREATE TABLE IF NOT EXISTS alert_candidates (
  alert_id TEXT PRIMARY KEY,
  alert_kind TEXT NOT NULL CHECK (alert_kind IN (${ALERT_KINDS.map(sqlString).join(",")})),
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','suppressed')),
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  observation_id TEXT REFERENCES observations(observation_id),
  risk_view_id TEXT REFERENCES risk_views(risk_view_id) ON DELETE SET NULL,
  risk_metric_id TEXT REFERENCES risk_metrics(metric_id) ON DELETE SET NULL,
  change_id TEXT REFERENCES change_records(change_id) ON DELETE SET NULL,
  source_event_id TEXT,
  source_adapter_id TEXT,
  detected_at TIMESTAMPTZ NOT NULL,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_alert_candidates_dedupe ON alert_candidates(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_alert_candidates_status ON alert_candidates(status, severity, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_candidates_scope ON alert_candidates(scope_kind, scope_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_candidates_source ON alert_candidates(source_adapter_id, detected_at DESC) WHERE source_adapter_id IS NOT NULL;
`;

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
