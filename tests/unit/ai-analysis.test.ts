import { afterEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import type { DbClient } from "@supplystrata/db/write";
import type { ConsumerReadModel, ReasoningWalkthrough } from "@supplystrata/research-pack";
import {
  buildAiProviderStatus,
  buildCompanyAiAnalysisPlan,
  buildLocalAiAnalysisArtifact,
  buildProviderAiAnalysisArtifactFromUnknown,
  collectAllowedAiAnalysisRefs,
  listAiAnalysisRuns,
  validateAiAnalysisArtifact
} from "@supplystrata/ai-analysis";

describe("ai analysis", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports provider readiness without leaking secrets", () => {
    const report = buildAiProviderStatus(
      {
        LLM_PROVIDER: "openai",
        OPENAI_API_KEY: "sk-test-secret",
        LLM_BASE_URL: "https://llm.example/v1",
        LLM_MODEL: "external-model"
      },
      "2026-05-27T00:00:00.000Z"
    );

    expect(report).toMatchObject({
      provider: "openai",
      status: "ready",
      model: "external-model",
      base_url_configured: true,
      api_key_configured: true,
      safety: {
        secret_fields_redacted: true,
        network_call_allowed: true,
        truth_store_write_allowed: false
      }
    });
    expect(JSON.stringify(report)).not.toContain("sk-test-secret");
  });

  it("blocks custom providers until an external url and key are configured", () => {
    const missingKey = buildAiProviderStatus({ LLM_PROVIDER: "custom", LLM_BASE_URL: "https://llm.example/v1" }, "2026-05-27T00:00:00.000Z");
    const missingUrl = buildAiProviderStatus({ LLM_PROVIDER: "custom", LLM_API_KEY: "key" }, "2026-05-27T00:00:00.000Z");

    expect(missingKey.status).toBe("missing_api_key");
    expect(missingUrl.status).toBe("missing_base_url");
  });

  it("builds explicit AI handoff nodes from deterministic read models", () => {
    const provider = buildAiProviderStatus({ LLM_PROVIDER: "openai", LLM_API_KEY: "key" }, "2026-05-27T00:00:00.000Z");

    const plan = buildCompanyAiAnalysisPlan({
      generated_at: "2026-05-27T00:00:00.000Z",
      provider,
      consumer_read_model: consumerReadModelFixture(),
      reasoning_walkthrough: reasoningWalkthroughFixture()
    });

    expect(plan).toMatchObject({
      scope_kind: "company",
      scope_id: "ENT-NVIDIA",
      status: "ready",
      policy: {
        fact_mutation_allowed: false,
        agent_behavior_allowed: false
      }
    });
    expect(plan.nodes.map((node) => node.node_id)).toEqual(["company_context_explanation_v0", "reasoning_walkthrough_explanation_v0"]);
    expect(plan.nodes.every((node) => node.guardrails.some((guardrail) => guardrail.includes("Do not")))).toBe(true);
    expect(plan.nodes.some((node) => node.status === "cannot_conclude")).toBe(true);
    expect(plan.nodes.flatMap((node) => node.cannot_conclude).join("\n")).toContain("Cannot claim");
  });

  it("lists AI run status as public DTOs instead of persistence rows", async () => {
    const client = new AiAnalysisRunDbClient();

    const report = await listAiAnalysisRuns(client, {
      generated_at: "2026-05-27T00:00:00.000Z",
      limit: 5,
      statuses: ["cannot_conclude"],
      node_ids: ["reasoning_walkthrough_explanation_v0"],
      scope_kind: "company",
      scope_id: "ENT-NVIDIA"
    });

    expect(report).toMatchObject({
      generated_at: "2026-05-27T00:00:00.000Z",
      summary: {
        total: 1,
        cannot_conclude: 1
      },
      runs: [
        {
          run_id: "AIR-TEST",
          node_id: "reasoning_walkthrough_explanation_v0",
          scope_kind: "company",
          scope_id: "ENT-NVIDIA",
          status: "cannot_conclude",
          provider: "openai",
          prompt_sha256: "prompt-sha",
          output_sha256: "output-sha"
        }
      ],
      policy: {
        read_policy: "read_only_ai_analysis_status",
        fact_mutation_allowed: false,
        agent_behavior_allowed: false
      }
    });
    expect(client.calls[0]?.sql).toContain("FROM ai_analysis_runs");
    expect(client.calls[0]?.sql).toContain("status = ANY");
    expect(client.calls[0]?.sql).toContain("scope_kind =");
  });

  it("builds a local AI analysis artifact that preserves read-only guardrails", () => {
    const provider = buildAiProviderStatus({ LLM_PROVIDER: "none" }, "2026-05-27T00:00:00.000Z");
    const input = {
      generated_at: "2026-05-27T00:00:00.000Z",
      provider,
      manifest: manifestFixture(),
      consumer_read_model: consumerReadModelFixture(),
      reasoning_walkthrough: reasoningWalkthroughFixture()
    };

    const artifact = buildLocalAiAnalysisArtifact(input);
    const validation = validateAiAnalysisArtifact({
      artifact,
      allowed_refs: collectAllowedAiAnalysisRefs(input)
    });

    expect(validation).toMatchObject({ ok: true });
    expect(artifact).toMatchObject({
      mode: "simulated_local_ai_v0",
      status: "cannot_conclude",
      policy: {
        fact_mutation_allowed: false,
        agent_behavior_allowed: false,
        source_connector_allowed: false
      },
      model_metadata: {
        provider_request_id: null,
        simulated: true,
        output_schema_id: "ai_analysis_artifact.v1"
      }
    });
    expect(artifact.executive_summary.join("\n")).toContain("observation");
    expect(artifact.next_human_actions[0]?.refs).toEqual(["source_target:sec-edgar:nvidia"]);
  });

  it("rejects AI artifacts that try to mutate facts or cite unknown refs", () => {
    const provider = buildAiProviderStatus({ LLM_PROVIDER: "none" }, "2026-05-27T00:00:00.000Z");
    const input = {
      generated_at: "2026-05-27T00:00:00.000Z",
      provider,
      manifest: manifestFixture(),
      consumer_read_model: consumerReadModelFixture(),
      reasoning_walkthrough: reasoningWalkthroughFixture()
    };
    const artifact = {
      ...buildLocalAiAnalysisArtifact(input),
      policy: {
        fact_mutation_allowed: true,
        agent_behavior_allowed: false,
        source_connector_allowed: false
      },
      referenced_refs: ["source_target:sec-edgar:nvidia", "source_target:invented"]
    };

    const validation = validateAiAnalysisArtifact({
      artifact,
      allowed_refs: collectAllowedAiAnalysisRefs(input)
    });

    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.errors).toContain("policy.fact_mutation_allowed must be false");
      expect(validation.errors).toContain("AI artifact references unknown input ref: source_target:invented");
    }
  });

  it("calls an OpenAI-compatible provider and validates the returned artifact", async () => {
    const provider = buildAiProviderStatus(
      { LLM_PROVIDER: "deepseek", LLM_API_KEY: "key", LLM_BASE_URL: "https://api.deepseek.com", LLM_MODEL: "deepseek-v4-flash" },
      "2026-05-27T00:00:00.000Z"
    );
    const local = buildLocalAiAnalysisArtifact({
      generated_at: "2026-05-27T00:00:00.000Z",
      provider,
      manifest: manifestFixture(),
      consumer_read_model: consumerReadModelFixture(),
      reasoning_walkthrough: reasoningWalkthroughFixture()
    });
    const calls: { url: string; authorization: string | null }[] = [];
    vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        authorization: headerValue(init?.headers, "authorization")
      });
      return new Response(
        JSON.stringify({
          id: "chatcmpl-test",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ...local,
                  mode: "provider_ai_v0",
                  headline: "DeepSeek 生成的完整报告解读",
                  executive_summary: ["DeepSeek summary"],
                  model_metadata: {
                    ...local.model_metadata,
                    prompt_version: "company_context_explanation.openai_compatible.v0",
                    simulated: false
                  }
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    const artifact = await buildProviderAiAnalysisArtifactFromUnknown({
      generated_at: "2026-05-27T00:00:00.000Z",
      provider,
      api_key: "key",
      base_url: "https://api.deepseek.com",
      manifest: manifestFixture(),
      consumer_read_model: consumerReadModelFixture(),
      reasoning_walkthrough: reasoningWalkthroughFixture()
    });

    expect(calls).toEqual([{ url: "https://api.deepseek.com/chat/completions", authorization: "Bearer key" }]);
    expect(artifact).toMatchObject({
      mode: "provider_ai_v0",
      headline: "DeepSeek 生成的完整报告解读",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      model_metadata: {
        provider_request_id: "chatcmpl-test",
        prompt_version: "company_context_explanation.openai_compatible.v0",
        simulated: false
      }
    });
  });
});

