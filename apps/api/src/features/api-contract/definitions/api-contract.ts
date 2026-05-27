import type { ApiReviewWritePolicy, ApiReadPolicy } from "./api-dtos.js";

export const API_CONTRACT_VERSION = "0.1.0" as const;
export const API_SCHEMA_VERSION = "1.0.0" as const;
export const API_OPENAPI_VERSION = "3.1.0" as const;

export type ApiRouteMethod = "GET" | "POST";
export type ApiRouteStability = "v0_contract";
export type ApiHandlerStatus = "contract_only";
export type ApiRouteAccess = "read" | "review_write";

export interface ApiRouteParameter {
  name: string;
  in: "path" | "query";
  required: boolean;
  schema: ApiPrimitiveSchema;
  description: string;
}

export interface ApiPrimitiveSchema {
  type: "string" | "integer" | "boolean";
  minimum?: number;
  default?: string | number | boolean;
}

export interface ApiDtoContract {
  schema_id: ApiSchemaId;
  source_package: ApiDtoSourcePackage;
  source_type: string;
  source_kind: "public_dto" | "api_envelope";
  notes: string;
}

export type ApiDtoSourcePackage =
  | "@supplystrata/render"
  | "@supplystrata/chain-view"
  | "@supplystrata/workbench-export"
  | "@supplystrata/research-pack"
  | "@supplystrata/api"
  | "@supplystrata/db";

export type ApiSchemaId =
  | "CompanyCardApiResponse"
  | "ComponentCardApiResponse"
  | "ChainApiResponse"
  | "ClaimApiResponse"
  | "EvidenceApiResponse"
  | "ObservationsApiResponse"
  | "RiskViewApiResponse"
  | "ChangesApiResponse"
  | "SourcesHealthApiResponse"
  | "UnknownMapApiResponse"
  | "ConsumerReadModelApiResponse"
  | "ReasoningWalkthroughApiResponse"
  | "ReviewDecisionRequest"
  | "ReviewDecisionApiResponse";

export interface ApiRouteContract {
  method: ApiRouteMethod;
  path: ApiRoutePath;
  operation_id: string;
  access: ApiRouteAccess;
  stability: ApiRouteStability;
  handler_status: ApiHandlerStatus;
  read_policy?: ApiReadPolicy;
  write_policy?: ApiReviewWritePolicy;
  parameters: readonly ApiRouteParameter[];
  request_schema_id?: ApiSchemaId;
  response_schema_id: ApiSchemaId;
  dto_contract: ApiDtoContract;
  description: string;
}

export type ApiRoutePath =
  | "/companies/:id/card"
  | "/components/:id/card"
  | "/chains/:scope"
  | "/claims/:id"
  | "/evidence/:id"
  | "/observations/:scope"
  | "/risk-views/:scope"
  | "/changes"
  | "/sources/health"
  | "/unknowns/:scope"
  | "/companies/:id/consumer-read-model"
  | "/companies/:id/reasoning-walkthrough"
  | "/review/:id/approve"
  | "/review/:id/reject";

const idPathParam = (name: string, description: string): ApiRouteParameter => ({
  name,
  in: "path",
  required: true,
  schema: { type: "string" },
  description
});

const limitQueryParam = (defaultValue: number): ApiRouteParameter => ({
  name: "limit",
  in: "query",
  required: false,
  schema: { type: "integer", minimum: 1, default: defaultValue },
  description: "Optional maximum number of records returned by the read endpoint."
});

const readRoute = (input: Omit<ApiRouteContract, "access" | "stability" | "handler_status" | "read_policy">): ApiRouteContract => ({
  ...input,
  access: "read",
  stability: "v0_contract",
  handler_status: "contract_only",
  read_policy: "read_only_no_truth_store_mutation"
});

const reviewRoute = (input: Omit<ApiRouteContract, "access" | "stability" | "handler_status" | "write_policy" | "request_schema_id">): ApiRouteContract => ({
  ...input,
  access: "review_write",
  stability: "v0_contract",
  handler_status: "contract_only",
  write_policy: "review_queue_mutation_only_no_fact_edge_write",
  request_schema_id: "ReviewDecisionRequest"
});

