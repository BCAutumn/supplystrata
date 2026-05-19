export const sql = `
CREATE TABLE IF NOT EXISTS source_check_jobs (
  job_id TEXT PRIMARY KEY,
  check_target_id TEXT NOT NULL REFERENCES source_check_targets(check_target_id) ON DELETE CASCADE,
  source_adapter_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','failed','succeeded','dead')),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INT NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  backoff_base_minutes INT NOT NULL DEFAULT 1 CHECK (backoff_base_minutes > 0),
  backoff_max_minutes INT NOT NULL DEFAULT 60 CHECK (backoff_max_minutes > 0),
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_check_jobs_active_target
  ON source_check_jobs(check_target_id)
  WHERE status IN ('pending','in_progress','failed');

CREATE INDEX IF NOT EXISTS idx_source_check_jobs_due
  ON source_check_jobs(status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS idx_source_check_jobs_target
  ON source_check_jobs(check_target_id, created_at DESC);
`;