function headerValue(headers: HeadersInit | undefined, name: string): string | null {
  if (headers === undefined) return null;
  return new Headers(headers).get(name);
}

interface QueryCall {
  sql: string;
  params: readonly unknown[];
}

class AiAnalysisRunDbClient implements DbClient {
  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(statement: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql: statement, params });
    return {
      command: "SELECT",
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [
        {
          run_id: "AIR-TEST",
          node_id: "reasoning_walkthrough_explanation_v0",
          scope_kind: "company",
          scope_id: "ENT-NVIDIA",
          status: "cannot_conclude",
          provider: "openai",
          model: "external-model",
          provider_request_id: "provider-request",
          input_refs: ["company:ENT-NVIDIA", "reasoning_layer:compute_to_server"],
          guardrail_refs: ["guardrail:no_fact_mutation"],
          cannot_conclude: ["Cannot claim a relationship without reviewed evidence."],
          prompt_sha256: "prompt-sha",
          output_sha256: "output-sha",
          output_summary: "Insufficient reviewed evidence.",
          error_message: null,
          created_at: new Date("2026-05-27T00:00:00.000Z"),
          started_at: new Date("2026-05-27T00:00:01.000Z"),
          completed_at: new Date("2026-05-27T00:00:02.000Z"),
          updated_at: new Date("2026-05-27T00:00:02.000Z")
        }
      ] as unknown as T[]
    };
  }
}

