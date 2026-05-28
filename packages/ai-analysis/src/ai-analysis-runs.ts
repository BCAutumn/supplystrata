import { createHash } from "node:crypto";
import type { DbClient } from "@supplystrata/db/write";
import type {
  AiAnalysisArtifact,
  AiAnalysisNodePlan,
  AiAnalysisNodeId,
  AiAnalysisPlan,
  AiAnalysisRunStatus,
  AiAnalysisRunStatusItem,
  AiAnalysisRunStatusReport,
  AiAnalysisRunStatusSummary,
  AiAnalysisScopeKind
} from "./definitions.js";
import { AI_ANALYSIS_SCHEMA_VERSION } from "./definitions.js";
import type { AiAnalysisRunStatusRow } from "./db-rows.js";

export interface ListAiAnalysisRunsInput {
  generated_at: string;
  limit: number;
  statuses?: readonly AiAnalysisRunStatus[];
  node_ids?: readonly AiAnalysisNodeId[];
  scope_kind?: AiAnalysisScopeKind;
  scope_id?: string;
}

export interface RecordAiAnalysisRunInput {
  plan: AiAnalysisPlan;
  artifact: AiAnalysisArtifact;
  recorded_at: string;
  error_message?: string;
}

export async function listAiAnalysisRuns(client: DbClient, input: ListAiAnalysisRunsInput): Promise<AiAnalysisRunStatusReport> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (input.statuses !== undefined && input.statuses.length > 0) {
    params.push([...new Set(input.statuses)].sort());
    where.push(`status = ANY($${params.length}::text[])`);
  }
  if (input.node_ids !== undefined && input.node_ids.length > 0) {
    params.push([...new Set(input.node_ids)].sort());
    where.push(`node_id = ANY($${params.length}::text[])`);
  }
  if (input.scope_kind !== undefined) {
    params.push(input.scope_kind);
    where.push(`scope_kind = $${params.length}`);
  }
  if (input.scope_id !== undefined) {
    params.push(input.scope_id);
    where.push(`scope_id = $${params.length}`);
  }
  params.push(input.limit);

  const result = await client.query<AiAnalysisRunStatusRow>(
    `SELECT run_id, node_id, scope_kind, scope_id, status, provider, model, provider_request_id,
            input_refs, guardrail_refs, cannot_conclude, prompt_sha256, output_sha256,
            output_summary, error_message, created_at, started_at, completed_at, updated_at
     FROM ai_analysis_runs
     ${where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`}
     ORDER BY created_at DESC, run_id
     LIMIT $${params.length}`,
    params
  );
  const runs = result.rows.map(runStatusItemFromRow);
  return {
    schema_version: AI_ANALYSIS_SCHEMA_VERSION,
    generated_at: input.generated_at,
    summary: summarizeRuns(runs),
    runs,
    policy: {
      read_policy: "read_only_ai_analysis_status",
      fact_mutation_allowed: false,
      agent_behavior_allowed: false
    }
  };
}

export async function recordAiAnalysisRun(client: DbClient, input: RecordAiAnalysisRunInput): Promise<AiAnalysisRunStatusItem> {
  const node = nodeForArtifact(input.plan, input.artifact.node_id);
  const runId = aiAnalysisRunId(input.artifact);
  const promptSha256 = sha256Json(input.artifact.model_metadata);
  const outputSha256 = sha256Json(input.artifact);
  const metadata = {
    mode: input.artifact.mode,
    policy: input.artifact.policy,
    output_schema_id: input.artifact.model_metadata.output_schema_id,
    simulated: input.artifact.model_metadata.simulated,
    quality_lift: input.artifact.quality_lift
  };
  const result = await client.query<AiAnalysisRunStatusRow>(
    `INSERT INTO ai_analysis_runs (
       run_id, node_id, scope_kind, scope_id, status, provider, model, provider_request_id,
       input_refs, guardrail_refs, cannot_conclude, prompt_sha256, output_sha256,
       output_summary, error_message, metadata, created_at, started_at, completed_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9::text[], $10::text[], $11::text[], $12, $13,
       $14, $15, $16::jsonb, $17::timestamptz, $17::timestamptz, $17::timestamptz, $17::timestamptz
     )
     ON CONFLICT (run_id) DO UPDATE SET
       status = EXCLUDED.status,
       provider = EXCLUDED.provider,
       model = EXCLUDED.model,
       provider_request_id = EXCLUDED.provider_request_id,
       input_refs = EXCLUDED.input_refs,
       guardrail_refs = EXCLUDED.guardrail_refs,
       cannot_conclude = EXCLUDED.cannot_conclude,
       prompt_sha256 = EXCLUDED.prompt_sha256,
       output_sha256 = EXCLUDED.output_sha256,
       output_summary = EXCLUDED.output_summary,
       error_message = EXCLUDED.error_message,
       metadata = EXCLUDED.metadata,
       started_at = EXCLUDED.started_at,
       completed_at = EXCLUDED.completed_at,
       updated_at = EXCLUDED.updated_at
     RETURNING run_id, node_id, scope_kind, scope_id, status, provider, model, provider_request_id,
               input_refs, guardrail_refs, cannot_conclude, prompt_sha256, output_sha256,
               output_summary, error_message, created_at, started_at, completed_at, updated_at`,
    [
      runId,
      input.artifact.node_id,
      input.plan.scope_kind,
      input.artifact.scope_id,
      artifactRunStatus(input.artifact.status),
      input.artifact.provider,
      input.artifact.model,
      input.artifact.model_metadata.provider_request_id,
      input.artifact.model_metadata.input_refs,
      node.guardrails,
      [...node.cannot_conclude, ...input.artifact.cannot_conclude],
      promptSha256,
      outputSha256,
      input.artifact.headline,
      input.error_message ?? null,
      JSON.stringify(metadata),
      input.recorded_at
    ]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Failed to record AI analysis run: ${runId}`);
  return runStatusItemFromRow(row);
}