export const API_ROUTES = [
  readRoute({
    method: "GET",
    path: "/companies/:id/card",
    operation_id: "getCompanyCard",
    parameters: [idPathParam("id", "Company entity id or resolver-backed company query.")],
    response_schema_id: "CompanyCardApiResponse",
    dto_contract: {
      schema_id: "CompanyCardApiResponse",
      source_package: "@supplystrata/render",
      source_type: "CompanyCardModel",
      source_kind: "public_dto",
      notes: "CompanyCard is the stable public card DTO, not a persistence row."
    },
    description: "Return the evidence-backed company card for a resolved company."
  }),
  readRoute({
    method: "GET",
    path: "/components/:id/card",
    operation_id: "getComponentCard",
    parameters: [idPathParam("id", "Component id, name, or alias.")],
    response_schema_id: "ComponentCardApiResponse",
    dto_contract: {
      schema_id: "ComponentCardApiResponse",
      source_package: "@supplystrata/render",
      source_type: "ComponentCardModel",
      source_kind: "public_dto",
      notes: "ComponentCard carries component evidence, unknowns, observations, and derived risk context."
    },
    description: "Return the evidence-backed component card for a component scope."
  }),
  readRoute({
    method: "GET",
    path: "/chains/:scope",
    operation_id: "getChain",
    parameters: [
      idPathParam("scope", "Company, component, or future chain scope."),
      { name: "depth", in: "query", required: false, schema: { type: "integer", minimum: 1, default: 3 }, description: "Maximum traversal depth." }
    ],
    response_schema_id: "ChainApiResponse",
    dto_contract: {
      schema_id: "ChainApiResponse",
      source_package: "@supplystrata/chain-view",
      source_type: "ChainViewModel",
      source_kind: "public_dto",
      notes: "ChainView is the graph read model; fact/observation/lead layers stay explicit."
    },
    description: "Return a chain view for a supplied research scope."
  }),
  readRoute({
    method: "GET",
    path: "/claims/:id",
    operation_id: "getClaim",
    parameters: [idPathParam("id", "Claim id.")],
    response_schema_id: "ClaimApiResponse",
    dto_contract: {
      schema_id: "ClaimApiResponse",
      source_package: "@supplystrata/workbench-export",
      source_type: "WorkbenchClaim",
      source_kind: "public_dto",
      notes: "Claim DTO includes review, conflict, evidence refs, and lifecycle context."
    },
    description: "Return a claim DTO with evidence, unknown, conflict, and lifecycle context."
  }),
  readRoute({
    method: "GET",
    path: "/evidence/:id",
    operation_id: "getEvidence",
    parameters: [idPathParam("id", "Evidence id.")],
    response_schema_id: "EvidenceApiResponse",
    dto_contract: {
      schema_id: "EvidenceApiResponse",
      source_package: "@supplystrata/workbench-export",
      source_type: "WorkbenchEvidence",
      source_kind: "public_dto",
      notes: "Evidence DTO keeps citation trace fields explicit and avoids SELECT * row leakage."
    },
    description: "Return an evidence trace record for audit and citation review."
  }),
  readRoute({
    method: "GET",
    path: "/observations/:scope",
    operation_id: "listObservations",
    parameters: [idPathParam("scope", "Company, component, edge, or policy scope."), limitQueryParam(100)],
    response_schema_id: "ObservationsApiResponse",
    dto_contract: {
      schema_id: "ObservationsApiResponse",
      source_package: "@supplystrata/render",
      source_type: "CompanyObservation | ComponentObservation",
      source_kind: "public_dto",
      notes: "Observation DTOs remain separate from fact edges and are returned as read-only context."
    },
    description: "List typed observations for a scope without upgrading them into fact edges."
  }),
  readRoute({
    method: "GET",
    path: "/risk-views/:scope",
    operation_id: "getRiskView",
    parameters: [idPathParam("scope", "Component or future risk view scope.")],
    response_schema_id: "RiskViewApiResponse",
    dto_contract: {
      schema_id: "RiskViewApiResponse",
      source_package: "@supplystrata/render",
      source_type: "ComponentRiskView",
      source_kind: "public_dto",
      notes: "Risk view is a derived read model and must not be interpreted as evidence level."
    },
    description: "Return deterministic risk metrics for a component-oriented scope."
  }),
  readRoute({
    method: "GET",
    path: "/changes",
    operation_id: "listChanges",
    parameters: [
      limitQueryParam(100),
      { name: "since", in: "query", required: false, schema: { type: "string" }, description: "Optional ISO timestamp lower bound." }
    ],
    response_schema_id: "ChangesApiResponse",
    dto_contract: {
      schema_id: "ChangesApiResponse",
      source_package: "@supplystrata/workbench-export",
      source_type: "WorkbenchChangeTimelineItem[]",
      source_kind: "public_dto",
      notes: "Change timeline exposes graph/source/semantic/risk events through a stable DTO."
    },
    description: "List source, graph, semantic, and risk changes for monitoring views."
  }),
  readRoute({
    method: "GET",
    path: "/sources/health",
    operation_id: "listSourceHealth",
    parameters: [],
    response_schema_id: "SourcesHealthApiResponse",
    dto_contract: {
      schema_id: "SourcesHealthApiResponse",
      source_package: "@supplystrata/workbench-export",
      source_type: "WorkbenchSourceHealth[]",
      source_kind: "public_dto",
      notes: "Source health includes cadence and degraded status for future monitoring UIs."
    },
    description: "Return configured source health and monitor state."
  }),
  readRoute({
    method: "GET",
    path: "/unknowns/:scope",
    operation_id: "listUnknowns",
    parameters: [idPathParam("scope", "Company, component, edge, claim, or policy scope.")],
    response_schema_id: "UnknownMapApiResponse",
    dto_contract: {
      schema_id: "UnknownMapApiResponse",
      source_package: "@supplystrata/render",
      source_type: "UnknownMapModel",
      source_kind: "public_dto",
      notes: "Unknown map is a first-class API surface, not a missing-data side effect."
    },
    description: "Return explicit unknowns for a research scope."
  }),
  readRoute({
    method: "GET",
    path: "/companies/:id/consumer-read-model",
    operation_id: "getCompanyConsumerReadModel",
    parameters: [idPathParam("id", "Company entity id or resolver-backed company query.")],
    response_schema_id: "ConsumerReadModelApiResponse",
    dto_contract: {
      schema_id: "ConsumerReadModelApiResponse",
      source_package: "@supplystrata/research-pack",
      source_type: "ConsumerReadModel",
      source_kind: "public_dto",
      notes: "Gate 8-lite read model becomes a formal read endpoint contract."
    },
    description: "Return the Gate 8-lite consumer read model for a company research scope."
  }),
  readRoute({
    method: "GET",
    path: "/companies/:id/reasoning-walkthrough",
    operation_id: "getCompanyReasoningWalkthrough",
    parameters: [idPathParam("id", "Company entity id or resolver-backed company query.")],
    response_schema_id: "ReasoningWalkthroughApiResponse",
    dto_contract: {
      schema_id: "ReasoningWalkthroughApiResponse",
      source_package: "@supplystrata/research-pack",
      source_type: "ReasoningWalkthrough",
      source_kind: "public_dto",
      notes: "Reasoning walkthrough is deterministic/read-only/no-AI and lists what cannot be concluded."
    },
    description: "Return structured known facts, unknowns, constrained evidence, and next actions."
  }),
  reviewRoute({
    method: "POST",
    path: "/review/:id/approve",
    operation_id: "approveReviewCandidate",
    parameters: [idPathParam("id", "Review candidate id.")],
    response_schema_id: "ReviewDecisionApiResponse",
    dto_contract: {
      schema_id: "ReviewDecisionApiResponse",
      source_package: "@supplystrata/api",
      source_type: "ReviewDecisionResult",
      source_kind: "api_envelope",
      notes: "Approval endpoint mutates review state only; fact edge application remains a separate reviewed workflow."
    },
    description: "Approve a review candidate without directly writing fact edges."
  }),
  reviewRoute({
    method: "POST",
    path: "/review/:id/reject",
    operation_id: "rejectReviewCandidate",
    parameters: [idPathParam("id", "Review candidate id.")],
    response_schema_id: "ReviewDecisionApiResponse",
    dto_contract: {
      schema_id: "ReviewDecisionApiResponse",
      source_package: "@supplystrata/api",
      source_type: "ReviewDecisionResult",
      source_kind: "api_envelope",
      notes: "Rejection endpoint mutates review state only; it does not delete evidence or edges."
    },
    description: "Reject a review candidate with reviewer and reason."
  })
] as const satisfies readonly ApiRouteContract[];
