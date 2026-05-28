import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type {
  McpPendingActionToolName,
  McpWriteSurfaceRuntime,
  McpWriteToolResult,
  PendingWriteAction,
  ReviewDecisionWriteRequest
} from "../definitions/write-surface.js";
import { executedResult, invalidTokenResult, MCP_WRITE_TOOL_OUTPUT_SCHEMA, requiresConfirmationResult, writeToolText } from "../functions/write-tool-result.js";

const stringInput = (description: string) => z.string().trim().min(1).describe(description);
const positiveIntegerInput = (description: string) => z.number().int().min(1).describe(description);
const stringListInput = (description: string) => z.array(z.string().trim().min(1)).min(1).describe(description);
const pendingIdInput = stringInput("Pending write id returned by the first write-tool call.");
const confirmationTokenInput = stringInput("Single-use server-side confirmation token returned by the first write-tool call.");

export function registerWriteTools(server: McpServer, runtime: McpWriteSurfaceRuntime): void {
  server.registerTool(
    "start_research_session",
    {
      title: "Start Research Session",
      description: "Creates a pending research-session request. Confirm it before any research run or source-check queue mutation occurs.",
      inputSchema: {
        company: stringInput("Company query, ticker, alias, or entity id."),
        depth: positiveIntegerInput("Research traversal depth.").optional(),
        source_target_namespace: stringInput("Optional namespace for stable source-check target ids.").optional(),
        enqueue_source_checks: z.boolean().describe("Whether confirmation may enqueue source-check jobs.").optional(),
        reviewer: stringInput("Optional host-app actor id.").optional()
      },
      outputSchema: MCP_WRITE_TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (request) =>
      pendingWriteToolResult(runtime, {
        tool_name: "start_research_session",
        request: startResearchSessionRequest(request),
        summary_of_action: `Start a research session for ${request.company}.`
      })
  );

  server.registerTool(
    "confirm_research_session",
    {
      title: "Confirm Research Session",
      description: "Confirms and executes a pending research-session request.",
      inputSchema: {
        pending_id: pendingIdInput,
        confirmation_token: confirmationTokenInput
      },
      outputSchema: MCP_WRITE_TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ pending_id, confirmation_token }) => executePendingWriteTool(runtime, "start_research_session", pending_id, confirmation_token)
  );

  server.registerTool(
    "run_source_check",
    {
      title: "Run Source Check",
      description: "Creates a pending source-check run request. Confirmation is required before source jobs or observations can be written.",
      inputSchema: {
        limit: positiveIntegerInput("Maximum due source checks to run.").optional(),
        check_target_ids: stringListInput("Optional source-check target ids.").optional(),
        source_adapter_ids: stringListInput("Optional source adapter ids.").optional(),
        reviewer: stringInput("Optional host-app actor id.").optional(),
        pending_id: pendingIdInput.optional(),
        confirmation_token: confirmationTokenInput.optional()
      },
      outputSchema: MCP_WRITE_TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ pending_id, confirmation_token, ...request }) =>
      pending_id === undefined && confirmation_token === undefined
        ? pendingWriteToolResult(runtime, {
            tool_name: "run_source_check",
            request: runSourceCheckRequest(request),
            summary_of_action: "Run due source checks and append source-check observations."
          })
        : executePendingWriteTool(runtime, "run_source_check", pending_id, confirmation_token)
  );

  server.registerTool(
    "review.approve",
    {
      title: "Approve Review Candidate",
      description: "Creates or confirms a pending review approval. Confirmation is required before review state or fact-layer promotion can occur.",
      inputSchema: reviewDecisionInputSchema(),
      outputSchema: MCP_WRITE_TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ pending_id, confirmation_token, ...request }) =>
      pending_id === undefined && confirmation_token === undefined
        ? pendingReviewDecisionToolResult(runtime, "review.approve", request)
        : executePendingWriteTool(runtime, "review.approve", pending_id, confirmation_token)
  );

  server.registerTool(
    "review.reject",
    {
      title: "Reject Review Candidate",
      description: "Creates or confirms a pending review rejection. Confirmation is required before terminal review state changes occur.",
      inputSchema: reviewDecisionInputSchema(),
      outputSchema: MCP_WRITE_TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ pending_id, confirmation_token, ...request }) =>
      pending_id === undefined && confirmation_token === undefined
        ? pendingReviewDecisionToolResult(runtime, "review.reject", request)
        : executePendingWriteTool(runtime, "review.reject", pending_id, confirmation_token)
  );
}

function reviewDecisionInputSchema() {
  return {
    review_id: stringInput("Review candidate id. Required on the first call; omitted when confirming an existing pending write.").optional(),
    reviewer: stringInput("Stable reviewer or host-app actor id. Required on the first call; omitted when confirming an existing pending write.").optional(),
    reason: stringInput("Human-readable decision rationale. Required on the first call; omitted when confirming an existing pending write.").optional(),
    pending_id: pendingIdInput.optional(),
    confirmation_token: confirmationTokenInput.optional()
  };
}

