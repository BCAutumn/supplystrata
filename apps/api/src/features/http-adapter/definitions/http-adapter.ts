import type { ApiOperationId, ApiRouteContract } from "../../api-contract/definitions/api-contract.js";

export interface ApiHttpRequest {
  method: string;
  url: string;
  body?: unknown;
}

export interface ApiHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export type ApiPathParams = Record<string, string>;

export interface ApiRouteMatch {
  route: ApiRouteContract;
  path_params: ApiPathParams;
  query: URLSearchParams;
}

export interface ApiOperationHandlerInput {
  route: ApiRouteContract;
  path_params: ApiPathParams;
  query: URLSearchParams;
  body: unknown;
  now: string;
}

export type ApiOperationHandler = (input: ApiOperationHandlerInput) => Promise<unknown>;
export type ApiOperationHandlers = Partial<Record<ApiOperationId, ApiOperationHandler>>;

export interface ApiHttpAdapterOptions {
  now?: () => string;
}

export class ApiHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
