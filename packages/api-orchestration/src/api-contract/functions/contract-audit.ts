import type { ApiRouteContract } from "../definitions/api-contract.js";
import { API_ROUTES } from "../definitions/api-contract.js";
import { API_SCHEMA_REGISTRY } from "../definitions/schema-registry.js";

export interface ApiContractAuditResult {
  route_count: number;
  schema_count: number;
  db_row_leak_count: number;
  missing_schema_ids: string[];
}

export function auditApiContract(routes: readonly ApiRouteContract[] = API_ROUTES): ApiContractAuditResult {
  const missingSchemaIds = routes
    .flatMap((route) => [route.request_schema_id, route.response_schema_id])
    .filter((schemaId): schemaId is NonNullable<typeof schemaId> => schemaId !== undefined)
    .filter((schemaId) => !(schemaId in API_SCHEMA_REGISTRY))
    .sort();
  const dbRowLeaks = routes.filter(
    (route) => route.dto_contract.source_package === "@supplystrata/db" || /\b(row|dbrow|queryresultrow)\b/i.test(route.dto_contract.source_type)
  );

  return {
    route_count: routes.length,
    schema_count: Object.keys(API_SCHEMA_REGISTRY).length,
    db_row_leak_count: dbRowLeaks.length,
    missing_schema_ids: missingSchemaIds
  };
}
