import {
  API_ROUTES,
  buildApiOperationEnvelope,
  type ApiOperationHandlerInput,
  type ApiOperationHandlers,
  type ApiOperationId,
  type ApiRouteContract
} from "@supplystrata/api-orchestration";

import type { McpWriteExecutors, ReviewDecisionWriteRequest, RunSourceCheckRequest, StartResearchSessionRequest } from "../definitions/write-surface.js";

export function createApiBackedWriteExecutors(handlers: ApiOperationHandlers): Partial<McpWriteExecutors> {
  return {
    start_research_session: async (request, context) =>
      callApiWriteOperation(handlers, "createCompanyResearchRun", {
        path_params: { id: request.company },
        body: researchSessionBody(request),
        now: context.now
      }),
    "review.approve": async (request, context) =>
      callApiWriteOperation(handlers, "approveReviewCandidate", {
        path_params: { id: request.review_id },
        body: reviewDecisionBody(request),
        now: context.now
      }),
    "review.reject": async (request, context) =>
      callApiWriteOperation(handlers, "rejectReviewCandidate", {
        path_params: { id: request.review_id },
        body: reviewDecisionBody(request),
        now: context.now
      })
  };
}

function researchSessionBody(request: StartResearchSessionRequest): Record<string, unknown> {
  return {
    ...(request.depth === undefined ? {} : { depth: request.depth }),
    ...(request.source_target_namespace === undefined ? {} : { source_target_namespace: request.source_target_namespace }),
    ...(request.enqueue_source_checks === undefined ? {} : { enqueue_source_checks: request.enqueue_source_checks }),
    ...(request.reviewer === undefined ? {} : { reviewer: request.reviewer })
  };
}

function reviewDecisionBody(request: ReviewDecisionWriteRequest): Record<string, unknown> {
  return {
    reviewer: request.reviewer,
    reason: `via=mcp-tool ${request.reason}`
  };
}

async function callApiWriteOperation(
  handlers: ApiOperationHandlers,
  operationId: ApiOperationId,
  input: Omit<ApiOperationHandlerInput, "route" | "query">
): Promise<unknown> {
  const route = findWriteRoute(operationId);
  const handler = handlers[operationId];
  if (handler === undefined) throw new Error(`MCP write surface is missing api-orchestration handler: ${operationId}`);
  const data = await handler({
    route,
    path_params: input.path_params,
    query: new URLSearchParams(),
    body: input.body,
    now: input.now
  });
  return buildApiOperationEnvelope(route, data, input.now);
}

function findWriteRoute(operationId: ApiOperationId): ApiRouteContract {
  const route = API_ROUTES.find((candidate) => candidate.operation_id === operationId);
  if (route === undefined) throw new Error(`Unknown api-orchestration operation: ${operationId}`);
  if (route.access !== "review_write" && route.access !== "workflow_write")
    throw new Error(`MCP write surface cannot execute non-write api-orchestration operation: ${operationId}`);
  return route;
}
