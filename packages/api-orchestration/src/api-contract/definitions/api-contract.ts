import type { ApiReadPolicy, ApiReadThroughResearchPolicy, ApiReviewWritePolicy, ApiWorkflowWritePolicy } from "./api-dtos.js";

export const API_CONTRACT_VERSION = "0.1.0" as const;
export const API_SCHEMA_VERSION = "1.0.0" as const;
export const API_OPENAPI_VERSION = "3.1.0" as const;

export type ApiRouteMethod = "GET" | "POST";
export type ApiRouteStability = "v0_contract";
export type ApiHandlerStatus = "contract_only" | "http_adapter_backed";
export type ApiRouteAccess = "read" | "review_write" | "workflow_write" | "read_through_research";

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
  | "@scbom/spec"
  | "@supplystrata/ai-analysis"
  | "@supplystrata/llm-helpers"
  | "@supplystrata/render"
  | "@supplystrata/chain-view"
  | "@supplystrata/workbench-export"
  | "@supplystrata/research-pack"
  | "@supplystrata/source-workflows"
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
  | "SourceCheckRunsApiResponse"
  | "ResearchRunStatusApiResponse"
  | "SourceCheckRunRequest"
  | "SourceCheckRunApiResponse"
  | "ResearchRunRequest"
  | "ResearchRunApiResponse"
  | "CompanySupplyChainReportApiResponse"
  | "AiProviderStatusApiResponse"
  | "AiAnalysisRunsApiResponse"
  | "CompanyAiAnalysisPlanApiResponse"
  | "CompanyAiAnalysisLatestApiResponse"
  | "UnknownMapApiResponse"
  | "ConsumerReadModelApiResponse"
  | "ReasoningWalkthroughApiResponse"
  | "ScbomDocumentApiResponse"
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
  read_through_policy?: ApiReadThroughResearchPolicy;
  write_policy?: ApiReviewWritePolicy | ApiWorkflowWritePolicy;
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
  | "/runs/source-checks"
  | "/source-checks/run"
  | "/research-runs/:id"
  | "/ai/provider-status"
  | "/runs/ai-analysis"
  | "/unknowns/:scope"
  | "/companies/:id/supply-chain-report"
  | "/companies/:id/consumer-read-model"
  | "/companies/:id/reasoning-walkthrough"
  | "/companies/:id/scbom"
  | "/companies/:id/ai-analysis-plan"
  | "/companies/:id/ai-analysis/latest"
  | "/companies/:id/research-runs"
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

const depthQueryParam = (defaultValue: number): ApiRouteParameter => ({
  name: "depth",
  in: "query",
  required: false,
  schema: { type: "integer", minimum: 1, default: defaultValue },
  description: "Optional maximum chain/research traversal depth."
});

const readRoute = (
  input: Omit<ApiRouteContract, "access" | "stability" | "handler_status" | "read_policy"> & { handler_status?: ApiHandlerStatus }
): ApiRouteContract => ({
  ...input,
  access: "read",
  stability: "v0_contract",
  handler_status: input.handler_status ?? "contract_only",
  read_policy: "read_only_no_truth_store_mutation"
});

const reviewRoute = (
  input: Omit<ApiRouteContract, "access" | "stability" | "handler_status" | "write_policy" | "request_schema_id"> & { handler_status?: ApiHandlerStatus }
): ApiRouteContract => ({
  ...input,
  access: "review_write",
  stability: "v0_contract",
  handler_status: input.handler_status ?? "contract_only",
  write_policy: "review_queue_mutation_only_no_fact_edge_write",
  request_schema_id: "ReviewDecisionRequest"
});

const workflowRoute = (
  input: Omit<ApiRouteContract, "access" | "stability" | "handler_status" | "write_policy" | "request_schema_id"> & {
    handler_status?: ApiHandlerStatus;
    request_schema_id?: ApiSchemaId;
  }
): ApiRouteContract => ({
  ...input,
  access: "workflow_write",
  stability: "v0_contract",
  handler_status: input.handler_status ?? "contract_only",
  write_policy: "research_run_mutation_no_fact_edge_write",
  request_schema_id: input.request_schema_id ?? "ResearchRunRequest"
});

const readThroughResearchRoute = (
  input: Omit<ApiRouteContract, "access" | "stability" | "handler_status" | "read_through_policy"> & { handler_status?: ApiHandlerStatus }
): ApiRouteContract => ({
  ...input,
  access: "read_through_research",
  stability: "v0_contract",
  handler_status: input.handler_status ?? "contract_only",
  read_through_policy: "read_through_research_may_network_no_fact_edge_write"
});

