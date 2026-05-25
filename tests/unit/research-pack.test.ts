import { describe, expect, it } from "vitest";
import {
  buildCorroborationSourcePlan,
  buildCorroborationSourcePlanActionBatch,
  buildInvestigationBacklog,
  buildObservationCoverageReport,
  buildOfficialDisclosureReadinessReport,
  buildPropagationReadinessReport,
  buildResearchPackFromWorkbench,
  buildSupplyChainExpansionPlan,
  getBuiltInResearchTargetProfile,
  listBuiltInResearchTargetProfiles,
  parseSourceTargetPreflightReport,
  renderInvestigationBacklogMarkdown,
  renderCorroborationSourcePlanMarkdown,
  renderObservationCoverageMarkdown,
  renderOfficialDisclosureReadinessMarkdown,
  renderPropagationReadinessMarkdown,
  renderQuestionReadinessMarkdown,
  renderSourceTargetPreflightMarkdown,
  renderSourceTargetCoverageMarkdown,
  renderSupplyChainExpansionPlanMarkdown
} from "@supplystrata/research-pack";
import { buildSourcePolicyConfigFromPlanTargets, parseManagedSourcePlanDocument } from "@supplystrata/source-management";
import {
  actionBatchDefinition,
  edgeFixture,
  edgeSegmentFixture,
  emptyWorkbench,
  evidenceFixture,
  observationFixture,
  officialSourceTargetCoverage,
  readyQuestionReadiness
} from "./research-pack-fixtures.js";
import type { ChainViewSegmentModel } from "@supplystrata/chain-view";
import type { WorkbenchModel } from "@supplystrata/workbench-export";
import type { InvestigationBacklog, ObservationCoverageReport, QuestionReadinessMatrix, SourceTargetCoverageReport } from "@supplystrata/research-pack";
import type { SourcePlanItem } from "@supplystrata/source-plan";

