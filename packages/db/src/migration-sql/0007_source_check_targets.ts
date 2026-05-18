export const migration0007SourceCheckTargetsSql = `
CREATE TABLE IF NOT EXISTS source_check_targets (
  check_target_id TEXT PRIMARY KEY,
  source_adapter_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  subject_entity_id TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  priority INT NOT NULL DEFAULT 100,
  next_check_at TIMESTAMPTZ,
  target_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  config_source TEXT NOT NULL DEFAULT 'default',
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_source_check_targets_due ON source_check_targets(enabled, next_check_at, priority);
CREATE INDEX IF NOT EXISTS idx_source_check_targets_source ON source_check_targets(source_adapter_id, enabled);
CREATE INDEX IF NOT EXISTS idx_source_check_targets_subject ON source_check_targets(subject_entity_id);
`;