export const API_ROUTES = [
  readRoute({
    method: "GET",
    path: "/companies/:id/card",
    operation_id: "getCompanyCard",
    handler_status: "http_adapter_backed",
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
    handler_status: "http_adapter_backed",
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
    handler_status: "http_adapter_backed",
    parameters: [idPathParam("scope", "Company, component, or future chain scope."), depthQueryParam(3)],
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
    handler_status: "http_adapter_backed",
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
    handler_status: "http_adapter_backed",
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
    handler_status: "http_adapter_backed",
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
    handler_status: "http_adapter_backed",
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
    handler_status: "http_adapter_backed",
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
    handler_status: "http_adapter_backed",
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
    path: "/runs/source-checks",
    operation_id: "listSourceCheckRuns",
    handler_status: "http_adapter_backed",
    parameters: [
      limitQueryParam(100),
      { name: "status", in: "query", required: false, schema: { type: "string" }, description: "Optional comma-separated source check job statuses." },
      { name: "source_adapter_id", in: "query", required: false, schema: { type: "string" }, description: "Optional comma-separated source adapter ids." },
      { name: "check_target_id", in: "query", required: false, schema: { type: "string" }, description: "Optional comma-separated source check target ids." }
    ],
    response_schema_id: "SourceCheckRunsApiResponse",
    dto_contract: {
      schema_id: "SourceCheckRunsApiResponse",
      source_package: "@supplystrata/api",
      source_type: "SourceCheckRunStatusReport",
      source_kind: "api_envelope",
      notes: "Run/status API exposes source_check_jobs through a stable DTO; it does not leak source-check persistence rows."
    },
    description: "Return source-check job run status for source monitor and host-app progress views."
  }),
  readRoute({
    method: "GET",
    path: "/research-runs/:id",
    operation_id: "getResearchRunStatus",
    handler_status: "http_adapter_backed",
    parameters: [idPathParam("id", "Research run id returned by POST /companies/:id/research-runs.")],
    response_schema_id: "ResearchRunStatusApiResponse",
    dto_contract: {
      schema_id: "ResearchRunStatusApiResponse",
      source_package: "@supplystrata/source-workflows",
      source_type: "ResearchRunStatusReport",
      source_kind: "public_dto",
      notes: "Research run status exposes bootstrap, source target ids, source-check progress, and next actions without leaking persistence rows."
    },
    description: "Return durable status for an API-triggered company research run."
  }),
  readRoute({
    method: "GET",
    path: "/ai/provider-status",
    operation_id: "getAiProviderStatus",
    handler_status: "http_adapter_backed",
    parameters: [],
    response_schema_id: "AiProviderStatusApiResponse",
    dto_contract: {
      schema_id: "AiProviderStatusApiResponse",
      source_package: "@supplystrata/llm-helpers",
      source_type: "AiProviderStatusReport",
      source_kind: "public_dto",
      notes: "Provider status is sanitized: it exposes readiness, configured env keys, and no secret values."
    },
    description: "Return sanitized internal AI provider configuration status."
  }),
  readRoute({
    method: "GET",
    path: "/runs/ai-analysis",
    operation_id: "listAiAnalysisRuns",
    handler_status: "http_adapter_backed",
    parameters: [
      limitQueryParam(100),
      { name: "status", in: "query", required: false, schema: { type: "string" }, description: "Optional comma-separated AI analysis run statuses." },
      { name: "node_id", in: "query", required: false, schema: { type: "string" }, description: "Optional comma-separated AI analysis node ids." },
      { name: "scope_kind", in: "query", required: false, schema: { type: "string" }, description: "Optional AI analysis scope kind." },
      { name: "scope_id", in: "query", required: false, schema: { type: "string" }, description: "Optional AI analysis scope id." }
    ],
    response_schema_id: "AiAnalysisRunsApiResponse",
    dto_contract: {
      schema_id: "AiAnalysisRunsApiResponse",
      source_package: "@supplystrata/ai-analysis",
      source_type: "AiAnalysisRunStatusReport",
      source_kind: "public_dto",
      notes: "Run/status API exposes AI behavior state, input refs, guardrails, and cannot-conclude reasons without leaking provider secrets."
    },
    description: "Return auditable internal AI analysis run status for host-app progress and inspection views."
  }),
  readRoute({
    method: "GET",
    path: "/unknowns/:scope",
    operation_id: "listUnknowns",
    handler_status: "http_adapter_backed",
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
  readThroughResearchRoute({
    method: "GET",
    path: "/companies/:id/supply-chain-report",
    operation_id: "getCompanySupplyChainReport",
    handler_status: "http_adapter_backed",
    parameters: [
      idPathParam("id", "Company query, ticker, alias, or entity id."),
      depthQueryParam(3),
      {
        name: "refresh",
        in: "query",
        required: false,
        schema: { type: "string", default: "auto" },
        description: "Use auto to reuse active/fresh research runs or force to create a new network-backed run."
      },
      {
        name: "max_age_minutes",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 0, default: 1440 },
        description: "Maximum age for reusing a completed research run in auto refresh mode."
      },
      {
        name: "source_checks",
        in: "query",
        required: false,
        schema: { type: "string", default: "inline" },
        description: "Use inline to run due source checks during this request or queued to leave them for the worker."
      }
    ],
    response_schema_id: "CompanySupplyChainReportApiResponse",
    dto_contract: {
      schema_id: "CompanySupplyChainReportApiResponse",
      source_package: "@supplystrata/api",
      source_type: "CompanySupplyChainReport",
      source_kind: "api_envelope",
      notes:
        "Read-through company report may trigger listed-company bootstrap and source-check jobs; it returns current DTOs plus observable research run state."
    },
    description: "Return a company supply-chain report while triggering or reusing a visible network-backed research run when data is missing or stale."
  }),
  readRoute({
    method: "GET",
    path: "/companies/:id/consumer-read-model",
    operation_id: "getCompanyConsumerReadModel",
    handler_status: "http_adapter_backed",
    parameters: [idPathParam("id", "Company entity id or resolver-backed company query."), depthQueryParam(3)],
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
    handler_status: "http_adapter_backed",
    parameters: [idPathParam("id", "Company entity id or resolver-backed company query."), depthQueryParam(3)],
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
  readRoute({
    method: "GET",
    path: "/companies/:id/ai-analysis-plan",
    operation_id: "getCompanyAiAnalysisPlan",
    handler_status: "http_adapter_backed",
    parameters: [idPathParam("id", "Company entity id or resolver-backed company query."), depthQueryParam(3)],
    response_schema_id: "CompanyAiAnalysisPlanApiResponse",
    dto_contract: {
      schema_id: "CompanyAiAnalysisPlanApiResponse",
      source_package: "@supplystrata/ai-analysis",
      source_type: "AiAnalysisPlan",
      source_kind: "public_dto",
      notes: "Plan lists AI handoff nodes, deterministic input contracts, guardrails, and cannot-conclude rules; it does not invoke a model."
    },
    description: "Return the planned internal AI analysis nodes for a company without running autonomous agent behavior."
  }),
  readRoute({
    method: "GET",
    path: "/companies/:id/ai-analysis/latest",
    operation_id: "getCompanyAiAnalysisLatest",
    handler_status: "http_adapter_backed",
    parameters: [idPathParam("id", "Company entity id or resolver-backed company query.")],
    response_schema_id: "CompanyAiAnalysisLatestApiResponse",
    dto_contract: {
      schema_id: "CompanyAiAnalysisLatestApiResponse",
      source_package: "@supplystrata/ai-analysis",
      source_type: "AiAnalysisArtifact",
      source_kind: "public_dto",
      notes: "Latest AI analysis returns a previously generated artifact; the read endpoint does not invoke a provider or write the truth store."
    },
    description: "Return the latest read-only AI analysis artifact for a company."
  }),
  workflowRoute({
    method: "POST",
    path: "/companies/:id/research-runs",
    operation_id: "createCompanyResearchRun",
    handler_status: "http_adapter_backed",
    parameters: [idPathParam("id", "Company query, ticker, alias, or entity id.")],
    response_schema_id: "ResearchRunApiResponse",
    dto_contract: {
      schema_id: "ResearchRunApiResponse",
      source_package: "@supplystrata/source-workflows",
      source_type: "ResearchRunStatusReport",
      source_kind: "public_dto",
      notes: "Research run creation may bootstrap listed-company identity and enqueue official source checks; it cannot write fact edges or call AI providers."
    },
    description: "Start a company research run by explicitly allowing entity bootstrap and source-check job creation."
  }),
  workflowRoute({
    method: "POST",
    path: "/source-checks/run",
    operation_id: "runSourceChecks",
    handler_status: "http_adapter_backed",
    request_schema_id: "SourceCheckRunRequest",
    parameters: [],
    response_schema_id: "SourceCheckRunApiResponse",
    dto_contract: {
      schema_id: "SourceCheckRunApiResponse",
      source_package: "@supplystrata/source-workflows",
      source_type: "DueSourceCheckRunResult",
      source_kind: "public_dto",
      notes:
        "Source-check execution may write local raw-document cache, observation events, and audit ledger entries; it cannot write fact edges or call AI providers."
    },
    description: "Run due source checks after explicit confirmation."
  }),
  reviewRoute({
    method: "POST",
    path: "/review/:id/approve",
    operation_id: "approveReviewCandidate",
    handler_status: "http_adapter_backed",
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
    handler_status: "http_adapter_backed",
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

export const MCP_RESOURCE_ROUTES = [
  readRoute({
    method: "GET",
    path: "/companies/:id/scbom",
    operation_id: "getCompanyScbomDocument",
    handler_status: "http_adapter_backed",
    parameters: [idPathParam("id", "Company entity id, LEI, ticker, alias, or resolver-backed company query."), depthQueryParam(3)],
    response_schema_id: "ScbomDocumentApiResponse",
    dto_contract: {
      schema_id: "ScbomDocumentApiResponse",
      source_package: "@scbom/spec",
      source_type: "ScbomDocument",
      source_kind: "public_dto",
      notes: "SCBOM document is validated against @scbom/spec v0.0.1 and excludes SupplyStrata review, risk, and runtime state."
    },
    description: "Return a vendor-neutral SCBOM document for a company research scope."
  })
] as const satisfies readonly ApiRouteContract[];

export const API_OPERATION_ROUTES = [...API_ROUTES, ...MCP_RESOURCE_ROUTES] as const satisfies readonly ApiRouteContract[];

export type ApiOperationId = (typeof API_OPERATION_ROUTES)[number]["operation_id"];
