import type { ApiPathParams, ApiRouteContract } from "@supplystrata/api-orchestration";

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

export interface ApiRouteMatch {
  route: ApiRouteContract;
  path_params: ApiPathParams;
  query: URLSearchParams;
}

export interface ApiHttpAdapterOptions {
  now?: () => string;
}
