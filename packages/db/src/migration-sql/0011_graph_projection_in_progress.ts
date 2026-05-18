export const sql = `
DROP INDEX IF EXISTS uniq_graph_projection_jobs_active_edge_operation;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_graph_projection_jobs_active_edge_operation
  ON graph_projection_jobs (operation, edge_id)
  WHERE status IN ('pending','failed','in_progress');
`;