describe("research-pack", () => {
  it("builds a deterministic recursive expansion plan without creating fact edges", () => {
    const workbench = {
      ...emptyWorkbench(),
      companies: [
        { entity_id: "ENT-NVIDIA", name: "NVIDIA", role: "root" as const },
        { entity_id: "ENT-SKHYNIX", name: "SK Hynix", role: "counterparty" as const },
        { entity_id: "ENT-UNKNOWN", name: "Unknown Counterparty", role: "counterparty" as const },
        { entity_id: "ENT-DEEP", name: "Deep Supplier", role: "counterparty" as const }
      ],
      chain_segments: [
        edgeSegmentFixture("EDGE-MEMORY", 1, "ENT-NVIDIA", "NVIDIA", "ENT-SKHYNIX", "SK Hynix", "COMP-MEMORY"),
        edgeSegmentFixture("EDGE-NOCOMP", 1, "ENT-NVIDIA", "NVIDIA", "ENT-UNKNOWN", "Unknown Counterparty", null),
        edgeSegmentFixture("EDGE-DEEP", 7, "ENT-SKHYNIX", "SK Hynix", "ENT-DEEP", "Deep Supplier", "COMP-HBM")
      ],
      edges: [
        edgeFixture("EDGE-MEMORY", "ENT-NVIDIA", "NVIDIA", "ENT-SKHYNIX", "SK Hynix", "COMP-MEMORY"),
        edgeFixture("EDGE-NOCOMP", "ENT-NVIDIA", "NVIDIA", "ENT-UNKNOWN", "Unknown Counterparty", null),
        edgeFixture("EDGE-DEEP", "ENT-SKHYNIX", "SK Hynix", "ENT-DEEP", "Deep Supplier", "COMP-HBM")
      ],
      unknown_items: [
        {
          unknown_id: "UNK-MEMORY-SHARE",
          scope_kind: "edge",
          scope_id: "EDGE-MEMORY",
          question: "What share does this memory relationship represent?",
          why_unknown: "No allocation disclosure is visible.",
          blocking_data_sources: ["supplier official disclosure"],
          proxies: [],
          status: "open"
        }
      ]
    };

    const plan = buildSupplyChainExpansionPlan({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench,
      component_ids: ["COMP-MEMORY"],
      source_plan: [officialSourcePlanItem()],
      max_depth: 7
    });

    expect(plan.summary).toEqual(
      expect.objectContaining({
        fact_edges_considered: 3,
        frontier_edges: 3,
        blocked_frontier_edges: 2,
        explicit_unknown_refs: 1
      })
    );
    expect(plan.frontier.find((item) => item.edge_id === "EDGE-MEMORY")).toEqual(
      expect.objectContaining({
        expansion_state: "expand_candidate",
        next_company_id: "ENT-SKHYNIX",
        unknown_ids: ["UNK-MEMORY-SHARE"]
      })
    );
    expect(plan.frontier.find((item) => item.edge_id === "EDGE-NOCOMP")?.expansion_state).toBe("needs_component_context");
    expect(plan.frontier.find((item) => item.edge_id === "EDGE-DEEP")?.expansion_state).toBe("stop_depth_limit");
    expect(plan.component_dependency_leads.find((lead) => lead.dependency_id === "CDEP-MEMORY-DRAM")).toEqual(
      expect.objectContaining({
        state: "source_path_runnable",
        expansion_policy: "lead_only_no_fact_mutation",
        source_plan_refs: ["source_plan:samsung-ir"]
      })
    );
    expect(plan.component_dependency_leads.find((lead) => lead.dependency_id === "CDEP-MEMORY-HBM")?.state).toBe("fact_covered");
    expect(plan.stop_conditions.map((item) => item.reason)).toEqual(expect.arrayContaining(["depth_limit", "missing_component_context"]));
    expect(renderSupplyChainExpansionPlanMarkdown(plan)).toContain("does not create fact edges");
    expect(renderSupplyChainExpansionPlanMarkdown(plan)).toContain("COMP-MEMORY -> COMP-DRAM");
  });

  it("builds propagation readiness as reasoning inputs without fact mutation", () => {
    const workbench = {
      ...emptyWorkbench(),
      companies: [
        { entity_id: "ENT-NVIDIA", name: "NVIDIA", role: "root" as const },
        { entity_id: "ENT-SKHYNIX", name: "SK Hynix", role: "counterparty" as const }
      ],
      chain_segments: [edgeSegmentFixture("EDGE-MEMORY", 1, "ENT-NVIDIA", "NVIDIA", "ENT-SKHYNIX", "SK Hynix", "COMP-MEMORY")],
      edges: [edgeFixture("EDGE-MEMORY", "ENT-NVIDIA", "NVIDIA", "ENT-SKHYNIX", "SK Hynix", "COMP-MEMORY")]
    };
    const observationCoverage = buildObservationCoverageReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench,
      company: {
        related_observations: [
          observationFixture("OBS-BACKLOG", "BACKLOG_OBSERVATION", {
            metric_name: "backlog",
            time_window_end: "2025-12-31T00:00:00.000Z"
          }),
          observationFixture("OBS-CAPEX", "CAPEX_OBSERVATION", {
            metric_name: "capex",
            time_window_end: "2025-12-31T00:00:00.000Z"
          }),
          observationFixture("OBS-COPPER", "COMMODITY_PRICE_OBSERVATION", {
            scope_kind: "material",
            scope_id: "MAT-COPPER",
            metric_name: "copper_price",
            metric_unit: "USD/t",
            time_window_end: "2025-12-31T00:00:00.000Z"
          })
        ]
      },
      components: []
    });
    const sourcePlan = [officialSourcePlanItem(), commoditySourcePlanItem()];
    const expansionPlan = buildSupplyChainExpansionPlan({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench,
      component_ids: ["COMP-MEMORY", "COMP-WAFER"],
      source_plan: sourcePlan,
      max_depth: 7
    });

    const report = buildPropagationReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench,
      observation_coverage: observationCoverage,
      source_plan: sourcePlan,
      supply_chain_expansion_plan: expansionPlan
    });

    expect(report.summary.contexts_total).toBe(7);
    expect(report.summary.no_fact_mutation_policy).toBe("reasoning_input_only_no_fact_mutation");
    expect(report.items.find((item) => item.context_kind === "demand_signal")).toEqual(
      expect.objectContaining({
        status: "ready",
        policy: "reasoning_input_only_no_fact_mutation",
        observation_types: ["BACKLOG_OBSERVATION"]
      })
    );
    expect(report.items.find((item) => item.context_kind === "process_material_consumption_signal")).toEqual(
      expect.objectContaining({
        status: "ready",
        policy: "reasoning_input_only_no_fact_mutation"
      })
    );
    expect(report.items.find((item) => item.context_kind === "policy_or_export_control_signal")?.status).toBe("blocked");
    expect(renderPropagationReadinessMarkdown(report)).toContain("does not create fact edges");
    expect(renderPropagationReadinessMarkdown(report)).toContain("process_material_consumption_signal");
  });

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
                chunks: 2
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
    expect(pack.manifest.stats.official_disclosure_target_nodes).toBe(25);
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
    expect(pack.source_target_coverage.namespace).toBe("nvidia-memory-2025");
    expect(pack.source_target_coverage.summary.expected_targets).toBeGreaterThan(0);
    expect(pack.source_target_coverage.summary.not_synced).toBe(pack.source_target_coverage.summary.expected_targets);
    expect(pack.source_target_coverage.items.every((item) => item.state === "not_synced")).toBe(true);
    expect(pack.source_target_preflight?.summary.checked_targets).toBe(1);
    expect(pack.source_target_preflight?.summary.by_source_status["sec-edgar"]).toEqual(
      expect.objectContaining({
        selected_targets: 1,
        checked_targets: 1,
        normalized_documents: 1,
        target_kinds: { "sec-company-filings": 1 }
      })
    );
    expect(pack.manifest.stats.source_target_preflight_selected_targets).toBe(2);
    expect(pack.manifest.stats.source_target_preflight_checked_targets).toBe(1);
    expect(pack.manifest.stats.source_target_preflight_failed_targets).toBe(1);
    expect(pack.manifest.stats.source_target_preflight_issue_kinds).toEqual({ source_unreachable: 1 });
    expect(renderSourceTargetPreflightMarkdown(sourceTargetPreflight)).toContain("Source Target Preflight");
    expect(renderSourceTargetPreflightMarkdown(sourceTargetPreflight)).toContain("Source Readiness Matrix");
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
    expect(renderOfficialDisclosureReadinessMarkdown(pack.official_disclosure_readiness)).toContain("Level 4/5 fact edges: 1/100");
    expect(renderOfficialDisclosureReadinessMarkdown(pack.official_disclosure_readiness)).toContain("Gate 1 scorecard");
    expect(renderOfficialDisclosureReadinessMarkdown(pack.official_disclosure_readiness)).toContain("Corroboration queue");
    expect(renderOfficialDisclosureReadinessMarkdown(pack.official_disclosure_readiness)).toContain("Official disclosure signal correlation hints");
    expect(renderOfficialDisclosureReadinessMarkdown(pack.official_disclosure_readiness)).toContain("Target profile: ai-compute-memory.v0");
    expect(renderSupplyChainExpansionPlanMarkdown(pack.supply_chain_expansion_plan)).toContain("Supply Chain Expansion Plan");
    expect(renderPropagationReadinessMarkdown(pack.propagation_readiness)).toContain("Propagation Readiness");
  });

  it("reports official disclosure readiness gaps without inferring corroboration from silence", () => {
    const workbench = emptyWorkbench();
    const edge = {
      edge_id: "EDGE-OFFICIAL-1",
      from_id: "ENT-NVIDIA",
      from_name: "NVIDIA",
      to_id: "ENT-MICRON",
      to_name: "Micron",
      relation: "BUYS_FROM" as const,
      component: "memory",
      component_id: "COMP-MEMORY",
      evidence_level: 5 as const,
      confidence: 0.95,
      evidence_ids: ["EV-OFFICIAL-1"]
    };
    const report = buildOfficialDisclosureReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      component_ids: ["COMP-MEMORY"],
      source_plan: [officialSourcePlanItem()],
      source_target_coverage: officialSourceTargetCoverage("due"),
      workbench: {
        ...workbench,
        companies: [
          { entity_id: "ENT-NVIDIA", name: "NVIDIA", role: "root" },
          { entity_id: "ENT-MICRON", name: "Micron", role: "counterparty" }
        ],
        edges: [edge],
        evidences: [
          evidenceFixture("EV-OFFICIAL-1", {
            edge_id: "EDGE-OFFICIAL-1",
            evidence_level: 5,
            source_adapter_id: "sec-edgar",
            source_url: "https://www.sec.gov/Archives/fixture/nvidia-10k.htm",
            cite_text_sha256: "abc123"
          })
        ],
        intelligence: { edge_strengths: [], edge_freshness: [] }
      }
    });

    expect(report.summary.level_4_5_fact_edges).toBe(1);
    expect(report.summary.traceable_edges).toBe(1);
    expect(report.summary.cross_source_edges).toBe(0);
    expect(report.summary.single_source_edges).toBe(1);
    expect(report.summary.corroboration_queue_items).toBe(1);
    expect(report.summary.corroboration_queue_needing_disposition).toBe(1);
    expect(report.summary.corroboration_queue_with_recorded_disposition).toBe(0);
    expect(report.summary.corroboration_queue_proposed_unknowns).toBe(1);
    const [queueItem] = report.corroboration_queue;
    expect(queueItem?.edge_id).toBe("EDGE-OFFICIAL-1");
    expect(queueItem?.disposition).toBe("needs_explicit_single_source_disposition");
    expect(queueItem?.existing_source_adapters).toEqual(["sec-edgar"]);
    expect(queueItem?.unknown_ids).toEqual([]);
    expect(queueItem?.proposed_unknown?.scope_kind).toBe("edge");
    expect(queueItem?.proposed_unknown?.scope_id).toBe("EDGE-OFFICIAL-1");
    expect(queueItem?.proposed_unknown?.created_by).toBe("official-disclosure-readiness.single-source-disposition.v1");
    expect(report.summary.visible_research_nodes).toBe(5);
    expect(report.summary.nodes_with_fact_edges).toBe(3);
    expect(report.summary.nodes_with_runnable_official_targets).toBe(2);
    expect(report.summary.runnable_official_targets).toBe(1);
    expect(report.scorecard.criteria.find((criterion) => criterion.criterion_id === "fact_edge_traceability")).toEqual(
      expect.objectContaining({ status: "pass", measured: 1, target: 1, progress: 1 })
    );
    expect(report.scorecard.criteria.find((criterion) => criterion.criterion_id === "level_4_5_fact_edge_coverage")).toEqual(
      expect.objectContaining({ status: "partial", measured: 1, target: 100, progress: 0.01 })
    );
    expect(report.summary.synced_official_targets).toBe(1);
    expect(report.summary.due_official_targets).toBe(1);
    expect(report.source_plan_items[0]?.source_targets[0]?.state).toBe("due");
    expect(report.nodes.find((node) => node.node_id === "COMP-DRAM")?.coverage_state).toBe("official_target_synced");
    expect(report.nodes.find((node) => node.node_id === "ENT-SAMSUNG-ELECTRONICS")?.coverage_state).toBe("official_target_synced");
    expect(report.gaps.map((gap) => gap.kind)).toContain("corroboration_or_disposition_coverage");
    expect(report.gaps.map((gap) => gap.kind)).toContain("edge_strength");
    expect(report.gaps.find((gap) => gap.kind === "level_4_5_edge_coverage")?.action).toContain("Run due official disclosure targets");
    expect(renderOfficialDisclosureReadinessMarkdown(report)).toContain("Add second-source corroboration or explicit single-source disposition");
    expect(renderOfficialDisclosureReadinessMarkdown(report)).toContain("Proposed unknown: UNK-EDGE-CORROB-");
    expect(renderOfficialDisclosureReadinessMarkdown(report)).toContain("samsung-ir/official-html-disclosure=due");
    expect(renderOfficialDisclosureReadinessMarkdown(report)).toContain("Node coverage");
  });

  it("distinguishes recorded single-source dispositions from missing disposition unknowns", () => {
    const edge = {
      edge_id: "EDGE-SINGLE-SOURCE-1",
      from_id: "ENT-NVIDIA",
      from_name: "NVIDIA",
      to_id: "ENT-CUSTOM",
      to_name: "Custom Supplier",
      relation: "BUYS_FROM" as const,
      component: "custom",
      component_id: "COMP-CUSTOM",
      evidence_level: 5 as const,
      confidence: 0.95,
      evidence_ids: ["EV-SINGLE-SOURCE-1"]
    };
    const report = buildOfficialDisclosureReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      component_ids: ["COMP-CUSTOM"],
      workbench: {
        ...emptyWorkbench(),
        companies: [
          { entity_id: "ENT-NVIDIA", name: "NVIDIA", role: "root" },
          { entity_id: "ENT-CUSTOM", name: "Custom Supplier", role: "counterparty" }
        ],
        edges: [edge],
        evidences: [
          evidenceFixture("EV-SINGLE-SOURCE-1", {
            edge_id: "EDGE-SINGLE-SOURCE-1",
            evidence_level: 5,
            source_adapter_id: "sec-edgar",
            source_url: "https://www.sec.gov/Archives/fixture/nvidia-10k.htm",
            cite_text_sha256: "abc123"
          })
        ],
        unknown_items: [
          {
            unknown_id: "UNK-SINGLE-SOURCE-DISPOSITION-1",
            scope_kind: "edge",
            scope_id: "EDGE-SINGLE-SOURCE-1",
            question: "Can this relationship be corroborated by a second-source official disclosure?",
            why_unknown: "This fact edge is currently single-source; no counterparty official disclosure path is visible.",
            blocking_data_sources: ["single-source disposition"],
            proxies: ["manual disposition"],
            status: "open"
          }
        ],
        intelligence: { edge_strengths: [], edge_freshness: [] }
      }
    });

    expect(report.summary.corroboration_queue_items).toBe(1);
    expect(report.summary.corroboration_queue_needing_disposition).toBe(0);
    expect(report.summary.corroboration_queue_with_recorded_disposition).toBe(1);
    expect(report.summary.corroboration_or_disposition_edges).toBe(1);
    expect(report.summary.corroboration_or_disposition_ratio).toBe(1);
    expect(report.summary.corroboration_queue_proposed_unknowns).toBe(0);
    expect(report.corroboration_queue[0]).toEqual(
      expect.objectContaining({
        edge_id: "EDGE-SINGLE-SOURCE-1",
        disposition: "single_source_disposition_recorded",
        unknown_ids: ["UNK-SINGLE-SOURCE-DISPOSITION-1"],
        proposed_unknown: null
      })
    );
    expect(renderOfficialDisclosureReadinessMarkdown(report)).toContain("single_source_disposition_recorded");
    expect(renderOfficialDisclosureReadinessMarkdown(report)).toContain("UNK-SINGLE-SOURCE-DISPOSITION-1");
  });

  it("measures official disclosure coverage against an explicit target node set", () => {
    const report = buildOfficialDisclosureReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      component_ids: [],
      target_nodes: [
        {
          node_id: "ENT-SAMSUNG-ELECTRONICS",
          node_kind: "company",
          name: "Samsung Electronics",
          priority: "P0",
          expected_source_ids: ["samsung-ir"]
        },
        { node_id: "COMP-DRAM", node_kind: "component", priority: "P0", expected_source_ids: ["samsung-ir"] },
        { node_id: "COMP-HBM", node_kind: "component", priority: "P0", expected_source_ids: ["skhynix-ir", "micron-ir"] }
      ],
      source_plan: [officialSourcePlanItem()],
      source_target_coverage: officialSourceTargetCoverage("due"),
      workbench: {
        ...emptyWorkbench(),
        intelligence: { edge_strengths: [], edge_freshness: [] }
      }
    });

    expect(report.targets.core_nodes).toBe(3);
    expect(report.summary.target_research_nodes).toBe(3);
    expect(report.summary.target_nodes_missing_official_coverage).toBe(1);
    expect(report.summary.target_nodes_with_runnable_official_targets).toBe(2);
    expect(report.summary.expected_official_source_links).toBe(4);
    expect(report.summary.expected_official_source_links_with_coverage).toBe(2);
    expect(report.summary.expected_official_source_links_runnable).toBe(2);
    expect(report.summary.expected_official_source_links_connector_available).toBe(2);
    expect(report.summary.expected_official_source_links_unimplemented).toBe(0);
    expect(report.expected_source_coverage).toEqual([
      expect.objectContaining({
        node_id: "COMP-HBM",
        expected_source_id: "micron-ir",
        coverage_state: "connector_available"
      }),
      expect.objectContaining({
        node_id: "COMP-HBM",
        expected_source_id: "skhynix-ir",
        coverage_state: "connector_available"
      }),
      expect.objectContaining({
        node_id: "ENT-SAMSUNG-ELECTRONICS",
        expected_source_id: "samsung-ir",
        coverage_state: "official_target_synced"
      }),
      expect.objectContaining({
        node_id: "COMP-DRAM",
        expected_source_id: "samsung-ir",
        coverage_state: "official_target_synced"
      })
    ]);
    expect(report.gates.find((gate) => gate.gate_id === "official_disclosure.core_nodes")).toEqual(
      expect.objectContaining({ measured: 2, target: 3, status: "partial" })
    );
    expect(report.scorecard.data_progress).toBeGreaterThan(0);
    expect(report.scorecard.source_path_progress).toBe(0.5);
    expect(report.gaps.find((gap) => gap.kind === "expected_official_source_coverage")).toEqual(
      expect.objectContaining({
        priority: "P0",
        source_adapters: ["micron-ir", "skhynix-ir"]
      })
    );
    expect(report.nodes.find((node) => node.node_id === "COMP-HBM")).toEqual(
      expect.objectContaining({
        is_target_node: true,
        coverage_state: "missing",
        expected_source_ids: ["micron-ir", "skhynix-ir"]
      })
    );
    expect(renderOfficialDisclosureReadinessMarkdown(report)).toContain("Explicit target nodes: 3 supplied; 1 missing");
    expect(renderOfficialDisclosureReadinessMarkdown(report)).toContain("Expected official source links: 2/4 covered");
    expect(renderOfficialDisclosureReadinessMarkdown(report)).toContain("connector_available COMP-HBM via micron-ir");
    expect(renderOfficialDisclosureReadinessMarkdown(report)).toContain("[target] COMP-HBM");
  });

  it("keeps built-in research target profiles deterministic and reviewable", () => {
    const profiles = listBuiltInResearchTargetProfiles();
    const profile = getBuiltInResearchTargetProfile("ai-compute-memory.v0");

    expect(profiles.map((item) => item.profile_id)).toEqual(["ai-compute-memory.v0"]);
    expect(profile.target_nodes).toHaveLength(25);
    expect(profile.target_nodes.find((node) => node.node_id === "ENT-NVIDIA")).toEqual(
      expect.objectContaining({ priority: "P0", expected_source_ids: ["sec-edgar"] })
    );
    expect(profile.target_nodes.find((node) => node.node_id === "ENT-MICROSOFT")).toEqual(
      expect.objectContaining({ priority: "P0", expected_source_ids: ["sec-edgar"] })
    );
    expect(profile.target_nodes.find((node) => node.node_id === "ENT-AMAZON")).toEqual(
      expect.objectContaining({ priority: "P0", expected_source_ids: ["sec-edgar"] })
    );
    expect(profile.target_nodes.find((node) => node.node_id === "COMP-SERVER")).toEqual(
      expect.objectContaining({ priority: "P0", expected_source_ids: ["sec-edgar", "company-ir"] })
    );
    expect(profile.target_nodes.find((node) => node.node_id === "COMP-HBM")).toEqual(
      expect.objectContaining({ priority: "P0", expected_source_ids: ["skhynix-ir", "samsung-ir", "micron-ir"] })
    );
    expect(profile.target_nodes.find((node) => node.node_id === "ENT-FOXCONN")).toEqual(
      expect.objectContaining({ priority: "P1", expected_source_ids: ["company-ir", "twse-mops"] })
    );
    const foxconnTarget = profile.target_nodes
      .find((node) => node.node_id === "ENT-FOXCONN")
      ?.expected_source_targets?.find((target) => target.source_id === "twse-mops");
    const waferNode = profile.target_nodes.find((node) => node.node_id === "COMP-SILICON-WAFER");
    const edinetTarget = waferNode?.expected_source_targets?.find((target) => target.source_id === "edinet");

    expect(foxconnTarget).toEqual(
      expect.objectContaining({
        source_id: "twse-mops",
        target_kind: "electronic-documents"
      })
    );
    expect(foxconnTarget?.target_config).toEqual({
      stock_code: "2317",
      entity_id: "ENT-FOXCONN",
      year: 2025,
      document_kind: "F",
      limit: 50
    });
    expect(waferNode).toEqual(expect.objectContaining({ priority: "P1", expected_source_ids: ["company-ir", "edinet"] }));
    expect(edinetTarget).toEqual(
      expect.objectContaining({
        source_id: "edinet",
        target_kind: "daily-filings"
      })
    );
    expect(edinetTarget?.target_config).toEqual({
      date: "2025-06-30",
      type: 2,
      scope_kind: "component",
      scope_id: "COMP-SILICON-WAFER",
      component_id: "COMP-SILICON-WAFER",
      doc_type_codes: ["120"]
    });
  });

  it("reports discovered nodes outside a target profile as expansion candidates", () => {
    const report = buildOfficialDisclosureReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      component_ids: ["COMP-MEMORY"],
      target_nodes: [{ node_id: "ENT-NVIDIA", node_kind: "company", name: "NVIDIA", priority: "P0", expected_source_ids: ["sec-edgar"] }],
      target_profile: {
        profile_id: "fixture-profile",
        title: "Fixture profile",
        version: "0.1.0",
        description: "Fixture profile for expansion testing.",
        selection_reason: "test"
      },
      workbench: {
        ...emptyWorkbench(),
        companies: [
          { entity_id: "ENT-NVIDIA", name: "NVIDIA", role: "root" },
          { entity_id: "ENT-MICRON", name: "Micron", role: "counterparty" }
        ],
        edges: [
          {
            edge_id: "EDGE-MICRON",
            from_id: "ENT-NVIDIA",
            from_name: "NVIDIA",
            to_id: "ENT-MICRON",
            to_name: "Micron",
            relation: "BUYS_FROM",
            component: "memory",
            component_id: "COMP-MEMORY",
            evidence_level: 5,
            confidence: 0.95,
            evidence_ids: ["EV-MICRON"]
          }
        ],
        evidences: [
          evidenceFixture("EV-MICRON", {
            edge_id: "EDGE-MICRON",
            evidence_level: 5,
            source_adapter_id: "sec-edgar",
            source_url: "https://www.sec.gov/Archives/fixture/nvidia-10k.htm",
            cite_text_sha256: "abc123"
          })
        ],
        intelligence: { edge_strengths: [], edge_freshness: [] }
      }
    });

    expect(report.profile_expansion_candidates.map((candidate) => candidate.node_id)).toEqual(["ENT-MICRON", "COMP-MEMORY"]);
    expect(report.profile_expansion_candidates[0]).toEqual(
      expect.objectContaining({
        suggested_priority: "P1",
        reason: "Visible Level 4/5 fact coverage exists outside the current target profile."
      })
    );
    const backlog = buildInvestigationBacklog({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench: emptyWorkbench(),
      components: [],
      source_plan: [],
      question_readiness: readyQuestionReadiness(),
      official_disclosure_readiness: report
    });
    expect(backlog.items.find((item) => item.kind === "profile_expansion" && item.title.includes("ENT-MICRON"))).toEqual(
      expect.objectContaining({
        priority: "P1",
        title: "Review profile expansion candidate ENT-MICRON"
      })
    );
    expect(renderOfficialDisclosureReadinessMarkdown(report)).toContain("Profile expansion candidates: 2");
    expect(renderOfficialDisclosureReadinessMarkdown(report)).toContain("ENT-MICRON");
  });

  it("summarizes typed observation coverage without upgrading signals into facts", () => {
    const financial = observationFixture("OBS-FIN", "FINANCIAL_METRIC_OBSERVATION", {
      source_adapter_id: "sec-edgar",
      source_item_id: "SRCITEM-1",
      doc_id: "DOC-SEC",
      scope_kind: "company",
      scope_id: "ENT-MICRON",
      metric_name: "revenue",
      metric_value: "30391000000",
      metric_unit: "USD",
      time_window_end: "2025-08-28T00:00:00.000Z",
      baseline_value: "8440000000",
      change_percent: 260.08,
      anomaly: { is_anomaly: true, method: "observation-anomaly.baseline-change-percent.v1" }
    });
    const trade = observationFixture("OBS-TRADE", "TRADE_FLOW_OBSERVATION", {
      source_adapter_id: "census-trade",
      scope_kind: "component",
      scope_id: "COMP-MEMORY",
      component_id: "COMP-MEMORY",
      geography_kind: "country",
      geography_id: "KR",
      metric_name: "imports_value_usd",
      metric_value: "1000000",
      metric_unit: "USD"
    });
    const inventory = observationFixture("OBS-INV", "INVENTORY_OBSERVATION", {
      source_adapter_id: "official-disclosure",
      scope_kind: "component",
      scope_id: "COMP-MEMORY",
      component_id: "COMP-MEMORY",
      metric_name: "official_inventory_mention",
      metric_value: "1",
      metric_unit: null
    });

    const report = buildObservationCoverageReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench: {
        chain_segments: [
          {
            semantic_layer: "observation",
            observation_id: "OBS-TRADE",
            component_id: "COMP-MEMORY"
          }
        ]
      },
      company: {
        related_observations: [financial]
      },
      components: [
        {
          component: { component_id: "COMP-MEMORY", name: "memory" },
          related_observations: [trade, inventory],
          linked_company_observations: [
            {
              entity_id: "ENT-MICRON",
              entity_name: "Micron",
              role: "supplier",
              observations: [financial]
            }
          ]
        }
      ]
    });

    expect(report.summary.typed_observations).toBe(3);
    expect(report.summary.chain_observation_segments).toBe(1);
    expect(report.summary.observation_types_present).toBe(3);
    expect(report.summary.observation_series).toBe(3);
    expect(report.summary.explicit_baseline_ready).toBe(1);
    expect(report.summary.sparse_series).toBe(2);
    expect(report.types.map((item) => item.observation_type)).toEqual(["FINANCIAL_METRIC_OBSERVATION", "INVENTORY_OBSERVATION", "TRADE_FLOW_OBSERVATION"]);
    expect(report.types.find((item) => item.observation_type === "FINANCIAL_METRIC_OBSERVATION")?.contexts).toEqual([
      expect.objectContaining({ kind: "company_card" }),
      expect.objectContaining({ kind: "linked_company" })
    ]);
    expect(report.gaps.some((gap) => gap.observation_type === "PORT_ACTIVITY_OBSERVATION")).toBe(true);
    expect(renderObservationCoverageMarkdown(report)).toContain("Observation types present: 3/14");
    expect(renderObservationCoverageMarkdown(report)).toContain("Explicit-baseline ready: 1");
    expect(renderObservationCoverageMarkdown(report)).toContain("TRADE_FLOW_OBSERVATION: 1");
  });

  it("marks comparable numeric observation series as time-series ready", () => {
    const report = buildObservationCoverageReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench: { chain_segments: [] },
      company: {
        related_observations: Array.from({ length: 6 }, (_, index) =>
          observationFixture(`OBS-REV-${index}`, "FINANCIAL_METRIC_OBSERVATION", {
            source_adapter_id: "sec-edgar",
            scope_kind: "company",
            scope_id: "ENT-NVIDIA",
            metric_name: "revenue",
            metric_value: String(100 + index),
            metric_unit: "USD",
            time_window_end: `2026-0${index + 1}-28T00:00:00.000Z`
          })
        )
      },
      components: []
    });

    expect(report.summary.observation_series).toBe(1);
    expect(report.summary.time_series_ready).toBe(1);
    expect(report.series[0]).toEqual(
      expect.objectContaining({
        status: "time_series_ready",
        observations: 6,
        numeric_points: 6,
        windowed_points: 6
      })
    );
  });

  it("uses source target coverage to make backlog actions operational", () => {
    const sourcePlan: SourcePlanItem[] = [
      {
        source_id: "samsung-ir",
        source_name: "Samsung Electronics Investor Relations",
        purpose: "official_disclosure",
        priority: "P0",
        status: "preview",
        automation: "allowed",
        requires_key: false,
        expected_output_layer: "edge",
        relation_policy: "can_create_fact_edge",
        parent_component_ids: ["COMP-MEMORY"],
        target_ids: ["COMP-DRAM"],
        trigger_dependency_ids: ["CDEP-MEMORY-DRAM"],
        reasons: ["Samsung IR can disclose memory supplier context."],
        suggested_check_targets: [
          {
            source_adapter_id: "samsung-ir",
            target_kind: "official-html-disclosure",
            runnable: true,
            target_config: { entity_id: "ENT-SAMSUNG-ELECTRONICS", year: 2025 },
            reason: "Samsung IR has a registered official disclosure connector for 2025."
          }
        ]
      }
    ];
    const coverage: SourceTargetCoverageReport = {
      schema_version: "1.0.0",
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      namespace: "nvidia-memory-2025",
      summary: {
        expected_targets: 1,
        synced_targets: 1,
        not_synced: 0,
        enabled_targets: 0,
        due_targets: 0,
        active_jobs: 0,
        retry_wait: 0,
        degraded_targets: 0,
        dead_targets: 0,
        source_failed_targets: 0,
        source_failure_kinds: {
          missing_credentials: 0,
          target_config_invalid: 0,
          source_unreachable: 0,
          source_response_error: 0,
          rate_limited: 0,
          adapter_error: 0,
          unknown_failure: 0
        },
        targets_with_observations: 0
      },
      items: [
        {
          expected_target: {
            check_target_id: "plan:nvidia-memory-2025:samsung-ir:official-html-disclosure:0a2adc4a3479a3f6",
            source_adapter_id: "samsung-ir",
            target_kind: "official-html-disclosure",
            enabled: false,
            target_config: { entity_id: "ENT-SAMSUNG-ELECTRONICS", year: 2025 }
          },
          synced: true,
          match_kind: "check_target_id",
          matched_check_target_id: "plan:nvidia-memory-2025:samsung-ir:official-html-disclosure:0a2adc4a3479a3f6",
          state: "disabled",
          target_enabled: false,
          policy_enabled: true,
          next_check_at: null,
          effective_check_cadence_minutes: 10080,
          effective_jitter_minutes: 120,
          latest_job: null,
          latest_event: null,
          observations: 0,
          latest_observation_at: null
        }
      ]
    };
    const readiness: QuestionReadinessMatrix = {
      schema_version: "1.0.0",
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      summary: { ready: 0, partial: 1, blocked: 0 },
      items: [
        {
          question_id: "investigation.next_sources",
          question: "下一步应该查什么源？",
          status: "partial",
          confidence: 0.5,
          ready_signals: [],
          missing_requirements: ["Runnable target needs monitor follow-through"],
          supporting_refs: ["source_plan:samsung-ir"],
          unknown_ids: []
        }
      ]
    };

    const backlog = buildInvestigationBacklog({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench: emptyWorkbench(),
      components: [],
      source_plan: sourcePlan,
      question_readiness: readiness,
      source_target_coverage: coverage
    });

    const sourceCheck = backlog.items.find((item) => item.kind === "source_check");
    expect(sourceCheck?.source_target_coverage).toEqual([
      expect.objectContaining({
        source_adapter_id: "samsung-ir",
        state: "disabled",
        synced: true
      })
    ]);
    expect(sourceCheck?.action).toContain("Enable the synced source-check targets");
    expect(sourceCheck?.supporting_refs).toContain("source_target:plan:nvidia-memory-2025:samsung-ir:official-html-disclosure:0a2adc4a3479a3f6");
    expect(renderInvestigationBacklogMarkdown(backlog)).toContain("Coverage: samsung-ir/official-html-disclosure=disabled");

    const coverageItem = coverage.items[0];
    if (coverageItem === undefined) throw new Error("coverage fixture must include one item");
    const degradedCoverage: SourceTargetCoverageReport = {
      ...coverage,
      summary: { ...coverage.summary, enabled_targets: 1, degraded_targets: 1 },
      items: [
        {
          ...coverageItem,
          state: "degraded",
          target_enabled: true,
          latest_event: {
            event_id: "SEV-DEGRADED",
            event_type: "SOURCE_DEGRADED",
            doc_id: null,
            detected_at: "2026-01-01T00:01:00.000Z",
            caused_by: "source-check.samsung-ir"
          }
        }
      ]
    };
    const degradedBacklog = buildInvestigationBacklog({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench: emptyWorkbench(),
      components: [],
      source_plan: sourcePlan,
      question_readiness: readiness,
      source_target_coverage: degradedCoverage
    });
    const degradedSourceCheck = degradedBacklog.items.find((item) => item.kind === "source_check");
    expect(degradedSourceCheck?.action).toContain("Inspect degraded source fetches");
  });

  it("uses source target preflight status before suggesting source monitor sync", () => {
    const sourcePlan = [officialSourcePlanItem()];
    const coverage = officialSourceTargetCoverage("not_synced");
    const preflight = parseSourceTargetPreflightReport(
      JSON.stringify({
        schema_version: "1.0.0",
        summary: {
          requested_targets: 1,
          selected_targets: 1,
          checked_targets: 0,
          failed_targets: 1,
          skipped_targets: 0,
          planned_tasks: 0,
          fetched_documents: 0,
          normalized_documents: 0,
          degraded_documents: 0,
          by_source: { "samsung-ir": 1 }
        },
        items: [
          {
            check_target_id: "plan:nvidia-memory-2025:samsung-ir:official-html-disclosure:0a2adc4a3479a3f6",
            source_adapter_id: "samsung-ir",
            target_kind: "official-html-disclosure",
            status: "failed",
            planned_tasks: 0,
            fetched_documents: 0,
            normalized_documents: 0,
            degraded_documents: 0,
            documents: [],
            issue_kind: "missing_credentials",
            error_message: "fixture source unavailable",
            missing_credentials: [{ env_key: "SAMSUNG_IR_TOKEN", required: true, description: "Fixture credential." }]
          }
        ]
      })
    );
    const backlog = buildInvestigationBacklog({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench: emptyWorkbench(),
      components: [],
      source_plan: sourcePlan,
      question_readiness: readyQuestionReadiness(),
      source_target_coverage: coverage,
      source_target_preflight: preflight
    });

    const sourceCheck = backlog.items.find((item) => item.kind === "source_check");
    expect(sourceCheck?.action).toContain("Configure required source credentials");
    expect(sourceCheck?.action).not.toContain("Sync runnable source-plan targets into source_check_targets first");
    expect(sourceCheck?.source_target_coverage).toEqual([
      expect.objectContaining({
        source_adapter_id: "samsung-ir",
        state: "not_synced",
        preflight_status: "failed",
        preflight_issue_kind: "missing_credentials",
        preflight_missing_credential_env_keys: ["SAMSUNG_IR_TOKEN"],
        preflight_error_message: "fixture source unavailable"
      })
    ]);
    expect(sourceCheck?.supporting_refs).toContain("source_preflight:plan:nvidia-memory-2025:samsung-ir:official-html-disclosure:0a2adc4a3479a3f6");
    expect(sourceCheck?.action).toContain("SAMSUNG_IR_TOKEN");
    expect(renderInvestigationBacklogMarkdown(backlog)).toContain("preflight=failed/missing_credentials, missing_credentials=SAMSUNG_IR_TOKEN");
  });

  it("turns sparse observation series into investigation backlog actions", () => {
    const coverage: ObservationCoverageReport = buildObservationCoverageReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench: { chain_segments: [] },
      company: {
        related_observations: [
          observationFixture("OBS-REV-1", "FINANCIAL_METRIC_OBSERVATION", {
            source_adapter_id: "sec-edgar",
            scope_kind: "company",
            scope_id: "ENT-NVIDIA",
            metric_name: "revenue",
            metric_value: "100",
            metric_unit: "USD",
            time_window_end: "2026-01-31T00:00:00.000Z"
          })
        ]
      },
      components: []
    });
    const readiness: QuestionReadinessMatrix = {
      schema_version: "1.0.0",
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      summary: { ready: 1, partial: 0, blocked: 0 },
      items: [
        {
          question_id: "signals.financial_context",
          question: "财务指标是否有跨期变化或同行位置线索？",
          status: "ready",
          confidence: 0.7,
          ready_signals: ["fixture"],
          missing_requirements: [],
          supporting_refs: [],
          unknown_ids: []
        }
      ]
    };

    const backlog = buildInvestigationBacklog({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench: emptyWorkbench(),
      components: [],
      source_plan: [],
      question_readiness: readiness,
      observation_coverage: coverage
    });

    const seriesItem = backlog.items.find((item) => item.kind === "observation_series");
    expect(seriesItem).toEqual(
      expect.objectContaining({
        priority: "P2",
        title: "Make observation series analyzable: revenue"
      })
    );
    expect(seriesItem?.action).toContain("Collect 5 more comparable numeric/windowed observations");
    expect(seriesItem?.supporting_refs).toContain("observation:OBS-REV-1");
    expect(renderInvestigationBacklogMarkdown(backlog)).toContain("observation_series");
  });

  it("turns official disclosure readiness gaps into investigation backlog actions", () => {
    const readiness: QuestionReadinessMatrix = {
      schema_version: "1.0.0",
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      summary: { ready: 1, partial: 0, blocked: 0 },
      items: [
        {
          question_id: "company.upstream_dependencies",
          question: "一级供应商是否可审计？",
          status: "ready",
          confidence: 0.7,
          ready_signals: ["fixture"],
          missing_requirements: [],
          supporting_refs: [],
          unknown_ids: []
        }
      ]
    };
    const officialDisclosureReadiness = buildOfficialDisclosureReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      component_ids: ["COMP-MEMORY"],
      source_plan: [officialSourcePlanItem()],
      source_target_coverage: officialSourceTargetCoverage("disabled"),
      workbench: {
        ...emptyWorkbench(),
        companies: [{ entity_id: "ENT-NVIDIA", name: "NVIDIA", role: "root" }],
        edges: [],
        evidences: [],
        intelligence: { edge_strengths: [], edge_freshness: [] }
      }
    });
    const backlog = buildInvestigationBacklog({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench: emptyWorkbench(),
      components: [],
      source_plan: [],
      question_readiness: readiness,
      official_disclosure_readiness: officialDisclosureReadiness
    });

    const officialItem = backlog.items.find((item) => item.kind === "official_disclosure_coverage");
    expect(officialItem?.priority).toBe("P0");
    expect(officialItem?.target.question_ids).toEqual(["official_disclosure.readiness"]);
    expect(officialItem?.supporting_refs).toContain("source_plan:samsung-ir");
    expect(officialItem?.supporting_refs).toContain("source_target:plan:nvidia-memory-2025:samsung-ir:official-html-disclosure:0a2adc4a3479a3f6");
    expect(officialItem?.action).toContain("Enable synced official disclosure targets");
    expect(renderInvestigationBacklogMarkdown(backlog)).toContain("official_disclosure_coverage");
  });

  it("turns official disclosure corroboration queue into edge-level backlog actions", () => {
    const officialDisclosureReadiness = buildOfficialDisclosureReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      component_ids: ["COMP-DRAM"],
      source_plan: [officialSourcePlanItem()],
      source_target_coverage: officialSourceTargetCoverage("disabled"),
      workbench: {
        ...emptyWorkbench(),
        companies: [
          { entity_id: "ENT-NVIDIA", name: "NVIDIA", role: "root" },
          { entity_id: "ENT-SAMSUNG-ELECTRONICS", name: "Samsung Electronics", role: "counterparty" }
        ],
        edges: [
          {
            edge_id: "EDGE-SAMSUNG-1",
            from_id: "ENT-NVIDIA",
            from_name: "NVIDIA",
            to_id: "ENT-SAMSUNG-ELECTRONICS",
            to_name: "Samsung Electronics",
            relation: "BUYS_FROM",
            component: "dram",
            component_id: "COMP-DRAM",
            evidence_level: 5,
            confidence: 0.95,
            evidence_ids: ["EV-SAMSUNG-1"]
          }
        ],
        evidences: [
          evidenceFixture("EV-SAMSUNG-1", {
            edge_id: "EDGE-SAMSUNG-1",
            evidence_level: 5,
            source_adapter_id: "sec-edgar",
            source_url: "https://www.sec.gov/Archives/fixture/nvidia-10k.htm",
            cite_text_sha256: "abc123"
          })
        ],
        intelligence: { edge_strengths: [], edge_freshness: [] }
      }
    });
    const failedPreflight = parseSourceTargetPreflightReport(
      JSON.stringify({
        schema_version: "1.0.0",
        summary: {
          requested_targets: 1,
          selected_targets: 1,
          checked_targets: 0,
          failed_targets: 1,
          skipped_targets: 0,
          planned_tasks: 0,
          fetched_documents: 0,
          normalized_documents: 0,
          degraded_documents: 0,
          by_source: { "samsung-ir": 1 }
        },
        items: [
          {
            check_target_id: "plan:nvidia-memory-2025:samsung-ir:official-html-disclosure:0a2adc4a3479a3f6",
            source_adapter_id: "samsung-ir",
            target_kind: "official-html-disclosure",
            status: "failed",
            planned_tasks: 0,
            fetched_documents: 0,
            normalized_documents: 0,
            degraded_documents: 0,
            documents: [],
            issue_kind: "missing_credentials",
            error_message: "fixture source unavailable",
            missing_credentials: [{ env_key: "SAMSUNG_IR_TOKEN", required: true, description: "Fixture credential." }]
          }
        ]
      })
    );

    const backlog = buildInvestigationBacklog({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench: emptyWorkbench(),
      components: [],
      source_plan: [officialSourcePlanItem()],
      source_target_coverage: officialSourceTargetCoverage("disabled"),
      source_target_preflight: failedPreflight,
      question_readiness: readyQuestionReadiness(),
      official_disclosure_readiness: officialDisclosureReadiness
    });

    expect(backlog.summary.corroboration_reviews).toBe(1);
    expect(backlog.summary.corroboration_review_runnable_targets).toBe(1);
    expect(backlog.summary.corroboration_review_with_source_target_coverage).toBe(1);
    expect(backlog.summary.corroboration_review_need_enable).toBe(1);
    expect(backlog.summary.corroboration_review_failed_preflight).toBe(1);
    expect(backlog.summary.corroboration_review_missing_credentials).toBe(1);
    expect(backlog.summary.corroboration_review_explicit_disposition_only).toBe(0);
    const corroborationItem = backlog.items.find((item) => item.kind === "corroboration_review");
    expect(corroborationItem).toEqual(
      expect.objectContaining({
        priority: "P1",
        title: "Resolve corroboration for EDGE-SAMSUNG-1"
      })
    );
    expect(corroborationItem?.target).toEqual(
      expect.objectContaining({
        component_ids: ["COMP-DRAM"],
        edge_ids: ["EDGE-SAMSUNG-1"],
        source_ids: ["samsung-ir", "sec-edgar"],
        question_ids: ["official_disclosure.corroboration"]
      })
    );
    expect(corroborationItem?.runnable_check_targets).toEqual([
      expect.objectContaining({ source_adapter_id: "samsung-ir", target_kind: "official-html-disclosure" })
    ]);
    expect(corroborationItem?.source_target_coverage).toEqual([
      expect.objectContaining({ source_adapter_id: "samsung-ir", target_kind: "official-html-disclosure", state: "disabled" })
    ]);
    expect(corroborationItem?.action).toContain("Configure required source credentials");
    expect(corroborationItem?.action).toContain("SAMSUNG_IR_TOKEN");
    expect(renderInvestigationBacklogMarkdown(backlog)).toContain("corroboration_review");
    expect(renderInvestigationBacklogMarkdown(backlog)).toContain("failed preflight 1");
    const corroborationSourcePlan = buildCorroborationSourcePlan({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      source_plan: [officialSourcePlanItem()],
      investigation_backlog: backlog
    });
    expect(corroborationSourcePlan.summary).toEqual(
      expect.objectContaining({
        review_edges: 1,
        source_plan_items: 1,
        runnable_targets: 1,
        targets_need_enable: 1,
        targets_failed_preflight: 1,
        targets_missing_credentials: 1,
        by_next_action: { configure_credentials: 1 }
      })
    );
    expect(corroborationSourcePlan.target_refs).toEqual([
      expect.objectContaining({
        backlog_id: corroborationItem?.backlog_id,
        edge_ids: ["EDGE-SAMSUNG-1"],
        source_adapter_id: "samsung-ir",
        target_kind: "official-html-disclosure",
        coverage_state: "disabled",
        next_action: "configure_credentials",
        preflight_issue_kind: "missing_credentials",
        preflight_missing_credential_env_keys: ["SAMSUNG_IR_TOKEN"]
      })
    ]);
    const [sourcePlanItem] = corroborationSourcePlan.source_plan;
    expect(sourcePlanItem?.source_id).toBe("samsung-ir");
    expect(sourcePlanItem?.reasons.some((reason) => reason.includes("Corroboration review"))).toBe(true);
    expect(sourcePlanItem?.suggested_check_targets).toEqual([
      expect.objectContaining({
        source_adapter_id: "samsung-ir",
        target_kind: "official-html-disclosure"
      })
    ]);
    expect(sourcePlanItem?.suggested_check_targets[0]?.reason).toContain("EDGE-SAMSUNG-1");
    expect(parseManagedSourcePlanDocument(JSON.stringify(corroborationSourcePlan)).source_plan).toHaveLength(1);
    const monitorConfig = buildSourcePolicyConfigFromPlanTargets({
      source_plan: corroborationSourcePlan.source_plan,
      namespace: "nvidia-memory-2025"
    });
    expect(monitorConfig.check_targets[0]?.notes).toContain("EDGE-SAMSUNG-1");
    expect(renderCorroborationSourcePlanMarkdown(corroborationSourcePlan)).toContain("Missing credentials: SAMSUNG_IR_TOKEN");
    expect(renderCorroborationSourcePlanMarkdown(corroborationSourcePlan)).toContain("Next action: configure_credentials");
  });

  it("splits corroboration source plans into action-specific executable batches", () => {
    const sourcePlanItem = officialSourcePlanItem();
    const smokeTarget = sourcePlanItem.suggested_check_targets[0];
    if (smokeTarget === undefined) throw new Error("officialSourcePlanItem fixture must include a smoke target");
    const syncTarget = {
      ...smokeTarget,
      target_config: { entity_id: "ENT-SAMSUNG-ELECTRONICS", year: 2024 },
      reason: "Samsung IR 2024 connector target."
    };
    const sourcePlan: SourcePlanItem[] = [
      {
        ...sourcePlanItem,
        suggested_check_targets: [smokeTarget, syncTarget]
      }
    ];
    const backlog: InvestigationBacklog = {
      schema_version: "1.0.0",
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      summary: {
        open_items: 2,
        p0: 0,
        p1: 2,
        p2: 0,
        p3: 0,
        runnable_check_targets: 2,
        source_target_coverage_items: 1,
        corroboration_reviews: 2,
        corroboration_review_runnable_targets: 2,
        corroboration_review_with_source_target_coverage: 1,
        corroboration_review_explicit_disposition_only: 0,
        corroboration_review_need_sync: 1,
        corroboration_review_need_enable: 0,
        corroboration_review_due: 0,
        corroboration_review_failed_preflight: 0,
        corroboration_review_missing_credentials: 0,
        corroboration_review_invalid_config: 0,
        corroboration_review_unsupported_connector: 0,
        corroboration_review_source_unreachable: 0,
        propagation_readiness_items: 0
      },
      items: [
        {
          backlog_id: "BACKLOG-SMOKE",
          kind: "corroboration_review",
          priority: "P1",
          title: "Smoke Samsung IR target",
          rationale: "No preflight exists yet.",
          action: "Run smoke before syncing.",
          target: {
            component_ids: ["COMP-DRAM"],
            edge_ids: ["EDGE-SMOKE"],
            unknown_ids: [],
            source_ids: ["samsung-ir"],
            question_ids: ["official_disclosure.corroboration"]
          },
          supporting_refs: [],
          runnable_check_targets: [smokeTarget],
          source_target_coverage: []
        },
        {
          backlog_id: "BACKLOG-SYNC",
          kind: "corroboration_review",
          priority: "P1",
          title: "Sync Samsung IR target",
          rationale: "Preflight exists and target has not been synced.",
          action: "Sync target after smoke.",
          target: {
            component_ids: ["COMP-DRAM"],
            edge_ids: ["EDGE-SYNC"],
            unknown_ids: [],
            source_ids: ["samsung-ir"],
            question_ids: ["official_disclosure.corroboration"]
          },
          supporting_refs: [],
          runnable_check_targets: [syncTarget],
          source_target_coverage: [
            {
              source_adapter_id: "samsung-ir",
              target_kind: "official-html-disclosure",
              target_config: syncTarget.target_config,
              check_target_id: "plan:nvidia-memory-2025:samsung-ir:official-html-disclosure:sync",
              state: "not_synced",
              synced: false,
              observations: 0,
              latest_job_id: null,
              latest_job_status: null,
              latest_event_id: null,
              latest_event_type: null,
              preflight_status: "checked",
              preflight_issue_kind: null,
              preflight_error_message: null,
              preflight_missing_credential_env_keys: [],
              preflight_normalized_documents: 1,
              preflight_degraded_documents: 0
            }
          ]
        }
      ]
    };

    const plan = buildCorroborationSourcePlan({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      source_plan: sourcePlan,
      investigation_backlog: backlog
    });
    const smokeBatch = buildCorroborationSourcePlanActionBatch(plan, actionBatchDefinition("smoke"));
    const syncBatch = buildCorroborationSourcePlanActionBatch(plan, actionBatchDefinition("sync"));

    expect(plan.summary.by_next_action).toEqual({ smoke_target: 1, sync_target: 1 });
    expect(smokeBatch.summary).toEqual(
      expect.objectContaining({
        runnable_targets: 1,
        target_refs: 1,
        review_edges: 1,
        by_source: { "samsung-ir": 1 }
      })
    );
    expect(smokeBatch.source_plan[0]?.suggested_check_targets[0]?.target_config["year"]).toBe(2025);
    expect(syncBatch.source_plan[0]?.suggested_check_targets[0]?.target_config["year"]).toBe(2024);
    expect(parseManagedSourcePlanDocument(JSON.stringify(smokeBatch)).source_plan[0]?.suggested_check_targets).toHaveLength(1);
    expect(parseManagedSourcePlanDocument(JSON.stringify(syncBatch)).source_plan[0]?.suggested_check_targets).toHaveLength(1);
    expect(renderCorroborationSourcePlanMarkdown(plan)).toContain("corroboration-source-plan-smoke.json");
  });
});

