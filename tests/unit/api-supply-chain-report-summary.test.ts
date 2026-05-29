import { describe, expect, it } from "vitest";
import { buildCompanySupplyChainResearchSummary, type CompanySupplyChainReport } from "@supplystrata/api-orchestration";

describe("company supply-chain report research summary", () => {
  it("marks reviewed fact coverage as facts_ready", () => {
    const summary = buildCompanySupplyChainResearchSummary({
      company_query: "Tesla",
      report_quality: "partial",
      refresh: refreshFixture(),
      current: currentFixture({ factEdges: 2, openUnknowns: 1 })
    });

    expect(summary.readiness).toBe("facts_ready");
    expect(summary.extraction_counts.fact_edges).toBe(2);
    expect(summary.agent_instructions).toContain("Do not treat source-check success as proof that supplier fact edges exist.");
  });

  it("marks official relation candidates as review_needed instead of confirmed facts", () => {
    const summary = buildCompanySupplyChainResearchSummary({
      company_query: "Tesla",
      report_quality: "partial",
      refresh: refreshFixture({
        sourceCheckExecution: {
          mode: "inline",
          checked_targets: 2,
          failed_targets: 0,
          dead_jobs: 0,
          extraction_summary: {
            checked_documents: 3,
            observations: 4,
            review_candidates: 2,
            semantic_changes: 2,
            relation_changes: 0
          }
        }
      }),
      current: currentFixture({ factEdges: 0, openUnknowns: 3 })
    });

    expect(summary.readiness).toBe("review_needed");
    expect(summary.evidence_boundary).toContain("review candidates");
    expect(summary.plain_language_status).toContain("still require review");
  });

  it("makes observations_only explicit when SEC checks succeed but no supplier facts exist", () => {
    const summary = buildCompanySupplyChainResearchSummary({
      company_query: "Tesla",
      report_quality: "partial",
      refresh: refreshFixture({
        sourceCheckExecution: {
          mode: "inline",
          checked_targets: 2,
          failed_targets: 0,
          dead_jobs: 0,
          extraction_summary: {
            checked_documents: 3,
            observations: 42,
            review_candidates: 0,
            semantic_changes: 0,
            relation_changes: 0
          }
        }
      }),
      current: currentFixture({ factEdges: 0, openUnknowns: 1 })
    });

    expect(summary.readiness).toBe("observations_only");
    expect(summary.plain_language_status).toContain("has not established reviewed supplier fact edges yet");
    expect(summary.evidence_boundary).toContain("do not prove a supplier graph");
  });

  it("surfaces source-check failure without implying absence of suppliers", () => {
    const summary = buildCompanySupplyChainResearchSummary({
      company_query: "Tesla",
      report_quality: "empty",
      refresh: refreshFixture({
        runStatus: "failed",
        sourceCheckSummary: { total: 2, pending: 0, in_progress: 0, failed: 1, succeeded: 1, dead: 0 },
        sourceCheckExecution: {
          mode: "inline",
          checked_targets: 1,
          failed_targets: 1,
          dead_jobs: 0,
          extraction_summary: {
            checked_documents: 1,
            observations: 40,
            review_candidates: 0,
            semantic_changes: 0,
            relation_changes: 0
          }
        }
      }),
      current: { consumer_read_model: null, reasoning_walkthrough: null, latest_ai_analysis: null }
    });

    expect(summary.readiness).toBe("source_checks_failed");
    expect(summary.evidence_boundary).toBe("Do not infer absence of supply-chain facts from failed source checks.");
    expect(summary.recommended_next_calls).toContain("/research-runs/RR-test");
  });
});

