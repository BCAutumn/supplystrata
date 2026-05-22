export const sql = `
ALTER TABLE source_check_jobs
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_source_check_jobs_lease
  ON source_check_jobs(status, lease_expires_at)
  WHERE status = 'in_progress';
`;
