import type { DbClient } from "@supplystrata/db/write";
import type {
  AiAnalysisNodeId,
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

function toNullableIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return toIso(value);
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
