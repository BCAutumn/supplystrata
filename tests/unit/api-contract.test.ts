import { describe, expect, it } from "vitest";
import {
  API_CONTRACT_VERSION,
  API_ROUTES,
  MCP_RESOURCE_ROUTES,
  auditApiContract,
  buildApiOpenApiDocument,
  schemaIds,
  toOpenApiPath
} from "@supplystrata/api-orchestration";

describe("api contract", () => {
  it("pins the Gate 8 contract version and required route surface", () => {
    expect(API_CONTRACT_VERSION).toBe("0.1.0");
    expect(routeKeys()).toEqual([
      "GET /ai/provider-status",
      "GET /chains/:scope",
      "GET /changes",
      "GET /claims/:id",
      "GET /companies/:id/ai-analysis-plan",
      "GET /companies/:id/ai-analysis/latest",
      "GET /companies/:id/card",
      "GET /companies/:id/consumer-read-model",
      "GET /companies/:id/reasoning-walkthrough",
      "GET /companies/:id/supply-chain-report",
      "GET /components/:id/card",
      "GET /evidence/:id",
      "GET /observations/:scope",
      "GET /research-runs/:id",
      "GET /risk-views/:scope",
      "GET /runs/ai-analysis",
      "GET /runs/source-checks",
      "GET /sources/health",
      "GET /unknowns/:scope",
      "POST /companies/:id/research-runs",
      "POST /review/:id/approve",
      "POST /review/:id/reject",
      "POST /source-checks/run"
    ]);
  });

  it("keeps API DTO sources on public contracts instead of persistence rows", () => {
    const audit = auditApiContract();

    expect(audit).toMatchObject({
      route_count: 23,
      schema_count: 26,
      db_row_leak_count: 0,
      missing_schema_ids: []
    });
    expect(API_ROUTES.filter((route) => route.access === "review_write")).toHaveLength(2);
    expect(API_ROUTES.filter((route) => route.access === "workflow_write")).toHaveLength(2);
    expect(API_ROUTES.filter((route) => route.access === "read_through_research")).toHaveLength(1);
    expect(
      API_ROUTES.filter((route) => route.handler_status === "http_adapter_backed")
        .map((route) => route.operation_id)
        .sort()
    ).toEqual([
      "approveReviewCandidate",
      "createCompanyResearchRun",
      "getAiProviderStatus",
      "getChain",
      "getClaim",
      "getCompanyAiAnalysisLatest",
      "getCompanyAiAnalysisPlan",
      "getCompanyCard",
      "getCompanyConsumerReadModel",
      "getCompanyReasoningWalkthrough",
      "getCompanySupplyChainReport",
      "getComponentCard",
      "getEvidence",
      "getResearchRunStatus",
      "getRiskView",
      "listAiAnalysisRuns",
      "listChanges",
      "listObservations",
      "listSourceCheckRuns",
      "listSourceHealth",
      "listUnknowns",
      "rejectReviewCandidate",
      "runSourceChecks"
    ]);
    expect(API_ROUTES.filter((route) => route.handler_status === "contract_only")).toHaveLength(0);
    expect(
      API_ROUTES.filter((route) => route.access === "review_write").every((route) => route.write_policy === "review_queue_mutation_only_no_fact_edge_write")
    ).toBe(true);
    expect(
      API_ROUTES.filter((route) => route.access === "workflow_write").every((route) => route.write_policy === "research_run_mutation_no_fact_edge_write")
    ).toBe(true);
    expect(
      API_ROUTES.filter((route) => route.access === "read_through_research").every(
        (route) => route.read_through_policy === "read_through_research_may_network_no_fact_edge_write"
      )
    ).toBe(true);
  });

  it("generates a versioned OpenAPI document from the route registry", () => {
    const document = buildApiOpenApiDocument();

    expect(document.openapi).toBe("3.1.0");
    expect(document.info.version).toBe(API_CONTRACT_VERSION);
    expect(Object.keys(document.paths).sort()).toEqual([
      "/ai/provider-status",
      "/chains/{scope}",
      "/changes",
      "/claims/{id}",
      "/companies/{id}/ai-analysis-plan",
      "/companies/{id}/ai-analysis/latest",
      "/companies/{id}/card",
      "/companies/{id}/consumer-read-model",
      "/companies/{id}/reasoning-walkthrough",
      "/companies/{id}/research-runs",
      "/companies/{id}/supply-chain-report",
      "/components/{id}/card",
      "/evidence/{id}",
      "/observations/{scope}",
      "/research-runs/{id}",
      "/review/{id}/approve",
      "/review/{id}/reject",
      "/risk-views/{scope}",
      "/runs/ai-analysis",
      "/runs/source-checks",
      "/source-checks/run",
      "/sources/health",
      "/unknowns/{scope}"
    ]);
    expect(document.paths["/review/{id}/approve"]?.post?.requestBody?.content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/ReviewDecisionRequest"
    });
    expect(document.paths["/companies/{id}/research-runs"]?.post?.requestBody?.content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/ResearchRunRequest"
    });
    expect(document.paths["/source-checks/run"]?.post?.requestBody?.content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/SourceCheckRunRequest"
    });
    expect(schemaIds()).toContain("ConsumerReadModelApiResponse");
    expect(schemaIds()).toContain("ReasoningWalkthroughApiResponse");
    expect(schemaIds()).toContain("SourceCheckRunsApiResponse");
    expect(schemaIds()).toContain("ResearchRunStatusApiResponse");
    expect(schemaIds()).toContain("SourceCheckRunRequest");
    expect(schemaIds()).toContain("SourceCheckRunApiResponse");
    expect(schemaIds()).toContain("ResearchRunApiResponse");
    expect(schemaIds()).toContain("CompanySupplyChainReportApiResponse");
    expect(schemaIds()).toContain("AiProviderStatusApiResponse");
    expect(schemaIds()).toContain("AiAnalysisRunsApiResponse");
    expect(schemaIds()).toContain("CompanyAiAnalysisPlanApiResponse");
    expect(schemaIds()).toContain("CompanyAiAnalysisLatestApiResponse");
    expect(schemaIds()).toContain("ScbomDocumentApiResponse");
  });

  it("keeps SCBOM as an MCP resource operation without adding a REST/OpenAPI route", () => {
    expect(MCP_RESOURCE_ROUTES.map((route) => `${route.method} ${route.path}`)).toEqual(["GET /companies/:id/scbom"]);
    expect(MCP_RESOURCE_ROUTES[0]?.operation_id).toBe("getCompanyScbomDocument");
    expect(routeKeys()).not.toContain("GET /companies/:id/scbom");
    expect(Object.keys(buildApiOpenApiDocument().paths)).not.toContain("/companies/{id}/scbom");
  });

  it("converts colon parameters to OpenAPI path parameters", () => {
    expect(toOpenApiPath("/companies/:id/card")).toBe("/companies/{id}/card");
    expect(toOpenApiPath("/risk-views/:scope")).toBe("/risk-views/{scope}");
  });
});

function routeKeys(): string[] {
  return API_ROUTES.map((route) => `${route.method} ${route.path}`).sort();
}
