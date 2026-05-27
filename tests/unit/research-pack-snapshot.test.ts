import { describe, expect, it } from "vitest";
import {
  buildGate1DataDepthActionBatch,
  buildResearchPackFromWorkbench,
  parseSourceTargetPreflightReport,
  renderCorroborationSourcePlanMarkdown,
  renderGate1DataDepthWorkbenchMarkdown,
  renderInvestigationBacklogMarkdown,
  renderOfficialDisclosureReadinessMarkdown,
  renderPropagationReadinessMarkdown,
  renderQuestionReadinessMarkdown,
  renderSourceTargetCoverageMarkdown,
  renderSourceTargetPreflightMarkdown,
  renderSupplyChainExpansionPlanMarkdown
} from "@supplystrata/research-pack";
import { edgeSegmentFixture, evidenceFixture, gate1DataDepthActionBatchDefinition } from "./research-pack-fixtures.js";
import type { ChainViewSegmentModel } from "@supplystrata/chain-view";
import type { WorkbenchModel } from "@supplystrata/workbench-export";

describe("research-pack workbench snapshot", () => {
  it("builds a no-database research snapshot from a workbench export", () => {
    const segment: ChainViewSegmentModel = {
      sequence_index: 0,
      depth: 1,
      semantic_layer: "edge",
      from: { kind: "company", id: "ENT-NVIDIA", name: "NVIDIA" },
      to: { kind: "company", id: "ENT-SKHYNIX", name: "SK Hynix" },
      relation: "BUYS_FROM",
      component: "memory",
      component_id: "COMP-MEMORY",
      edge_id: "EDGE-1",
      evidence_ids: ["EV-1"],
      evidence_level: 5,
      confidence: 0.95,
      label: "NVIDIA buys memory from SK Hynix"
    };
    const workbench: WorkbenchModel = {
      schema_version: "1.0.0",
      generated_at: "2026-01-01T00:00:00.000Z",
      selected_company_id: "ENT-NVIDIA",
      companies: [
        { entity_id: "ENT-NVIDIA", name: "NVIDIA", role: "root" },
        { entity_id: "ENT-SKHYNIX", name: "SK Hynix", role: "counterparty" }
      ],
      chain: {
        schema_version: "1.0.0",
        view_type: "company_chain",
        root: { kind: "company", id: "ENT-NVIDIA", name: "NVIDIA" },
        max_depth: 2,
        generated_by: "test",
        segments: [segment],
        stats: { fact_edges: 1, claims: 0, observations: 0, leads: 0, unknowns: 0 }
      },
      chain_segments: [segment],
      edges: [
        {
          edge_id: "EDGE-1",
          from_id: "ENT-NVIDIA",
          from_name: "NVIDIA",
          to_id: "ENT-SKHYNIX",
          to_name: "SK Hynix",
          relation: "BUYS_FROM",
          component: "memory",
          component_id: "COMP-MEMORY",
          evidence_level: 5,
          confidence: 0.95,
          evidence_ids: ["EV-1"]
        }
      ],
      upstream_edges: [],
      downstream_edges: [],
      claims: [],
      draft_claims: [],
      evidences: [
        evidenceFixture("EV-1", {
          edge_id: "EDGE-1",
          evidence_level: 5,
          confidence: 0.95,
          source_adapter_id: "sec-edgar",
          source_url: "https://www.sec.gov/Archives/fixture/nvidia-10k.htm",
          cite_text_sha256: "abc123"
        })
      ],
      unknown_items: [],
      sources: [],
      source_plan: [],
      changes: [],
      attention_queue: [],
      review_queue: [
        {
          review_id: "REV-OFFICIAL-SIGNAL-1",
          kind: "official_disclosure_signal",
          status: "pending",
          title: "Official disclosure signal: SK hynix links results to HBM demand",
          confidence: 0.84,
          source_adapter_id: "skhynix-ir",
          doc_id: "DOC-SKHYNIX-IR",
          source_url: "https://www.skhynix.com/ir/fixture",
          source_locator: "page 3",
          source_row_text: "SK hynix reported that HBM demand from AI customers remained strong.",
          created_at: "2026-01-01T00:00:00.000Z",
          reviewed_at: null,
          decision_reason: null,
          signal: {
            signal_title: "SK hynix links results to HBM demand",
            evidence_level_hint: 4,
            automatic_fact_mutation_allowed: false
          },
          dispositions: [
            {
              change_id: "CHG-OFFICIAL-SIGNAL-DISPOSITION-1",
              review_id: "REV-OFFICIAL-SIGNAL-1",
              edge_id: "EDGE-1",
              decision: "needs_more_evidence",
              reviewer: "unit-test",
              reason: "The signal supports HBM demand context but does not provide enough reviewed relation evidence yet.",
              source_adapter_id: "skhynix-ir",
              doc_id: "DOC-SKHYNIX-IR",
              signal_title: "SK hynix links results to HBM demand",
              evidence_id: null,
              unknown_id: null,
              check_target_id: null,
              recorded_at: "2026-01-02T00:00:00.000Z",
              fact_write_policy: {
                automatic_fact_mutation_allowed: false,
                allowed_edge_mutation: "none",
                requires_human_review: true
              }
            }
          ]
        }
      ],
      intelligence: {
        edge_strengths: [
          {
            strength_id: "STR-1",
            edge_id: "EDGE-1",
            strength_kind: "qualitative",
            value: "critical",
            lower_bound: null,
            upper_bound: null,
            unit: null,
            evidence_id: "EV-1",
            method: "fixture",
            valid_from: null,
            valid_to: null
          }
        ],
        edge_freshness: [
          {
            edge_id: "EDGE-1",
            last_verified_at: "2025-01-01T00:00:00.000Z",
            decay_model: "methodology.v1",
            age_days: 365,
            freshness_score: 0.7,
            computed_at: "2026-01-01T00:00:00.000Z",
            source_evidence_id: "EV-1"
          }
        ]
      }
    };

    const sourceTargetPreflight = parseSourceTargetPreflightReport(
      JSON.stringify({
        schema_version: "1.0.0",
        summary: {
          requested_targets: 3,
          selected_targets: 2,
          checked_targets: 1,
          failed_targets: 1,
          skipped_targets: 0,
          planned_tasks: 1,
          fetched_documents: 1,
          normalized_documents: 1,
          degraded_documents: 0,
          observation_drafts: 2,
          semantic_sections: 2,
          by_source: { "fixture-ir": 1, "sec-edgar": 1 }
        },
        items: [
          {
            check_target_id: "plan:nvidia-memory-2025:sec-edgar:sec-company-filings:fixture",
            source_adapter_id: "sec-edgar",
            target_kind: "sec-company-filings",
            status: "checked",
            planned_tasks: 1,
            fetched_documents: 1,
            normalized_documents: 1,
            degraded_documents: 0,
            documents: [
              {
                task_id: "sec-edgar-fixture",
                source_url: "https://www.sec.gov/Archives/fixture/nvidia-10k.htm",
                doc_id: "DOC-FIXTURE",
                document_type: "10-K",
                source_date: "2026-02-25",
                text_chars: 1000,
                chunks: 2,
                observation_drafts: 2,
                semantic_sections: 2,
                observation_types: ["BACKLOG_OBSERVATION", "PROCUREMENT_OBSERVATION"],
                semantic_section_kinds: ["backlog", "procurement"]
              }
            ]
          },
          {
            check_target_id: "plan:nvidia-memory-2025:fixture-ir:official-html-disclosure:failed",
            source_adapter_id: "fixture-ir",
            target_kind: "official-html-disclosure",
            status: "failed",
            planned_tasks: 0,
            fetched_documents: 0,
            normalized_documents: 0,
            degraded_documents: 0,
            documents: [],
            issue_kind: "source_unreachable",
            error_message: "fixture source timeout"
          }
        ]
      })
    );

    const pack = buildResearchPackFromWorkbench({
      workbench,
      components: ["COMP-HBM"],
      depth: 3,
      generatedAt: "2026-05-23T00:00:00.000Z",
      sourceTargetNamespace: "nvidia-memory-2025",
      sourceTargetPreflight
    });
    expect(pack.manifest.mode).toBe("workbench_snapshot");
    expect(pack.manifest.generated_at).toBe("2026-05-23T00:00:00.000Z");
    expect(pack.source_target_coverage.generated_at).toBe("2026-05-23T00:00:00.000Z");
    expect(pack.question_readiness.generated_at).toBe("2026-05-23T00:00:00.000Z");
    expect(pack.observation_coverage.generated_at).toBe("2026-05-23T00:00:00.000Z");
    expect(pack.official_disclosure_readiness.generated_at).toBe("2026-05-23T00:00:00.000Z");
    expect(pack.supply_chain_expansion_plan.generated_at).toBe("2026-05-23T00:00:00.000Z");
    expect(pack.propagation_readiness.generated_at).toBe("2026-05-23T00:00:00.000Z");
    expect(pack.manifest.research_target_profile?.profile_id).toBe("ai-compute-memory.v0");
    expect(pack.manifest.stats.official_disclosure_target_nodes).toBe(39);
    expect(pack.manifest.stats.fact_edges).toBe(1);
    expect(pack.manifest.components).toEqual(["COMP-HBM", "COMP-MEMORY"]);
    const secTargets = pack.source_plan.find((item) => item.source_id === "sec-edgar")?.suggested_check_targets ?? [];
    expect(secTargets).toContainEqual(
      expect.objectContaining({
        source_adapter_id: "sec-edgar",
        target_kind: "sec-company-filings",
        runnable: true
      })
    );
    expect(secTargets.some((target) => target.target_config["cik"] === "0001045810" && target.target_config["entity_id"] === "ENT-NVIDIA")).toBe(true);
    expect(secTargets).toContainEqual(
      expect.objectContaining({
        source_adapter_id: "sec-edgar",
        target_kind: "sec-company-facts",
        runnable: true,
        target_config: {
          cik: "0001045810",
          entity_id: "ENT-NVIDIA",
          metrics: ["inventory", "cost_of_revenue", "capital_expenditures", "accounts_payable", "purchase_obligations", "revenue"],
          max_periods: 12
        }
      })
    );
    const censusTargets = pack.source_plan.find((item) => item.source_id === "census-trade")?.suggested_check_targets ?? [];
    const defaultWindowTradeTarget = censusTargets.find((target) => target.target_config["time"] === "2026-04");
    expect(defaultWindowTradeTarget?.source_adapter_id).toBe("census-trade");
    expect(defaultWindowTradeTarget?.target_kind).toBe("trade-flow-observation");
    expect(defaultWindowTradeTarget?.runnable).toBe(true);
    const samsungTargets = pack.source_plan.find((item) => item.source_id === "samsung-ir")?.suggested_check_targets ?? [];
    const defaultWindowOfficialTarget = samsungTargets.find((target) => target.target_config["year"] === 2025);
    expect(defaultWindowOfficialTarget?.source_adapter_id).toBe("samsung-ir");
    expect(defaultWindowOfficialTarget?.target_kind).toBe("official-html-disclosure");
    expect(defaultWindowOfficialTarget?.runnable).toBe(true);
    expect(pack.source_target_coverage.namespace).toBe("nvidia-memory-2025");
    expect(pack.source_target_coverage.summary.expected_targets).toBeGreaterThan(0);
    expect(pack.source_target_coverage.summary.not_synced).toBe(pack.source_target_coverage.summary.expected_targets);
    expect(pack.source_target_coverage.items.every((item) => item.state === "not_synced")).toBe(true);
    expect(pack.source_target_preflight?.summary.checked_targets).toBe(1);
    expect(pack.source_target_preflight?.summary.observation_drafts).toBe(2);
    expect(pack.source_target_preflight?.items[0]?.documents[0]?.observation_types).toEqual(["BACKLOG_OBSERVATION", "PROCUREMENT_OBSERVATION"]);
    expect(pack.source_target_preflight?.summary.by_source_status["sec-edgar"]).toEqual(
      expect.objectContaining({
        selected_targets: 1,
        checked_targets: 1,
        normalized_documents: 1,
        observation_drafts: 2,
        semantic_sections: 2,
        target_kinds: { "sec-company-filings": 1 }
      })
    );
    expect(pack.manifest.stats.source_target_preflight_selected_targets).toBe(2);
    expect(pack.manifest.stats.source_target_preflight_checked_targets).toBe(1);
    expect(pack.manifest.stats.source_target_preflight_failed_targets).toBe(1);
    expect(pack.manifest.stats.source_target_preflight_observation_drafts).toBe(2);
    expect(pack.manifest.stats.source_target_preflight_semantic_sections).toBe(2);
    expect(pack.manifest.stats.source_target_preflight_issue_kinds).toEqual({ source_unreachable: 1 });
    expect(renderSourceTargetPreflightMarkdown(sourceTargetPreflight)).toContain("Source Target Preflight");
    expect(renderSourceTargetPreflightMarkdown(sourceTargetPreflight)).toContain("Source Readiness Matrix");
    expect(renderSourceTargetPreflightMarkdown(sourceTargetPreflight)).toContain("Observation drafts: 2");
    expect(pack.manifest.stats.source_target_expected_targets).toBe(pack.source_target_coverage.summary.expected_targets);
    expect(pack.manifest.stats.observation_records).toBe(0);
    expect(pack.manifest.stats.observation_types_present).toBe(0);
    expect(pack.manifest.stats.official_disclosure_l4_l5_edges).toBe(1);
    expect(pack.manifest.stats.review_candidates).toBe(1);
    expect(pack.manifest.stats.official_disclosure_signal_review_candidates).toBe(1);
    expect(pack.manifest.stats.official_disclosure_signal_dispositions).toBe(1);
    expect(pack.manifest.stats.official_disclosure_signal_correlation_hints).toBeGreaterThan(0);
    expect(pack.manifest.stats.open_official_disclosure_signal_correlation_hints).toBe(0);
    expect(pack.manifest.stats.supply_chain_expansion_frontier_edges).toBe(1);
    expect(pack.manifest.stats.supply_chain_expansion_frontier_companies).toBe(1);
    expect(pack.manifest.stats.supply_chain_expansion_component_dependency_leads).toBeGreaterThan(0);
    expect(pack.manifest.stats.propagation_readiness_ready).toBe(pack.propagation_readiness.summary.ready);
    expect(pack.manifest.stats.propagation_reasoning_inputs).toBe(pack.propagation_readiness.summary.reasoning_inputs);
    expect(pack.manifest.stats.gate1_data_depth_items).toBe(pack.gate1_data_depth_workbench.summary.items);
    expect(pack.manifest.stats.gate1_data_depth_fact_edge_gap).toBe(pack.gate1_data_depth_workbench.summary.fact_edge_gap_to_target);
    expect(pack.gate1_data_depth_workbench.summary.l4_l5_fact_edges).toBe(1);
    expect(pack.gate1_data_depth_workbench.summary.fact_edge_target).toBe(100);
    expect(pack.gate1_data_depth_workbench.summary.by_workstream.fact_edge_growth).toBeGreaterThan(0);
    expect(pack.gate1_data_depth_workbench.summary.by_workstream.counterparty_corroboration).toBeGreaterThan(0);
    expect(pack.gate1_data_depth_workbench.items.every((item) => item.automatic_fact_mutation_allowed === false)).toBe(true);
    expect(pack.gate1_data_depth_workbench.items.every((item) => item.review_policy === "review_only_no_fact_mutation")).toBe(true);
    expect(pack.manifest.stats.investigation_backlog_propagation_readiness_items).toBe(
      pack.propagation_readiness.summary.partial + pack.propagation_readiness.summary.blocked
    );
    expect(pack.investigation_backlog.items.some((item) => item.kind === "propagation_readiness")).toBe(true);
    expect(pack.supply_chain_expansion_plan.frontier[0]).toEqual(
      expect.objectContaining({
        edge_id: "EDGE-1",
        expansion_state: "expand_candidate",
        next_company_id: "ENT-SKHYNIX"
      })
    );
    expect(pack.investigation_backlog.items.some((item) => item.kind === "supply_chain_expansion")).toBe(true);
    expect(pack.official_disclosure_readiness.official_disclosure_signals[0]?.review_id).toBe("REV-OFFICIAL-SIGNAL-1");
    expect(pack.official_disclosure_readiness.official_disclosure_signals[0]?.dispositions[0]).toEqual(
      expect.objectContaining({ decision: "needs_more_evidence", edge_id: "EDGE-1" })
    );
    expect(pack.official_disclosure_readiness.official_disclosure_signal_correlation_hints[0]).toEqual(
      expect.objectContaining({
        review_id: "REV-OFFICIAL-SIGNAL-1",
        edge_id: "EDGE-1",
        disposition_status: "recorded",
        recorded_decision: "needs_more_evidence",
        review_policy: "review_only_no_fact_mutation"
      })
    );
    expect(pack.official_disclosure_readiness.official_disclosure_signal_correlation_hints[0]?.match_reasons).toContain(
      "signal_source_matches_candidate_source"
    );
    expect(pack.manifest.stats.official_disclosure_traceable_edges).toBe(1);
    expect(pack.manifest.stats.official_disclosure_gate1_overall_progress).toBe(pack.official_disclosure_readiness.scorecard.overall_progress);
    expect(pack.manifest.stats.official_disclosure_corroboration_queue_items).toBe(pack.official_disclosure_readiness.summary.corroboration_queue_items);
    expect(pack.gate1_run_ledger.mainline_phase).toBe("resolve_corroboration");
    expect(pack.gate1_run_ledger.data_progress.fact_edge_gap).toBeGreaterThan(0);
    expect(pack.gate1_run_ledger.company_switching.next_research_targets[0]).toEqual(
      expect.objectContaining({
        company_id: "ENT-SKHYNIX",
        component_id: "COMP-MEMORY",
        seed_edge_id: "EDGE-1"
      })
    );
    expect(pack.gate1_run_ledger.company_switching.next_research_targets[0]?.command_hint).toContain("supplystrata research run --company ENT-SKHYNIX");
    expect(pack.official_disclosure_readiness.corroboration_queue.length).toBeGreaterThan(0);
    expect(pack.official_disclosure_readiness.scorecard.status).toBe("partial");
    expect(pack.official_disclosure_readiness.scorecard.criteria.map((criterion) => criterion.criterion_id)).toEqual([
      "core_node_official_coverage",
      "level_4_5_fact_edge_coverage",
      "corroboration_or_disposition_coverage",
      "fact_edge_traceability",
      "expected_source_path_coverage"
    ]);
    expect(pack.official_disclosure_readiness.summary.edges_with_strength).toBe(1);
    expect(pack.manifest.stats.question_readiness_partial).toBeGreaterThan(0);
    expect(pack.manifest.stats.investigation_backlog_items).toBeGreaterThan(0);
    expect(pack.manifest.stats.investigation_backlog_corroboration_reviews).toBeGreaterThan(0);
    expect(pack.manifest.stats.corroboration_source_plan_targets).toBe(pack.corroboration_source_plan.summary.runnable_targets);
    expect(pack.manifest.stats.corroboration_source_plan_next_actions).toEqual(pack.corroboration_source_plan.summary.by_next_action);
    expect(pack.corroboration_source_plan.target_refs.every((target) => target.edge_ids.length > 0)).toBe(true);
    expect(pack.question_readiness.items.some((item) => item.question_id === "company.upstream_dependencies" && item.status === "partial")).toBe(true);
    expect(renderQuestionReadinessMarkdown(pack.question_readiness)).toContain("company.upstream_dependencies");
    expect(renderInvestigationBacklogMarkdown(pack.investigation_backlog)).toContain("Investigation Backlog");
    expect(renderCorroborationSourcePlanMarkdown(pack.corroboration_source_plan)).toContain("Corroboration Source Plan");
    expect(renderSourceTargetCoverageMarkdown(pack.source_target_coverage)).toContain("Not synced");
    expect(renderSourceTargetCoverageMarkdown(pack.source_target_coverage)).toContain("Total observations: 0");
    expect(renderOfficialDisclosureReadinessMarkdown(pack.official_disclosure_readiness)).toContain("Level 4/5 fact edges: 1/100");
    expect(renderOfficialDisclosureReadinessMarkdown(pack.official_disclosure_readiness)).toContain("Gate 1 scorecard");
    expect(renderOfficialDisclosureReadinessMarkdown(pack.official_disclosure_readiness)).toContain("Corroboration queue");
    expect(renderOfficialDisclosureReadinessMarkdown(pack.official_disclosure_readiness)).toContain("Official disclosure signal correlation hints");
    expect(renderOfficialDisclosureReadinessMarkdown(pack.official_disclosure_readiness)).toContain("Target profile: ai-compute-memory.v0");
    expect(renderSupplyChainExpansionPlanMarkdown(pack.supply_chain_expansion_plan)).toContain("Supply Chain Expansion Plan");
    expect(renderPropagationReadinessMarkdown(pack.propagation_readiness)).toContain("Propagation Readiness");
    expect(renderGate1DataDepthWorkbenchMarkdown(pack.gate1_data_depth_workbench)).toContain("Gate 1 Data Depth Workbench");
    expect(renderGate1DataDepthWorkbenchMarkdown(pack.gate1_data_depth_workbench)).toContain("automatic fact mutation: false");
    const p0Batch = buildGate1DataDepthActionBatch(pack.gate1_data_depth_workbench, gate1DataDepthActionBatchDefinition("p0"));
    const corroborationBatch = buildGate1DataDepthActionBatch(pack.gate1_data_depth_workbench, gate1DataDepthActionBatchDefinition("corroboration"));
    expect(p0Batch.summary.items).toBe(pack.gate1_data_depth_workbench.items.filter((item) => item.priority === "P0").length);
    expect(p0Batch.automatic_fact_mutation_allowed).toBe(false);
    expect(p0Batch.items.every((item) => item.review_policy === "review_only_no_fact_mutation")).toBe(true);
    expect(p0Batch.items.every((item) => item.allowed_decisions.length > 0)).toBe(true);
    expect(p0Batch.items.every((item) => item.write_impact.length > 0)).toBe(true);
    expect(corroborationBatch.summary.by_workstream.counterparty_corroboration).toBe(corroborationBatch.summary.items);
    expect(corroborationBatch.items.every((item) => item.workstream === "counterparty_corroboration")).toBe(true);
    expect(corroborationBatch.items.every((item) => item.recommended_decision === "record_corroboration_disposition")).toBe(true);
    expect(corroborationBatch.items.every((item) => item.frontend_action_kind === "review_counterparty_corroboration")).toBe(true);
  });
});