function runStatusItemFromRow(row: AiAnalysisRunStatusRow): AiAnalysisRunStatusItem {
  return {
    run_id: row.run_id,
    node_id: row.node_id,
    scope_kind: row.scope_kind,
    scope_id: row.scope_id,
    status: row.status,
    provider: row.provider,
    model: row.model,
    provider_request_id: row.provider_request_id,
    input_refs: [...row.input_refs],
    guardrail_refs: [...row.guardrail_refs],
    cannot_conclude: [...row.cannot_conclude],
    prompt_sha256: row.prompt_sha256,
    output_sha256: row.output_sha256,
    output_summary: row.output_summary,
    error_message: row.error_message,
    created_at: toIso(row.created_at),
    started_at: toNullableIso(row.started_at),
    completed_at: toNullableIso(row.completed_at),
    updated_at: toIso(row.updated_at)
  };
}

function summarizeRuns(runs: readonly AiAnalysisRunStatusItem[]): AiAnalysisRunStatusSummary {
  return {
    total: runs.length,
    queued: countStatus(runs, "queued"),
    in_progress: countStatus(runs, "in_progress"),
    succeeded: countStatus(runs, "succeeded"),
    failed: countStatus(runs, "failed"),
    blocked_missing_configuration: countStatus(runs, "blocked_missing_configuration"),
    cannot_conclude: countStatus(runs, "cannot_conclude")
  };
}

function countStatus(runs: readonly AiAnalysisRunStatusItem[], status: AiAnalysisRunStatus): number {
  return runs.filter((run) => run.status === status).length;
}

function nodeForArtifact(plan: AiAnalysisPlan, nodeId: AiAnalysisNodeId): AiAnalysisNodePlan {
  const node = plan.nodes.find((item) => item.node_id === nodeId);
  if (node === undefined) throw new Error(`AI analysis plan does not contain node: ${nodeId}`);
  return node;
}

function artifactRunStatus(status: AiAnalysisArtifact["status"]): AiAnalysisRunStatus {
  return status;
}

function aiAnalysisRunId(artifact: AiAnalysisArtifact): string {
  return `AIR-${sha256Json({
    node_id: artifact.node_id,
    scope_id: artifact.scope_id,
    generated_at: artifact.generated_at,
    mode: artifact.mode,
    provider: artifact.provider,
    provider_request_id: artifact.model_metadata.provider_request_id
  })
    .slice(0, 20)
    .toUpperCase()}`;
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function toNullableIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return toIso(value);
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
