import { describe, expect, it } from "vitest";
import type { ApiOperationHandlers } from "@supplystrata/api-orchestration";
import { handleApiHttpRequest } from "@supplystrata/api";
import { EntityResolutionError } from "@supplystrata/db/read";

describe("api HTTP adapter", () => {
  it("wraps implemented route handlers in the versioned API envelope", async () => {
    const handlers: ApiOperationHandlers = {
      listSourceCheckRuns: async (input) => ({
        generated_at: input.now,
        summary: { total: 0, pending: 0, in_progress: 0, failed: 0, succeeded: 0, dead: 0 },
        jobs: []
      })
    };

    const response = await handleApiHttpRequest({ method: "GET", url: "/runs/source-checks?limit=3&status=failed" }, handlers, {
      now: () => "2026-05-27T00:00:00.000Z"
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      schema_version: "1.0.0",
      contract_version: "0.1.0",
      data: {
        generated_at: "2026-05-27T00:00:00.000Z",
        summary: { total: 0 }
      },
      meta: {
        generated_at: "2026-05-27T00:00:00.000Z",
        read_policy: "read_only_no_truth_store_mutation"
      }
    });
  });

  it("exposes OpenAPI and reports missing handlers explicitly", async () => {
    const openApi = await handleApiHttpRequest({ method: "GET", url: "/openapi.json" }, {});
    const missingHandler = await handleApiHttpRequest({ method: "GET", url: "/companies/ENT-NVIDIA/card" }, {});

    expect(openApi.status).toBe(200);
    expect(openApi.body).toMatchObject({ openapi: "3.1.0" });
    expect(missingHandler.status).toBe(501);
  });

  it("maps unresolved company ids to 404 instead of a server error", async () => {
    const handlers: ApiOperationHandlers = {
      getCompanyAiAnalysisLatest: async () => {
        throw new EntityResolutionError("ENT-TESLA");
      }
    };

    const response = await handleApiHttpRequest({ method: "GET", url: "/companies/ENT-TESLA/ai-analysis/latest" }, handlers);

    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).toContain('"status":404');
    expect(JSON.stringify(response.body)).toContain("Entity not found: ENT-TESLA");
  });

  it("exposes sanitized AI provider status through a normal read envelope", async () => {
    const handlers: ApiOperationHandlers = {
      getAiProviderStatus: async (input) => ({
        schema_version: "1.0.0",
        generated_at: input.now,
        provider: "openai",
        status: "ready",
        model: "external-model",
        base_url_configured: true,
        api_key_configured: true,
        external_configuration: {
          api_key_env_keys: ["LLM_API_KEY", "OPENAI_API_KEY"],
          base_url_env_key: "LLM_BASE_URL",
          model_env_key: "LLM_MODEL"
        },
        safety: {
          secret_fields_redacted: true,
          network_call_allowed: true,
          truth_store_write_allowed: false
        },
        status_reason: "Provider configuration is sufficient for a future explicit AI analysis invocation."
      })
    };

    const response = await handleApiHttpRequest({ method: "GET", url: "/ai/provider-status" }, handlers, {
      now: () => "2026-05-27T00:00:00.000Z"
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: {
        provider: "openai",
        status: "ready",
        safety: {
          secret_fields_redacted: true,
          truth_store_write_allowed: false
        }
      },
      meta: {
        read_policy: "read_only_no_truth_store_mutation"
      }
    });
    expect(JSON.stringify(response.body)).not.toContain("sk-");
  });

  it("exposes latest AI analysis artifacts through a normal read envelope", async () => {
    const handlers: ApiOperationHandlers = {
      getCompanyAiAnalysisLatest: async (input) => ({
        schema_version: "1.0.0",
        generated_at: input.now,
        mode: "provider_ai_v0",
        scope_id: input.path_params["id"] ?? "ENT-TSMC",
        node_id: "company_context_explanation_v0",
        status: "cannot_conclude",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        policy: {
          fact_mutation_allowed: false,
          agent_behavior_allowed: false,
          source_connector_allowed: false
        },
        headline: "TSMC supply-chain analysis is available.",
        executive_summary: ["External agents can read this artifact without triggering provider calls."],
        key_insights: [],
        evidence_boundaries: [],
        cannot_conclude: [],
        next_human_actions: [],
        open_unknowns: [],
        referenced_refs: ["company:ENT-TSMC"],
        assumptions: [],
        model_metadata: {
          provider_request_id: "request-id",
          prompt_version: "company_context_explanation.openai_compatible.v0",
          input_contracts: ["gate8_lite_consumer_read_model.v0"],
          input_refs: ["company:ENT-TSMC"],
          output_schema_id: "ai_analysis_artifact.v1",
          simulated: false
        },
        quality_lift: {
          before: "Structured facts only.",
          after: "Readable AI analysis with explicit boundaries."
        }
      })
    };

    const response = await handleApiHttpRequest({ method: "GET", url: "/companies/ENT-TSMC/ai-analysis/latest" }, handlers, {
      now: () => "2026-05-27T00:00:00.000Z"
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: {
        mode: "provider_ai_v0",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        model_metadata: {
          simulated: false
        }
      },
      meta: {
        read_policy: "read_only_no_truth_store_mutation"
      }
    });
  });

  it("wraps explicit research-run creation in a workflow write envelope", async () => {
    const handlers: ApiOperationHandlers = {
      createCompanyResearchRun: async (input) => {
        expect(input.path_params["id"]).toBe("TSLA");
        expect(input.body).toEqual({ depth: 1, enqueue_source_checks: false });
        return {
          schema_version: "1.0.0",
          generated_at: input.now,
          run: {
            run_id: "RR-test",
            company_query: "TSLA",
            company_entity_id: "ENT-TESLA",
            depth: 1,
            status: "queued_source_checks",
            bootstrap_status: "created",
            source_target_namespace: "research-rr-test",
            source_check_target_ids: ["research:research-rr-test:sec-edgar:sec-company-filings:ent-tesla"],
            source_check_summary: { total: 1, pending: 1, in_progress: 0, failed: 0, succeeded: 0, dead: 0 },
            error_message: null,
            created_at: input.now,
            updated_at: input.now,
            completed_at: null,
            next_actions: ["Run the source-check worker or wait for the worker to claim pending jobs."],
            policy: {
              fact_mutation_allowed: false,
              source_jobs_allowed: true,
              ai_provider_call_allowed: false
            }
          }
        };
      }
    };

    const response = await handleApiHttpRequest(
      { method: "POST", url: "/companies/TSLA/research-runs", body: { depth: 1, enqueue_source_checks: false } },
      handlers,
      {
        now: () => "2026-05-27T00:00:00.000Z"
      }
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: {
        run: {
          run_id: "RR-test",
          company_entity_id: "ENT-TESLA",
          policy: {
            fact_mutation_allowed: false,
            ai_provider_call_allowed: false
          }
        }
      },
      meta: {
        accepted_at: "2026-05-27T00:00:00.000Z",
        write_policy: "research_run_mutation_no_fact_edge_write"
      }
    });
  });

  it("wraps read-through supply-chain report queries with visible research policy", async () => {
    const handlers: ApiOperationHandlers = {
      getCompanySupplyChainReport: async (input) => ({
        schema_version: "1.0.0",
        generated_at: input.now,
        company_query: input.path_params["id"] ?? "TSLA",
        report_quality: "partial",
        research_summary: {
          company_entity_id: "ENT-TESLA",
          readiness: "review_needed",
          plain_language_status:
            "SupplyStrata found official-source relationship candidates for ENT-TESLA, but they still require review before becoming facts.",
          evidence_boundary: "Treat review candidates as leads from official text, not confirmed supplier relationships.",
          source_check_status: { total: 1, pending: 1, in_progress: 0, failed: 0, succeeded: 0, dead: 0 },
          extraction_counts: {
            checked_documents: 1,
            observations: 2,
            review_candidates: 3,
            semantic_changes: 0,
            relation_changes: 1,
            fact_edges: null,
            unknown_items: null
          },
          recommended_next_calls: ["/research-runs/RR-read-through"],
          agent_instructions: ["Separate reviewed facts, review candidates, observations, and unknowns."]
        },
        refresh: {
          mode: "read_through",
          triggered: true,
          reuse_reason: "created_run",
          source_check_execution: {
            mode: "inline",
            checked_targets: 1,
            failed_targets: 0,
            dead_jobs: 0,
            extraction_summary: {
              checked_documents: 1,
              observations: 2,
              review_candidates: 3,
              semantic_changes: 0,
              relation_changes: 1
            }
          },
          run: {
            run_id: "RR-read-through",
            company_query: input.path_params["id"] ?? "TSLA",
            company_entity_id: "ENT-TESLA",
            depth: 1,
            status: "queued_source_checks",
            bootstrap_status: "created",
            source_target_namespace: "research-rr-read-through",
            source_check_target_ids: ["research:research-rr-read-through:sec-edgar:sec-company-filings:ent-tesla"],
            source_check_summary: { total: 1, pending: 1, in_progress: 0, failed: 0, succeeded: 0, dead: 0 },
            error_message: null,
            created_at: input.now,
            updated_at: input.now,
            completed_at: null,
            next_actions: ["Run the source-check worker or wait for the worker to claim pending jobs."],
            policy: {
              fact_mutation_allowed: false,
              source_jobs_allowed: true,
              ai_provider_call_allowed: false
            }
          }
        },
        current: {
          consumer_read_model: null,
          reasoning_walkthrough: null,
          latest_ai_analysis: null
        },
        policy: {
          network_lookup_allowed: true,
          source_jobs_allowed: true,
          fact_mutation_allowed: false,
          ai_provider_call_allowed: false
        }
      })
    };

    const response = await handleApiHttpRequest({ method: "GET", url: "/companies/TSLA/supply-chain-report?depth=1&refresh=force" }, handlers, {
      now: () => "2026-05-27T00:00:00.000Z"
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: {
        company_query: "TSLA",
        report_quality: "partial",
        research_summary: {
          readiness: "review_needed",
          extraction_counts: {
            review_candidates: 3
          }
        },
        refresh: {
          triggered: true,
          run: {
            run_id: "RR-read-through",
            policy: {
              fact_mutation_allowed: false,
              ai_provider_call_allowed: false
            }
          }
        },
        policy: {
          network_lookup_allowed: true,
          fact_mutation_allowed: false
        }
      },
      meta: {
        generated_at: "2026-05-27T00:00:00.000Z",
        research_policy: "read_through_research_may_network_no_fact_edge_write"
      }
    });
  });
});
