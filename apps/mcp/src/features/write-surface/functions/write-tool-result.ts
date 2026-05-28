import { z } from "zod";

import type { McpWriteToolResult, PendingWriteRecord } from "../definitions/write-surface.js";

export const MCP_WRITE_TOOL_OUTPUT_SCHEMA = {
  status: z.enum(["requires_confirmation", "executed", "invalid_token"]),
  pending_id: z.string().optional(),
  confirmation_token: z.string().optional(),
  summary_of_action: z.string(),
  data: z.unknown().optional()
};

export function requiresConfirmationResult(record: PendingWriteRecord): McpWriteToolResult {
  return {
    status: "requires_confirmation",
    pending_id: record.pending_id,
    confirmation_token: record.confirmation_token,
    summary_of_action: record.action.summary_of_action
  };
}

export function invalidTokenResult(summary: string): McpWriteToolResult {
  return {
    status: "invalid_token",
    summary_of_action: summary
  };
}

export function executedResult(input: { pending_id: string; summary_of_action: string; data: unknown }): McpWriteToolResult {
  return {
    status: "executed",
    pending_id: input.pending_id,
    summary_of_action: input.summary_of_action,
    data: input.data
  };
}

export function writeToolText(result: McpWriteToolResult): string {
  return JSON.stringify(result, null, 2);
}
