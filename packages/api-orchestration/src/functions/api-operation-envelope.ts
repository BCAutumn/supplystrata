import { API_CONTRACT_VERSION, API_SCHEMA_VERSION, type ApiRouteContract } from "../api-contract/definitions/api-contract.js";
import type { ApiReadEnvelope, ApiReadThroughResearchEnvelope, ApiWriteEnvelope } from "../api-contract/definitions/api-dtos.js";

export type ApiOperationEnvelope<TData> = ApiReadEnvelope<TData> | ApiReadThroughResearchEnvelope<TData> | ApiWriteEnvelope<TData>;

export function buildApiOperationEnvelope<TData>(route: ApiRouteContract, data: TData, now: string): ApiOperationEnvelope<TData> {
  if (route.access === "read") {
    if (route.read_policy === undefined) throw new Error(`API read route is missing read_policy: ${route.operation_id}`);
    return {
      schema_version: API_SCHEMA_VERSION,
      contract_version: API_CONTRACT_VERSION,
      data,
      meta: { generated_at: now, read_policy: route.read_policy }
    };
  }

  if (route.access === "read_through_research") {
    if (route.read_through_policy === undefined) throw new Error(`API read-through route is missing read_through_policy: ${route.operation_id}`);
    return {
      schema_version: API_SCHEMA_VERSION,
      contract_version: API_CONTRACT_VERSION,
      data,
      meta: { generated_at: now, research_policy: route.read_through_policy }
    };
  }

  if (route.write_policy === undefined) throw new Error(`API write route is missing write_policy: ${route.operation_id}`);
  return {
    schema_version: API_SCHEMA_VERSION,
    contract_version: API_CONTRACT_VERSION,
    data,
    meta: { accepted_at: now, write_policy: route.write_policy }
  };
}