async function pendingWriteToolResult(runtime: McpWriteSurfaceRuntime, action: PendingWriteAction) {
  const now = runtime.now();
  const record = runtime.pendingWrites.create(action, now);
  return writeResult(requiresConfirmationResult(record));
}

async function pendingReviewDecisionToolResult(
  runtime: McpWriteSurfaceRuntime,
  toolName: "review.approve" | "review.reject",
  input: { review_id?: string | undefined; reviewer?: string | undefined; reason?: string | undefined }
) {
  const request = reviewDecisionRequest(input);
  if (toolName === "review.approve") {
    return pendingWriteToolResult(runtime, {
      tool_name: "review.approve",
      request,
      summary_of_action: `Approve review candidate ${request.review_id}.`
    });
  }
  return pendingWriteToolResult(runtime, {
    tool_name: "review.reject",
    request,
    summary_of_action: `Reject review candidate ${request.review_id}.`
  });
}

async function executePendingWriteTool(
  runtime: McpWriteSurfaceRuntime,
  toolName: McpPendingActionToolName,
  pendingId: string | undefined,
  confirmationToken: string | undefined
) {
  if (pendingId === undefined || confirmationToken === undefined) return writeResult(invalidTokenResult(`Invalid confirmation token for ${toolName}.`));
  const now = runtime.now();
  const record = runtime.pendingWrites.consume({
    pending_id: pendingId,
    confirmation_token: confirmationToken,
    tool_name: toolName,
    now
  });
  if (record === null) return writeResult(invalidTokenResult(`Invalid confirmation token for ${toolName}.`));

  const data = await executePendingAction(runtime, record.action, record.pending_id, now);
  return writeResult(
    executedResult({
      pending_id: record.pending_id,
      summary_of_action: record.action.summary_of_action,
      data
    })
  );
}

async function executePendingAction(runtime: McpWriteSurfaceRuntime, action: PendingWriteAction, pendingId: string, now: string): Promise<unknown> {
  const context = { now, pending_id: pendingId };
  switch (action.tool_name) {
    case "start_research_session": {
      const executor = runtime.writeExecutors.start_research_session;
      if (executor === undefined) throw new Error("MCP write surface is missing executor: start_research_session");
      return executor(action.request, context);
    }
    case "run_source_check": {
      const executor = runtime.writeExecutors.run_source_check;
      if (executor === undefined) throw new Error("MCP write surface is missing executor: run_source_check");
      return executor(action.request, context);
    }
    case "review.approve": {
      const executor = runtime.writeExecutors["review.approve"];
      if (executor === undefined) throw new Error("MCP write surface is missing executor: review.approve");
      return executor(action.request, context);
    }
    case "review.reject": {
      const executor = runtime.writeExecutors["review.reject"];
      if (executor === undefined) throw new Error("MCP write surface is missing executor: review.reject");
      return executor(action.request, context);
    }
  }
}

function startResearchSessionRequest(input: {
  company: string;
  depth?: number | undefined;
  source_target_namespace?: string | undefined;
  enqueue_source_checks?: boolean | undefined;
  reviewer?: string | undefined;
}) {
  return {
    company: input.company,
    ...(input.depth === undefined ? {} : { depth: input.depth }),
    ...(input.source_target_namespace === undefined ? {} : { source_target_namespace: input.source_target_namespace }),
    ...(input.enqueue_source_checks === undefined ? {} : { enqueue_source_checks: input.enqueue_source_checks }),
    ...(input.reviewer === undefined ? {} : { reviewer: input.reviewer })
  };
}

function runSourceCheckRequest(input: {
  limit?: number | undefined;
  check_target_ids?: string[] | undefined;
  source_adapter_ids?: string[] | undefined;
  reviewer?: string | undefined;
}) {
  return {
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.check_target_ids === undefined ? {} : { check_target_ids: input.check_target_ids }),
    ...(input.source_adapter_ids === undefined ? {} : { source_adapter_ids: input.source_adapter_ids }),
    ...(input.reviewer === undefined ? {} : { reviewer: input.reviewer })
  };
}

function reviewDecisionRequest(input: {
  review_id?: string | undefined;
  reviewer?: string | undefined;
  reason?: string | undefined;
}): ReviewDecisionWriteRequest {
  const reviewId = input.review_id;
  const reviewer = input.reviewer;
  const reason = input.reason;
  if (reviewId === undefined || reviewer === undefined || reason === undefined) {
    const missingFields: string[] = [];
    if (reviewId === undefined) missingFields.push("review_id");
    if (reviewer === undefined) missingFields.push("reviewer");
    if (reason === undefined) missingFields.push("reason");
    throw new Error(`MCP review decision requires ${missingFields.join(", ")} before confirmation.`);
  }
  return {
    review_id: reviewId,
    reviewer,
    reason
  };
}

function writeResult(result: McpWriteToolResult) {
  return {
    content: [
      {
        type: "text" as const,
        text: writeToolText(result)
      }
    ],
    structuredContent: result
  };
}
