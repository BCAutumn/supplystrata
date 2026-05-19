export const sql = `
ALTER TABLE source_change_events
  ADD COLUMN IF NOT EXISTS check_target_id TEXT;

CREATE INDEX IF NOT EXISTS idx_source_change_events_check_target
  ON source_change_events(check_target_id, detected_at DESC);
`;
