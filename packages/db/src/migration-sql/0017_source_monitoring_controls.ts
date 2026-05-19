export const sql = `
ALTER TABLE source_policies
  ADD COLUMN IF NOT EXISTS max_attempts INT NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  ADD COLUMN IF NOT EXISTS backoff_base_minutes INT NOT NULL DEFAULT 1 CHECK (backoff_base_minutes > 0),
  ADD COLUMN IF NOT EXISTS backoff_max_minutes INT NOT NULL DEFAULT 60 CHECK (backoff_max_minutes > 0);

ALTER TABLE source_check_targets
  ADD COLUMN IF NOT EXISTS check_cadence_minutes INT CHECK (check_cadence_minutes IS NULL OR check_cadence_minutes > 0),
  ADD COLUMN IF NOT EXISTS jitter_minutes INT CHECK (jitter_minutes IS NULL OR jitter_minutes >= 0),
  ADD COLUMN IF NOT EXISTS max_attempts INT CHECK (max_attempts IS NULL OR max_attempts > 0),
  ADD COLUMN IF NOT EXISTS backoff_base_minutes INT CHECK (backoff_base_minutes IS NULL OR backoff_base_minutes > 0),
  ADD COLUMN IF NOT EXISTS backoff_max_minutes INT CHECK (backoff_max_minutes IS NULL OR backoff_max_minutes > 0);

ALTER TABLE source_check_jobs
  ADD COLUMN IF NOT EXISTS backoff_base_minutes INT NOT NULL DEFAULT 1 CHECK (backoff_base_minutes > 0),
  ADD COLUMN IF NOT EXISTS backoff_max_minutes INT NOT NULL DEFAULT 60 CHECK (backoff_max_minutes > 0);
`;
