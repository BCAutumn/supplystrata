import type { ApiOperationId, ApiRouteContract } from "../api-contract/definitions/api-contract.js";

export type ApiPathParams = Record<string, string>;

export interface ApiOperationHandlerInput {
  route: ApiRouteContract;
  path_params: ApiPathParams;
  query: URLSearchParams;
  body: unknown;
  now: string;
}

export type ApiOperationHandler = (input: ApiOperationHandlerInput) => Promise<unknown>;
export type ApiOperationHandlers = Partial<Record<ApiOperationId, ApiOperationHandler>>;

export class ApiHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