function manifestFixture() {
  return {
    generated_at: "2026-05-27T00:00:00.000Z",
    selected_company_id: "ENT-NVIDIA",
    mode: "truth_store",
    stats: {
      official_disclosure_l4_l5_edges: 8,
      official_disclosure_traceable_edges: 8,
      source_target_total_observations: 3,
      supply_chain_expansion_component_dependency_leads: 5,
      official_disclosure_target_nodes: 12
    }
  };
}

function consumerReadModelFixture(): ConsumerReadModel {
  return {
    schema_version: "1.0.0",
    contract_id: "gate8_lite_consumer_read_model.v0",
    generated_at: "2026-05-27T00:00:00.000Z",
    company: {
      selected_company_id: "ENT-NVIDIA",
      name: "NVIDIA",
      visible_companies: 3
    },
    research_pack: {
      mode: "truth_store",
      depth: 3,
      components: ["gpu"],
      fact_edges: 2,
      evidences: 2,
      l4_l5_fact_edges: 1,
      traceable_edges: 1,
      cross_source_edges: 0,
      corroboration_or_disposition_edges: 0,
      readiness: {
        question_ready: 1,
        question_partial: 1,
        question_blocked: 1,
        gate1_overall_progress: 0.5,
        gate1_data_progress: 0.5,
        gate1_source_path_progress: 0.5
      }
    },
    chain: {
      segments: 2,
      upstream_edges: 2,
      downstream_edges: 0,
      component_ids: ["gpu"],
      counterparty_company_ids: ["ENT-TSMC"]
    },
    changes: {
      total: 0,
      requires_attention: 0,
      by_family: {},
      latest: []
    },
    derived_context: {
      edge_strengths: 1,
      edge_freshness: 1,
      stale_edges: 0,
      component_risk_scope: "component_global",
      component_risk_global_edges: 2,
      component_risk_visible_edges: 2,
      component_risk_metrics: 1,
      component_risk_changes: 0
    },
    constraints: {
      policy_or_export_control_status: "partial",
      policy_or_export_control_sources: 1,
      policy_or_export_control_observations: 0,
      policy_or_export_control_missing_requirements: ["official evidence gap"],
      truth_store_write_policy: "constraint_context_only_no_fact_mutation"
    },
    unknowns: {
      total: 1,
      open: 1,
      resolved: 0,
      by_scope_kind: { company: 1 },
      top_open: [{ unknown_id: "UNK-1", scope_kind: "company", scope_id: "ENT-NVIDIA", question: "Which reviewed source confirms the relationship?" }]
    },
    next_actions: {
      total: 1,
      p0: 1,
      p1: 0,
      p2: 0,
      by_frontend_action: { run_source_target: 1 },
      top_items: [
        {
          item_id: "QA-1",
          priority: "P0",
          workstream: "official_disclosure",
          frontend_action_kind: "run_source_target",
          title: "Run official target",
          recommended_action: "Run source target before conclusion.",
          write_impact: "review_only",
          refs: ["source_target:sec-edgar:nvidia"]
        }
      ]
    },
    source_monitoring: {
      expected_targets: 1,
      synced_targets: 0,
      not_synced: 1,
      due_targets: 1,
      active_jobs: 0,
      degraded_targets: 0,
      dead_targets: 0,
      missing_credentials: 0,
      invalid_config: 0,
      source_unreachable: 0,
      targets_with_observations: 0,
      total_observations: 0
    },
    policy: {
      read_policy: "read_only_no_truth_store_mutation",
      fact_mutation_allowed: false,
      intended_consumers: ["api", "host_app", "future_safe_ai"]
    }
  };
}

