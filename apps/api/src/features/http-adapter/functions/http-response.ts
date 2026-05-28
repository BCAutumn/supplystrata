import { API_CONTRACT_VERSION, API_SCHEMA_VERSION, type ApiRouteContract } from "../../api-contract/definitions/api-contract.js";
import { buildApiOpenApiDocument } from "../../api-contract/functions/openapi.js";
import type { ApiHttpResponse } from "../definitions/http-adapter.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

export function openApiHttpResponse(): ApiHttpResponse {
  return { status: 200, headers: { ...JSON_HEADERS }, body: buildApiOpenApiDocument() };
}

export function routeDataHttpResponse(route: ApiRouteContract, data: unknown, now: string): ApiHttpResponse {
  if (route.access === "read") {
    return {
      status: 200,
      headers: { ...JSON_HEADERS },
      body: {
        schema_version: API_SCHEMA_VERSION,
        contract_version: API_CONTRACT_VERSION,
        data,
        meta: { generated_at: now, read_policy: route.read_policy }
      }
    };
  }

  if (route.access === "read_through_research") {
    return {
      status: 200,
      headers: { ...JSON_HEADERS },
      body: {
        schema_version: API_SCHEMA_VERSION,
        contract_version: API_CONTRACT_VERSION,
        data,
        meta: { generated_at: now, research_policy: route.read_through_policy }
      }
    };
  }

  return {
    status: 200,
    headers: { ...JSON_HEADERS },
    body: {
      schema_version: API_SCHEMA_VERSION,
      contract_version: API_CONTRACT_VERSION,
      data,
      meta: { accepted_at: now, write_policy: route.write_policy }
    }
  };
}

export function errorHttpResponse(status: number, message: string): ApiHttpResponse {
  return {
    status,
    headers: { ...JSON_HEADERS },
    body: {
      error: {
        message,
        status
      }
    }
  };
}
