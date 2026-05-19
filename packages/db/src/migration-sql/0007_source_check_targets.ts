export const migration0007SourceCheckTargetsSql = `
CREATE TABLE IF NOT EXISTS source_check_targets (
  check_target_id TEXT PRIMARY KEY,
  source_adapter_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  subject_entity_id TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  priority INT NOT NULL DEFAULT 100,
  next_check_at TIMESTAMPTZ,
  check_cadence_minutes INT CHECK (check_cadence_minutes IS NULL OR check_cadence_minutes > 0),
  jitter_minutes INT CHECK (jitter_minutes IS NULL OR jitter_minutes >= 0),
  max_attempts INT CHECK (max_attempts IS NULL OR max_attempts > 0),
  backoff_base_minutes INT CHECK (backoff_base_minutes IS NULL OR backoff_base_minutes > 0),
  backoff_max_minutes INT CHECK (backoff_max_minutes IS NULL OR backoff_max_minutes > 0),
  target_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  config_source TEXT NOT NULL DEFAULT 'default',
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_source_check_targets_due ON source_check_targets(enabled, next_check_at, priority);
CREATE INDEX IF NOT EXISTS idx_source_check_targets_source ON source_check_targets(source_adapter_id, enabled);
CREATE INDEX IF NOT EXISTS idx_source_check_targets_subject ON source_check_targets(subject_entity_id);
`;
