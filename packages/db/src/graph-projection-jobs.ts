import type pg from "pg";
import { createId } from "@supplystrata/core";
import type { DbClient } from "./client.js";

export type GraphProjectionOperation = "upsert_edge" | "remove_edge";
export type GraphProjectionJobStatus = "pending" | "failed" | "in_progress" | "succeeded";

export interface GraphProjectionJobRow extends pg.QueryResultRow {
  job_id: string;
  operation: GraphProjectionOperation;
  edge_id: string;
  status: GraphProjectionJobStatus;
  attempts: number;
  last_error: string | null;
  next_attempt_at: Date;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

export async function recordGraphProjectionFailure(
  client: DbClient,
  input: { operation: GraphProjectionOperation; edge_id: string; error_message: string }
): Promise<GraphProjectionJobRow> {
  const result = await client.query<GraphProjectionJobRow>(
    `INSERT INTO graph_projection_jobs (job_id, operation, edge_id, status, attempts, last_error, next_attempt_at)
     VALUES ($1,$2,$3,'pending',1,$4,now() + interval '1 minute')
     ON CONFLICT (operation, edge_id) WHERE status IN ('pending','failed','in_progress')
     DO UPDATE SET
       status = 'pending',
       attempts = graph_projection_jobs.attempts + 1,
       last_error = EXCLUDED.last_error,
       next_attempt_at = now() + (LEAST(graph_projection_jobs.attempts + 1, 10) * interval '1 minute'),
       updated_at = now(),
       completed_at = NULL
     RETURNING job_id, operation, edge_id, status, attempts, last_error, next_attempt_at, created_at, updated_at, completed_at`,
    [createId("GPJ"), input.operation, input.edge_id, input.error_message]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Failed to record graph projection job for edge: ${input.edge_id}`);
  return row;
}

export async function markGraphProjectionJobsSucceeded(client: DbClient, input: { operation: GraphProjectionOperation; edge_id: string }): Promise<number> {
  const result = await client.query(
    `UPDATE graph_projection_jobs
     SET status = 'succeeded', updated_at = now(), completed_at = now()
     WHERE operation = $1
       AND edge_id = $2
       AND status IN ('pending','failed','in_progress')`,
    [input.operation, input.edge_id]
  );
  return result.rowCount ?? 0;
}

export async function listDueGraphProjectionJobs(client: DbClient, input: { limit: number }): Promise<GraphProjectionJobRow[]> {
  const result = await client.query<GraphProjectionJobRow>(
    `SELECT job_id, operation, edge_id, status, attempts, last_error, next_attempt_at, created_at, updated_at, completed_at
     FROM graph_projection_jobs
     WHERE status IN ('pending','failed')
       AND next_attempt_at <= now()
     ORDER BY next_attempt_at, created_at, job_id
     LIMIT $1`,
    [input.limit]
  );
  return result.rows;
}

export async function claimDueGraphProjectionJobs(client: DbClient, input: { limit: number }): Promise<GraphProjectionJobRow[]> {
  const result = await client.query<GraphProjectionJobRow>(
    `WITH due AS (
       SELECT job_id
       FROM graph_projection_jobs
       WHERE status IN ('pending','failed')
         AND next_attempt_at <= now()
       ORDER BY next_attempt_at, created_at, job_id
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE graph_projection_jobs jobs
     SET status = 'in_progress', updated_at = now()
     FROM due
     WHERE jobs.job_id = due.job_id
     RETURNING jobs.job_id, jobs.operation, jobs.edge_id, jobs.status, jobs.attempts, jobs.last_error,
               jobs.next_attempt_at, jobs.created_at, jobs.updated_at, jobs.completed_at`,
    [input.limit]
  );
  return result.rows;
}

export async function markGraphProjectionJobFailed(client: DbClient, input: { job_id: string; error_message: string }): Promise<void> {
  await client.query(
    `UPDATE graph_projection_jobs
     SET status = 'failed',
         attempts = attempts + 1,
         last_error = $2,
         next_attempt_at = now() + (LEAST(attempts + 1, 10) * interval '1 minute'),
         updated_at = now()
     WHERE job_id = $1`,
    [input.job_id, input.error_message]
  );
}

export async function markGraphProjectionJobSucceeded(client: DbClient, jobId: string): Promise<void> {
  await client.query(
    `UPDATE graph_projection_jobs
     SET status = 'succeeded', updated_at = now(), completed_at = now()
     WHERE job_id = $1`,
    [jobId]
  );
}
