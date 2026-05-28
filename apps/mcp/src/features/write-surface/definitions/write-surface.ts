import type { ApiOperationHandlers } from "@supplystrata/api-orchestration";

export type McpWriteToolName = "start_research_session" | "run_source_check" | "confirm_research_session" | "review.approve" | "review.reject";
export type McpPendingActionToolName = Exclude<McpWriteToolName, "confirm_research_session">;
export type McpFactWritingToolName = "review.approve" | "review.reject";

export const MCP_WRITE_TOOL_NAMES: readonly McpWriteToolName[] = [
  "start_research_session",
  "run_source_check",
  "confirm_research_session",
  "review.approve",
  "review.reject"
];

export const MCP_FACT_WRITING_TOOL_NAMES: readonly McpFactWritingToolName[] = ["review.approve", "review.reject"];

export interface StartResearchSessionRequest {
  readonly company: string;
  readonly depth?: number;
  readonly source_target_namespace?: string;
  readonly enqueue_source_checks?: boolean;
  readonly reviewer?: string;
}

export interface RunSourceCheckRequest {
  readonly limit?: number;
  readonly check_target_ids?: readonly string[];
  readonly source_adapter_ids?: readonly string[];
  readonly reviewer?: string;
}

export interface ReviewDecisionWriteRequest {
  readonly review_id: string;
  readonly reviewer: string;
  readonly reason: string;
}

export interface ConfirmResearchSessionRequest {
  readonly pending_id: string;
  readonly confirmation_token: string;
}

export type PendingWriteAction =
  | {
      readonly tool_name: "start_research_session";
      readonly request: StartResearchSessionRequest;
      readonly summary_of_action: string;
    }
  | {
      readonly tool_name: "run_source_check";
      readonly request: RunSourceCheckRequest;
      readonly summary_of_action: string;
    }
  | {
      readonly tool_name: "review.approve";
      readonly request: ReviewDecisionWriteRequest;
      readonly summary_of_action: string;
    }
  | {
      readonly tool_name: "review.reject";
      readonly request: ReviewDecisionWriteRequest;
      readonly summary_of_action: string;
    };

export interface PendingWriteRecord {
  readonly pending_id: string;
  readonly confirmation_token: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly action: PendingWriteAction;
}

export interface PendingWriteStore {
  create(action: PendingWriteAction, now: string): PendingWriteRecord;
  consume(input: { pending_id: string; confirmation_token: string; tool_name: McpPendingActionToolName; now: string }): PendingWriteRecord | null;
}

export interface McpWriteExecutionContext {
  readonly now: string;
  readonly pending_id: string;
}

export interface McpWriteExecutors {
  readonly start_research_session: (request: StartResearchSessionRequest, context: McpWriteExecutionContext) => Promise<unknown>;
  readonly run_source_check: (request: RunSourceCheckRequest, context: McpWriteExecutionContext) => Promise<unknown>;
  readonly "review.approve": (request: ReviewDecisionWriteRequest, context: McpWriteExecutionContext) => Promise<unknown>;
  readonly "review.reject": (request: ReviewDecisionWriteRequest, context: McpWriteExecutionContext) => Promise<unknown>;
}

export interface McpWriteSurfaceRuntime {
  readonly handlers: ApiOperationHandlers;
  readonly now: () => string;
  readonly pendingWrites: PendingWriteStore;
  readonly writeExecutors: Partial<McpWriteExecutors>;
}

export type McpWriteToolStatus = "requires_confirmation" | "executed" | "invalid_token";

export interface McpWriteToolResult extends Readonly<Record<string, unknown>> {
  readonly status: McpWriteToolStatus;
  readonly pending_id?: string;
  readonly confirmation_token?: string;
  readonly summary_of_action: string;
  readonly data?: unknown;
}