function refreshFixture(
  overrides: {
    runStatus?: CompanySupplyChainReport["refresh"]["run"]["status"];
    sourceCheckSummary?: CompanySupplyChainReport["refresh"]["run"]["source_check_summary"];
    sourceCheckExecution?: CompanySupplyChainReport["refresh"]["source_check_execution"];
  } = {}
): CompanySupplyChainReport["refresh"] {
  return {
    mode: "read_through",
    triggered: true,
    reuse_reason: "created_run",
    source_check_execution: overrides.sourceCheckExecution ?? null,
    run: {
      run_id: "RR-test",
      session_id: "RR-test",
      company_query: "Tesla",
      company_entity_id: "ENT-TESLA",
      depth: 3,
      status: overrides.runStatus ?? "succeeded",
      bootstrap_status: "resolved",
      source_target_namespace: "research-rr-test",
      source_check_target_ids: [
        "research:research-rr-test:sec-edgar:sec-company-filings:ent-tesla",
        "research:research-rr-test:sec-edgar:sec-company-facts:ent-tesla"
      ],
      source_check_summary: overrides.sourceCheckSummary ?? { total: 2, pending: 0, in_progress: 0, failed: 0, succeeded: 2, dead: 0 },
      error_message: null,
      created_at: "2026-05-27T00:00:00.000Z",
      updated_at: "2026-05-27T00:00:00.000Z",
      completed_at: null,
      profile: null,
      next_actions: [],
      policy: {
        fact_mutation_allowed: false,
        source_jobs_allowed: true,
        ai_provider_call_allowed: false
      }
    }
  };
}

function currentFixture(input: { factEdges: number; openUnknowns: number }): CompanySupplyChainReport["current"] {
  return {
    consumer_read_model: {
      schema_version: "1.0.0",
      contract_id: "gate8_lite_consumer_read_model.v0",
      generated_at: "2026-05-27T00:00:00.000Z",
      company: { selected_company_id: "ENT-TESLA", name: "Tesla, Inc.", visible_companies: 1 },
      research_pack: {
        mode: "truth_store",
        depth: 3,
        components: [],
        fact_edges: input.factEdges,
        evidences: 0,
        l4_l5_fact_edges: input.factEdges,
        traceable_edges: 0,
        cross_source_edges: 0,
        corroboration_or_disposition_edges: 0,
        readiness: {
          question_ready: 0,
          question_partial: 1,
          question_blocked: 0,
          gate1_overall_progress: 0,
          gate1_data_progress: 0,
          gate1_source_path_progress: 0
        }
      },
      chain: { segments: 0, upstream_edges: 0, downstream_edges: 0, component_ids: [], counterparty_company_ids: [] },
      changes: { total: 0, requires_attention: 0, by_family: {}, latest: [] },
      derived_context: {
        edge_strengths: 0,
        edge_freshness: 0,
        stale_edges: 0,
        component_risk_scope: "not_refreshed",
        component_risk_global_edges: 0,
        component_risk_visible_edges: 0,
        component_risk_metrics: 0,
        component_risk_changes: 0
      },
      constraints: {
        policy_or_export_control_status: "not_refreshed",
        policy_or_export_control_sources: 0,
        policy_or_export_control_observations: 0,
        policy_or_export_control_missing_requirements: [],
        truth_store_write_policy: "constraint_context_only_no_fact_mutation"
      },
      unknowns: { total: input.openUnknowns, open: input.openUnknowns, resolved: 0, by_scope_kind: {}, top_open: [] },
      next_actions: { total: 0, p0: 0, p1: 0, p2: 0, by_frontend_action: {}, top_items: [] },
      source_monitoring: {
        expected_targets: 2,
        synced_targets: 2,
        not_synced: 0,
        due_targets: 0,
        active_jobs: 0,
        degraded_targets: 0,
        dead_targets: 0,
        missing_credentials: 0,
        invalid_config: 0,
        source_unreachable: 0,
        targets_with_observations: 1,
        total_observations: 0
      },
      policy: {
        read_policy: "read_only_no_truth_store_mutation",
        fact_mutation_allowed: false,
        intended_consumers: ["external_agent"]
      }
    },
    reasoning_walkthrough: null,
    latest_ai_analysis: null
  };
}
