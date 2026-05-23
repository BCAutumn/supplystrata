export const sql = `
ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS last_human_edit_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_human_editor TEXT;

CREATE INDEX IF NOT EXISTS idx_claims_last_human_edit
  ON claims(last_human_edit_at)
  WHERE last_human_edit_at IS NOT NULL;
`;
