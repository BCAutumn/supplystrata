import {
  API_OPERATION_ROUTES,
  buildApiOperationEnvelope,
  type ApiOperationEnvelope,
  type ApiOperationHandlerInput,
  type ApiOperationHandlers,
  type ApiOperationId,
  type ApiPathParams,
  type ApiRouteContract
} from "@supplystrata/api-orchestration";

export interface McpApiReadOperationRequest {
  readonly operation_id: ApiOperationId;
  readonly path_params: ApiPathParams;
  readonly query?: URLSearchParams;
  readonly now: string;
}

export interface McpApiReadOperationInput extends McpApiReadOperationRequest {
  readonly handlers: ApiOperationHandlers;
}

export async function callMcpApiReadOperation(input: McpApiReadOperationInput): Promise<ApiOperationEnvelope<unknown>> {
  const route = findReadRoute(input.operation_id);
  const handler = input.handlers[input.operation_id];
  if (handler === undefined) throw new Error(`MCP read surface is missing api-orchestration handler: ${input.operation_id}`);

  const data = await handler(handlerInput(route, input));
  return buildApiOperationEnvelope(route, data, input.now);
}

function findReadRoute(operationId: ApiOperationId): ApiRouteContract {
  const route = API_OPERATION_ROUTES.find((candidate) => candidate.operation_id === operationId);
  if (route === undefined) throw new Error(`Unknown api-orchestration operation: ${operationId}`);
  if (route.access !== "read" && route.access !== "read_through_research")
    throw new Error(`MCP read surface cannot expose non-read api-orchestration operation: ${operationId}`);
  return route;
}

function handlerInput(route: ApiRouteContract, input: McpApiReadOperationInput): ApiOperationHandlerInput {
  return {
    route,
    path_params: input.path_params,
    query: input.query ?? new URLSearchParams(),
    body: undefined,
    now: input.now
  };
}