function reasoningWalkthroughFixture(): ReasoningWalkthrough {
  return {
    schema_version: "1.0.0",
    walkthrough_id: "gate8_lite_reasoning_walkthrough.v0",
    generated_at: "2026-05-27T00:00:00.000Z",
    company_id: "ENT-NVIDIA",
    matrix_id: "ai_compute_propagation.v0",
    policy: "reasoning_input_only_no_fact_mutation",
    summary: {
      layers: 1,
      known_fact_layers: 0,
      layers_with_unknowns: 1,
      layers_with_blocked_sources: 0,
      next_actions: 1,
      prohibited_truth_store_writes: ["no_fact_edge_write"]
    },
    layers: [
      {
        layer_id: "compute_to_server",
        title: "Compute to AI server infrastructure",
        status: "unknown_open",
        question: "Can compute demand be traced into AI server infrastructure?",
        known_facts: {
          count: 0,
          refs: [],
          interpretation: "No reviewed L4/L5 fact edge is visible."
        },
        explicit_unknowns: {
          count: 1,
          refs: ["unknown:UNK-1"],
          interpretation: "Unknowns are not negative evidence."
        },
        constrained_evidence: {
          observation_refs: [],
          lead_refs: ["lead:LEAD-1"],
          source_target_refs: ["source_target:sec-edgar:nvidia"],
          official_evidence_gaps: [
            {
              gap_kind: "official_source_not_reviewed",
              target_kind: "source_group",
              target_id: "sec-edgar",
              label: "SEC filing source not reviewed",
              recommended_action: "Run source target"
            }
          ]
        },
        next_actions: [
          {
            queue_item_id: "Q-1",
            priority: "P0",
            action: "run_source_target",
            title: "Run SEC target",
            reason: "Official evidence is missing.",
            source_target_refs: ["source_target:sec-edgar:nvidia"],
            unknown_refs: ["unknown:UNK-1"]
          }
        ],
        cannot_conclude: ["Cannot claim a company-level supply-chain relationship for this layer without a reviewed L4/L5 fact edge."]
      }
    ],
    cannot_conclude: [
      {
        layer_id: "compute_to_server",
        reason: "Cannot claim a company-level supply-chain relationship for this layer without a reviewed L4/L5 fact edge."
      }
    ]
  };
}