function officialSourcePlanItem(): SourcePlanItem {
  return {
    source_id: "samsung-ir",
    source_name: "Samsung Electronics Investor Relations",
    purpose: "official_disclosure",
    priority: "P0",
    status: "preview",
    automation: "allowed",
    requires_key: false,
    expected_output_layer: "edge",
    relation_policy: "can_create_fact_edge",
    parent_component_ids: ["COMP-MEMORY"],
    target_ids: ["COMP-DRAM"],
    trigger_dependency_ids: ["CDEP-MEMORY-DRAM"],
    reasons: ["Samsung IR can disclose memory supplier context."],
    suggested_check_targets: [
      {
        source_adapter_id: "samsung-ir",
        target_kind: "official-html-disclosure",
        runnable: true,
        target_config: { entity_id: "ENT-SAMSUNG-ELECTRONICS", year: 2025 },
        reason: "Samsung IR has a registered official disclosure connector for 2025."
      }
    ]
  };
}

function commoditySourcePlanItem(): SourcePlanItem {
  return {
    source_id: "worldbank-pink",
    source_name: "World Bank Pink Sheet",
    purpose: "commodity",
    priority: "P1",
    status: "preview",
    automation: "allowed",
    requires_key: false,
    expected_output_layer: "observation",
    relation_policy: "observation_only",
    parent_component_ids: ["COMP-WAFER"],
    target_ids: ["MAT-COPPER"],
    trigger_dependency_ids: ["material-taxonomy:COMP-WAFER:MAT-COPPER"],
    reasons: ["Copper price is material context only; it cannot prove company-level sourcing."],
    suggested_check_targets: [
      {
        source_adapter_id: "worldbank-pink",
        target_kind: "commodity-price-observation",
        runnable: true,
        target_config: { commodity: "copper", material_id: "MAT-COPPER", month: "2025-12" },
        reason: "World Bank Pink Sheet can provide copper price context."
      }
    ]
  };
}
