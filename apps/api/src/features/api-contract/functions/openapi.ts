import {
  API_CONTRACT_VERSION,
  API_OPENAPI_VERSION,
  API_ROUTES,
  type ApiPrimitiveSchema,
  type ApiRouteContract,
  type ApiRouteParameter,
  type ApiSchemaId
} from "../definitions/api-contract.js";
import { API_SCHEMA_REGISTRY, type ApiJsonSchema } from "../definitions/schema-registry.js";

export interface ApiOpenApiDocument {
  openapi: typeof API_OPENAPI_VERSION;
  info: {
    title: "SupplyStrata API";
    version: typeof API_CONTRACT_VERSION;
    description: string;
  };
  paths: Record<string, ApiOpenApiPathItem>;
  components: {
    schemas: Record<ApiSchemaId, ApiJsonSchema>;
  };
}

export type ApiOpenApiPathItem = Partial<Record<Lowercase<ApiRouteContract["method"]>, ApiOpenApiOperation>>;

export interface ApiOpenApiOperation {
  operationId: string;
  description: string;
  parameters: ApiOpenApiParameter[];
  requestBody?: {
    required: true;
    content: {
      "application/json": {
        schema: ApiOpenApiSchemaRef;
      };
    };
  };
  responses: {
    "200": {
      description: string;
      content: {
        "application/json": {
          schema: ApiOpenApiSchemaRef;
        };
      };
    };
  };
  "x-supplystrata": {
    access: ApiRouteContract["access"];
    stability: ApiRouteContract["stability"];
    handler_status: ApiRouteContract["handler_status"];
    read_policy?: ApiRouteContract["read_policy"];
    write_policy?: ApiRouteContract["write_policy"];
    dto_source_package: ApiRouteContract["dto_contract"]["source_package"];
    dto_source_type: string;
  };
}

export interface ApiOpenApiParameter {
  name: string;
  in: ApiRouteParameter["in"];
  required: boolean;
  description: string;
  schema: ApiPrimitiveSchema;
}

export interface ApiOpenApiSchemaRef {
  $ref: `#/components/schemas/${ApiSchemaId}`;
}

export function buildApiOpenApiDocument(routes: readonly ApiRouteContract[] = API_ROUTES): ApiOpenApiDocument {
  const paths: Record<string, ApiOpenApiPathItem> = {};
  for (const route of routes) {
    const path = toOpenApiPath(route.path);
    const method = route.method.toLowerCase() as Lowercase<ApiRouteContract["method"]>;
    paths[path] = { ...paths[path], [method]: toOpenApiOperation(route) };
  }
  return {
    openapi: API_OPENAPI_VERSION,
    info: {
      title: "SupplyStrata API",
      version: API_CONTRACT_VERSION,
      description:
        "Versioned contract for read-only supply-chain intelligence DTOs and review-state mutations. This document is contract-only until an HTTP adapter is attached."
    },
    paths,
    components: {
      schemas: API_SCHEMA_REGISTRY
    }
  };
}

export function toOpenApiPath(path: ApiRouteContract["path"]): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function toOpenApiOperation(route: ApiRouteContract): ApiOpenApiOperation {
  const operation: ApiOpenApiOperation = {
    operationId: route.operation_id,
    description: route.description,
    parameters: route.parameters.map((parameter) => ({ ...parameter })),
    responses: {
      "200": {
        description: "Successful response.",
        content: {
          "application/json": {
            schema: schemaRef(route.response_schema_id)
          }
        }
      }
    },
    "x-supplystrata": {
      access: route.access,
      stability: route.stability,
      handler_status: route.handler_status,
      read_policy: route.read_policy,
      write_policy: route.write_policy,
      dto_source_package: route.dto_contract.source_package,
      dto_source_type: route.dto_contract.source_type
    }
  };

  if (route.request_schema_id !== undefined) {
    operation.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: schemaRef(route.request_schema_id)
        }
      }
    };
  }
  return operation;
}

function schemaRef(schemaId: ApiSchemaId): ApiOpenApiSchemaRef {
  return { $ref: `#/components/schemas/${schemaId}` };
}
