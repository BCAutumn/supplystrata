export const migration0010GraphProjectionJobsSql = `
CREATE TABLE IF NOT EXISTS graph_projection_jobs (
  job_id TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  edge_id TEXT NOT NULL REFERENCES edges(edge_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_graph_projection_jobs_due
  ON graph_projection_jobs (status, next_attempt_at, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_graph_projection_jobs_active_edge_operation
  ON graph_projection_jobs (operation, edge_id)
  WHERE status IN ('pending','failed');
`;
