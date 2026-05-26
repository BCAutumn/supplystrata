import { describe, expect, it } from "vitest";
import {
  buildObservationCoverageReport,
  buildOfficialDisclosureReadinessReport,
  buildPropagationReadinessReport,
  buildSupplyChainExpansionPlan,
  renderPropagationReadinessMarkdown,
  renderSupplyChainExpansionPlanMarkdown
} from "@supplystrata/research-pack";
import {
  commoditySourcePlanItem,
  edgeFixture,
  edgeSegmentFixture,
  emptyWorkbench,
  observationFixture,
  officialSourcePlanItem,
  officialSourceTargetCoverage
} from "./research-pack-fixtures.js";
import type { SourcePlanItem } from "@supplystrata/source-plan";

describe("research-pack expansion and propagation", () => {
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
        source_path_authority: "fact_capable",
        source_relation_policies: ["can_create_fact_edge"],
        source_output_layers: ["edge"],
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
        { entity_id: "ENT-SKHYNIX", name: "SK Hynix", role: "counterparty" as const },
        { entity_id: "ENT-FOXCONN", name: "Foxconn", role: "counterparty" as const }
      ],
      chain_segments: [
        edgeSegmentFixture("EDGE-MEMORY", 1, "ENT-NVIDIA", "NVIDIA", "ENT-SKHYNIX", "SK Hynix", "COMP-MEMORY"),
        edgeSegmentFixture("EDGE-SERVER", 1, "ENT-NVIDIA", "NVIDIA", "ENT-FOXCONN", "Foxconn", "COMP-SERVER")
      ],
      edges: [
        edgeFixture("EDGE-MEMORY", "ENT-NVIDIA", "NVIDIA", "ENT-SKHYNIX", "SK Hynix", "COMP-MEMORY"),
        edgeFixture("EDGE-SERVER", "ENT-NVIDIA", "NVIDIA", "ENT-FOXCONN", "Foxconn", "COMP-SERVER")
      ]
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
    const sourceTargetCoverage = officialSourceTargetCoverage("succeeded");
    const officialDisclosureReadiness = buildOfficialDisclosureReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench,
      component_ids: ["COMP-MEMORY", "COMP-WAFER"],
      source_plan: sourcePlan,
      source_target_coverage: sourceTargetCoverage
    });
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
      official_disclosure_readiness: officialDisclosureReadiness,
      source_plan: sourcePlan,
      source_target_coverage: sourceTargetCoverage,
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
    expect(report.items.find((item) => item.context_kind === "policy_or_export_control_signal")).toEqual(
      expect.objectContaining({
        status: "partial",
        source_plan_refs: ["source_plan:samsung-ir"]
      })
    );
    expect(report.ai_compute_matrix.summary.layers_total).toBe(8);
    expect(report.ai_compute_matrix.layers.find((item) => item.layer_id === "demand_to_compute")).toEqual(
      expect.objectContaining({
        status: "covered_fact",
        fact_edge_refs: ["edge:EDGE-SERVER"],
        observation_refs: ["observation:OBS-BACKLOG", "observation:OBS-CAPEX"]
      })
    );
    const computeToServerLayer = report.ai_compute_matrix.layers.find((item) => item.layer_id === "compute_to_server");
    expect(computeToServerLayer).toEqual(
      expect.objectContaining({
        status: "covered_fact",
        fact_edge_refs: ["edge:EDGE-SERVER"]
      })
    );
    expect(computeToServerLayer?.official_evidence_gaps.map((item) => `${item.gap_kind}:${item.target_kind}:${item.target_id}`)).toEqual(
      expect.arrayContaining([
        "component_without_l4_l5_fact:component:COMP-COOLING",
        "component_without_l4_l5_fact:component:COMP-OPTICAL-MODULE",
        "component_without_l4_l5_fact:component:COMP-POWER-SUPPLY"
      ])
    );
    const computeToServerEvidenceSummary = computeToServerLayer?.evidence_layer_summary ?? [];
    expect(
      computeToServerEvidenceSummary.map((item) => ({
        layer_kind: item.layer_kind,
        prohibited_truth_store_writes: item.prohibited_truth_store_writes
      }))
    ).toEqual(
      expect.arrayContaining([
        {
          layer_kind: "fact_edge",
          prohibited_truth_store_writes: ["raise_evidence_level_without_review", "close_unknown_without_review"]
        },
        {
          layer_kind: "lead",
          prohibited_truth_store_writes: ["create_fact_edge", "raise_evidence_level", "close_unknown"]
        },
        {
          layer_kind: "official_evidence_gap",
          prohibited_truth_store_writes: ["create_fact_edge", "raise_evidence_level", "close_unknown"]
        }
      ])
    );
    expect(computeToServerEvidenceSummary.find((item) => item.layer_kind === "fact_edge")?.count).toBe(1);
    expect(computeToServerEvidenceSummary.find((item) => item.layer_kind === "lead")?.count).toBeGreaterThan(0);
    expect(computeToServerEvidenceSummary.find((item) => item.layer_kind === "official_evidence_gap")?.count).toBeGreaterThan(0);
    const boardMaterialsLayer = report.ai_compute_matrix.layers.find((item) => item.layer_id === "server_to_board_materials");
    expect(boardMaterialsLayer).toEqual(
      expect.objectContaining({
        status: "observation_ready",
        fact_edge_refs: [],
        observation_refs: ["observation:OBS-COPPER"],
        source_plan_refs: ["source_plan:worldbank-pink"],
        source_target_groups: [
          expect.objectContaining({
            group_kind: "observation_proxy",
            source_plan_refs: ["source_plan:worldbank-pink"],
            source_adapters: ["worldbank-pink"],
            target_kinds: ["commodity-price-observation"]
          })
        ]
      })
    );
    expect(boardMaterialsLayer?.next_research_targets.map((item) => `${item.target_kind}:${item.target_id}`)).toContain("component:COMP-CCL");
    expect(boardMaterialsLayer?.next_research_targets.map((item) => `${item.target_kind}:${item.target_id}`)).toContain("source_group:observation_proxy");
    expect(boardMaterialsLayer?.source_target_status_summary).toEqual(
      expect.objectContaining({
        targets: 0,
        runnable_targets: 0,
        blocked_targets: 0,
        by_state: {},
        by_failure_kind: {}
      })
    );
    expect(boardMaterialsLayer?.official_evidence_gaps.map((item) => `${item.gap_kind}:${item.target_kind}:${item.target_id}`)).toEqual(
      expect.arrayContaining([
        "component_without_l4_l5_fact:component:COMP-CCL",
        "component_without_l4_l5_fact:component:COMP-PCB",
        "material_or_process_without_l4_l5_fact:material_or_process:MAT-COPPER",
        "observation_only:layer:server_to_board_materials"
      ])
    );
    expect(report.ai_compute_matrix.layers.find((item) => item.layer_id === "compute_to_fab_capacity")?.source_target_status_summary).toEqual(
      expect.objectContaining({
        targets: 1,
        runnable_targets: 1,
        blocked_targets: 0,
        by_state: { succeeded: 1 },
        by_failure_kind: {}
      })
    );
    expect(report.ai_compute_matrix.layers.find((item) => item.layer_id === "process_to_raw_materials")).toEqual(
      expect.objectContaining({
        status: "observation_ready",
        material_or_process_refs: ["MAT-COPPER"],
        missing_official_evidence: [
          "Review official filings, IR pages, supplier lists, or approved source targets before converting observations into evidence-backed facts."
        ],
        allowed_research_outputs: ["reasoning_input", "observation_review", "calibration_candidate"],
        prohibited_truth_store_writes: ["create_fact_edge", "raise_evidence_level", "close_unknown", "convert_observation_to_evidence_without_review"]
      })
    );
    expect(renderPropagationReadinessMarkdown(report)).toContain("does not create fact edges");
    expect(renderPropagationReadinessMarkdown(report)).toContain("AI Compute Propagation Matrix");
    expect(renderPropagationReadinessMarkdown(report)).toContain("Evidence layer summary");
    expect(renderPropagationReadinessMarkdown(report)).toContain("Source target groups");
    expect(renderPropagationReadinessMarkdown(report)).toContain("Source target status summary");
    expect(renderPropagationReadinessMarkdown(report)).toContain("Next research targets");
    expect(renderPropagationReadinessMarkdown(report)).toContain("Official evidence gaps");
    expect(renderPropagationReadinessMarkdown(report)).toContain("Missing official evidence");
    expect(renderPropagationReadinessMarkdown(report)).toContain("Prohibited writes");
    expect(renderPropagationReadinessMarkdown(report)).toContain("process_material_consumption_signal");
  });

  it("classifies component lead source paths by authority without borrowing parent-only source plans", () => {
    const parentOnlyOfficialSource: SourcePlanItem = {
      ...officialSourcePlanItem(),
      source_id: "company-ir",
      source_name: "Company IR",
      parent_component_ids: ["COMP-SERVER"],
      target_ids: ["COMP-SERVER"],
      trigger_dependency_ids: ["official-target:COMP-SERVER:company-ir"],
      reasons: ["Server component has a generic company IR plan."],
      suggested_check_targets: [
        {
          source_adapter_id: "company-ir",
          target_kind: "official-html-disclosure",
          runnable: true,
          target_config: { entity_id: "ENT-ODM", url: "https://example.com/ir" },
          reason: "Generic server disclosure target."
        }
      ]
    };
    const observationOnlyCclSource: SourcePlanItem = {
      source_id: "census-trade",
      source_name: "Census Trade",
      purpose: "trade",
      priority: "P1",
      status: "preview",
      automation: "allowed",
      requires_key: true,
      expected_output_layer: "observation",
      relation_policy: "observation_only",
      parent_component_ids: ["COMP-PCB"],
      target_ids: ["COMP-CCL"],
      trigger_dependency_ids: ["CDEP-PCB-CCL"],
      reasons: ["CCL can be observed through HS proxy trade data."],
      suggested_check_targets: [
        {
          source_adapter_id: "census-trade",
          target_kind: "trade-flow-observation",
          runnable: true,
          target_config: { component_id: "COMP-CCL", commodity_code: "741021", time: "2025-12", direction: "imports" },
          reason: "Trade proxy only."
        }
      ]
    };
    const plan = buildSupplyChainExpansionPlan({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench: { ...emptyWorkbench(), chain_segments: [], edges: [] },
      component_ids: ["COMP-SERVER", "COMP-PCB"],
      source_plan: [parentOnlyOfficialSource, observationOnlyCclSource],
      max_depth: 7
    });

    expect(plan.component_dependency_leads.find((lead) => lead.dependency_id === "CDEP-SERVER-GPU")).toEqual(
      expect.objectContaining({
        state: "lead_only",
        source_path_authority: "none",
        source_plan_refs: []
      })
    );
    expect(plan.component_dependency_leads.find((lead) => lead.dependency_id === "CDEP-SERVER-PCB")).toEqual(
      expect.objectContaining({
        state: "source_path_runnable",
        source_path_authority: "observation_only",
        source_ids: ["census-trade"],
        source_plan_refs: ["source_plan:census-trade"]
      })
    );
    expect(plan.component_dependency_leads.find((lead) => lead.dependency_id === "CDEP-PCB-CCL")).toEqual(
      expect.objectContaining({
        state: "source_path_runnable",
        source_path_authority: "observation_only",
        source_relation_policies: ["observation_only"],
        source_output_layers: ["observation"],
        source_plan_refs: ["source_plan:census-trade"]
      })
    );
    expect(plan.summary.leads_with_observation_source_path).toBeGreaterThan(0);
    expect(renderSupplyChainExpansionPlanMarkdown(plan)).toContain("Source authority: observation_only");
  });
});
