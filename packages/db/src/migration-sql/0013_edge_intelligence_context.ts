import { EDGE_FRESHNESS_DECAY_MODELS, EDGE_STRENGTH_KINDS } from "@supplystrata/core";

export const sql = `
CREATE TABLE IF NOT EXISTS edge_strength_estimates (
  strength_id TEXT PRIMARY KEY,
  identity_key TEXT NOT NULL,
  edge_id TEXT NOT NULL REFERENCES edges(edge_id) ON DELETE CASCADE,
  strength_kind TEXT NOT NULL CHECK (strength_kind IN (${EDGE_STRENGTH_KINDS.map(sqlString).join(",")})),
  value NUMERIC,
  lower_bound NUMERIC,
  upper_bound NUMERIC,
  unit TEXT,
  evidence_id TEXT REFERENCES evidence(evidence_id),
  method TEXT NOT NULL,
  valid_from DATE,
  valid_to DATE,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_edge_strength_identity ON edge_strength_estimates(identity_key);
CREATE INDEX IF NOT EXISTS idx_edge_strength_edge ON edge_strength_estimates(edge_id);
CREATE INDEX IF NOT EXISTS idx_edge_strength_evidence ON edge_strength_estimates(evidence_id) WHERE evidence_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS edge_freshness (
  edge_id TEXT PRIMARY KEY REFERENCES edges(edge_id) ON DELETE CASCADE,
  last_verified_at TIMESTAMPTZ NOT NULL,
  decay_model TEXT NOT NULL CHECK (decay_model IN (${EDGE_FRESHNESS_DECAY_MODELS.map(sqlString).join(",")})),
  age_days INTEGER NOT NULL CHECK (age_days >= 0),
  freshness_score REAL NOT NULL CHECK (freshness_score >= 0 AND freshness_score <= 1),
  computed_at TIMESTAMPTZ NOT NULL,
  source_evidence_id TEXT REFERENCES evidence(evidence_id),
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_edge_freshness_score ON edge_freshness(freshness_score);
CREATE INDEX IF NOT EXISTS idx_edge_freshness_verified ON edge_freshness(last_verified_at);
`;

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
