import type pg from "pg";
import type { AiAnalysisNodeId, AiAnalysisProvider, AiAnalysisRunStatus, AiAnalysisScopeKind } from "./definitions.js";

export interface AiAnalysisRunStatusRow extends pg.QueryResultRow {
  run_id: string;
  node_id: AiAnalysisNodeId;
  scope_kind: AiAnalysisScopeKind;
  scope_id: string;
  status: AiAnalysisRunStatus;
  provider: AiAnalysisProvider;
  model: string | null;
  provider_request_id: string | null;
  input_refs: string[];
  guardrail_refs: string[];
  cannot_conclude: string[];
  prompt_sha256: string | null;
  output_sha256: string | null;
  output_summary: string | null;
  error_message: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  updated_at: Date | string;
}
