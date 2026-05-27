import { describe, expect, it } from "vitest";
import { API_CONTRACT_VERSION, API_ROUTES, auditApiContract, buildApiOpenApiDocument, schemaIds, toOpenApiPath } from "@supplystrata/api";

describe("api contract", () => {
  it("pins the Gate 8 contract version and required route surface", () => {
    expect(API_CONTRACT_VERSION).toBe("0.1.0");
    expect(routeKeys()).toEqual([
      "GET /chains/:scope",
      "GET /changes",
      "GET /claims/:id",
      "GET /companies/:id/card",
      "GET /companies/:id/consumer-read-model",
      "GET /companies/:id/reasoning-walkthrough",
      "GET /components/:id/card",
      "GET /evidence/:id",
      "GET /observations/:scope",
      "GET /risk-views/:scope",
      "GET /sources/health",
      "GET /unknowns/:scope",
      "POST /review/:id/approve",
      "POST /review/:id/reject"
    ]);
  });

  it("keeps API DTO sources on public contracts instead of persistence rows", () => {
    const audit = auditApiContract();

    expect(audit).toMatchObject({
      route_count: 14,
      schema_count: 14,
      db_row_leak_count: 0,
      missing_schema_ids: []
    });
    expect(API_ROUTES.every((route) => route.handler_status === "contract_only")).toBe(true);
    expect(API_ROUTES.filter((route) => route.access === "review_write")).toHaveLength(2);
    expect(
      API_ROUTES.filter((route) => route.access === "review_write").every((route) => route.write_policy === "review_queue_mutation_only_no_fact_edge_write")
    ).toBe(true);
  });

  it("generates a versioned OpenAPI document from the route registry", () => {
    const document = buildApiOpenApiDocument();

    expect(document.openapi).toBe("3.1.0");
    expect(document.info.version).toBe(API_CONTRACT_VERSION);
    expect(Object.keys(document.paths).sort()).toEqual([
      "/chains/{scope}",
      "/changes",
      "/claims/{id}",
      "/companies/{id}/card",
      "/companies/{id}/consumer-read-model",
      "/companies/{id}/reasoning-walkthrough",
      "/components/{id}/card",
      "/evidence/{id}",
      "/observations/{scope}",
      "/review/{id}/approve",
      "/review/{id}/reject",
      "/risk-views/{scope}",
      "/sources/health",
      "/unknowns/{scope}"
    ]);
    expect(document.paths["/review/{id}/approve"]?.post?.requestBody?.content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/ReviewDecisionRequest"
    });
    expect(schemaIds()).toContain("ConsumerReadModelApiResponse");
    expect(schemaIds()).toContain("ReasoningWalkthroughApiResponse");
  });

  it("converts colon parameters to OpenAPI path parameters", () => {
    expect(toOpenApiPath("/companies/:id/card")).toBe("/companies/{id}/card");
    expect(toOpenApiPath("/risk-views/:scope")).toBe("/risk-views/{scope}");
  });
});

function routeKeys(): string[] {
  return API_ROUTES.map((route) => `${route.method} ${route.path}`).sort();
}
