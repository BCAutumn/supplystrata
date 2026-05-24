import { describe, expect, it } from "vitest";
import { buildGate1RunLedger, renderGate1RunLedgerMarkdown } from "@supplystrata/research-pack";
import type { CorroborationSourcePlan, OfficialDisclosureReadinessReport, SupplyChainExpansionPlan } from "@supplystrata/research-pack";

describe("Gate 1 run ledger", () => {
  it("builds a frontend-safe review workbench without fact mutation authority", () => {
    const ledger = buildGate1RunLedger({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      research_input: {
        company: "ENT-NVIDIA",
        depth: 3,
        officialDisclosureYear: "2025",
        sourceTargetNamespace: "gate1-review-test"
      },
      official_disclosure_readiness: officialDisclosureReadinessFixture(),
      corroboration_source_plan: corroborationSourcePlanFixture(),
      supply_chain_expansion_plan: supplyChainExpansionPlanFixture()
    });

    expect(ledger.review_workbench.summary.total_items).toBe(5);
    expect(ledger.monitoring_config.namespace).toBe("gate1-review-test");
    expect(ledger.monitoring_config.target_schedule_defaults).toEqual({
      enabled_on_sync: false,
      enable_after_review: true,
      check_cadence_minutes: 10080,
      jitter_minutes: 120,
      max_attempts: 3,
      backoff_base_minutes: 2,
      backoff_max_minutes: 120,
      next_check_at: null
    });
    expect(ledger.monitoring_config.configurable_fields.map((field) => field.field)).toEqual([
      "check_cadence_minutes",
      "jitter_minutes",
      "max_attempts",
      "backoff_base_minutes",
      "backoff_max_minutes",
      "next_check_at"
    ]);
    expect(ledger.monitoring_config.batches).toEqual([
      expect.objectContaining({
        batch_id: "official_source_path",
        source_plan_ref: "source-plan.json",
        target_count: 8,
        current_state: "not_synced",
        recommended_next_decision: "approve_sync"
      }),
      expect.objectContaining({
        batch_id: "edge_corroboration",
        source_plan_ref: "corroboration-source-plan-smoke.json",
        target_count: 1,
        current_state: "smoke_first",
        recommended_next_decision: "approve_smoke"
      })
    ]);
    expect(ledger.review_workbench.summary.human_approval_required_items).toBe(4);
    expect(ledger.review_workbench.items.every((item) => item.policy.automatic_fact_mutation_allowed === false)).toBe(true);
    expect(ledger.review_workbench.items.every((item) => item.policy.allowed_edge_mutation === "none")).toBe(true);
    expect(ledger.review_workbench.items.some((item) => item.kind === "source_target_batch" && item.recommended_decision === "approve_smoke")).toBe(true);
    expect(ledger.review_workbench.items.some((item) => item.kind === "source_target_batch" && item.recommended_decision === "approve_sync")).toBe(true);
    expect(
      ledger.review_workbench.items.some(
        (item) =>
          item.kind === "edge_corroboration" &&
          item.recommended_decision === "record_single_source_unknown" &&
          item.write_effect === "unknown_materialization_after_review"
      )
    ).toBe(true);
    expect(
      ledger.review_workbench.items.some((item) => item.kind === "official_signal_disposition" && item.allowed_decisions.includes("supports_existing_edge"))
    ).toBe(true);
    expect(
      ledger.review_workbench.items.some(
        (item) =>
          item.kind === "frontier_company_research" &&
          item.recommended_decision === "open_frontier_research_pack" &&
          item.policy.requires_human_approval === false
      )
    ).toBe(true);
    expect(renderGate1RunLedgerMarkdown(ledger)).toContain("Review Workbench");
    expect(renderGate1RunLedgerMarkdown(ledger)).toContain("Monitoring Config");
    expect(renderGate1RunLedgerMarkdown(ledger)).toContain("fact mutation: false");
  });
});

function officialDisclosureReadinessFixture(): OfficialDisclosureReadinessReport {
  return {
    schema_version: "1.0.0",
    generated_at: "2026-01-01T00:00:00.000Z",
    company_id: "ENT-NVIDIA",
    target_profile: {
      profile_id: "ai-compute-memory.v0",
      title: "AI compute / memory baseline",
      version: "0.1.0",
      description: "fixture",
      selection_reason: "fixture"
    },
    targets: { core_nodes: 25, level_4_5_fact_edges: 100, corroboration_ratio: 0.7 },
    scorecard: {
      scorecard_id: "gate_1_official_disclosure",
      status: "partial",
      overall_progress: 0.4,
      data_progress: 0.3,
      source_path_progress: 0.7,
      criteria: [
        criterion("core_node_official_coverage", "completion", 10, 25),
        criterion("level_4_5_fact_edge_coverage", "completion", 1, 100),
        criterion("cross_source_corroboration", "completion", 0, 0.7),
        criterion("fact_edge_traceability", "completion", 1, 1),
        criterion("expected_source_path_coverage", "operability", 8, 10)
      ],
      next_actions: ["fixture"]
    },
    summary: {
      visible_research_nodes: 10,
      target_research_nodes: 25,
      company_nodes: 2,
      component_nodes: 1,
      nodes_with_fact_edges: 2,
      target_nodes_with_fact_edges: 2,
      nodes_with_official_source_plan: 8,
      target_nodes_with_official_source_plan: 8,
      nodes_with_runnable_official_targets: 8,
      target_nodes_with_runnable_official_targets: 8,
      nodes_with_official_observations: 0,
      target_nodes_with_official_observations: 0,
      nodes_missing_official_coverage: 0,
      target_nodes_missing_official_coverage: 0,
      level_4_5_fact_edges: 1,
      traceable_edges: 1,
      partial_traceability_edges: 0,
      missing_traceability_edges: 0,
      cross_source_edges: 0,
      single_source_edges: 1,
      missing_evidence_edges: 0,
      corroboration_ratio: 0,
      corroboration_queue_items: 1,
      corroboration_queue_with_runnable_targets: 1,
      corroboration_queue_needing_disposition: 1,
      corroboration_queue_with_recorded_disposition: 0,
      corroboration_queue_proposed_unknowns: 1,
      edges_with_strength: 0,
      edges_with_freshness: 1,
      edges_missing_strength: 1,
      edges_missing_freshness: 0,
      explicit_unknowns: 0,
      official_source_plan_items: 2,
      expected_official_source_links: 10,
      expected_official_source_links_with_coverage: 8,
      expected_official_source_links_runnable: 8,
      expected_official_source_links_connector_available: 2,
      expected_official_source_links_unimplemented: 0,
      expected_official_source_links_missing: 0,
      runnable_official_targets: 8,
      synced_official_targets: 0,
      due_official_targets: 0,
      degraded_official_targets: 0,
      official_targets_with_observations: 0,
      official_disclosure_signal_review_candidates: 1,
      open_official_disclosure_signal_review_candidates: 1,
      official_disclosure_signal_dispositions: 0,
      official_disclosure_signal_correlation_hints: 1,
      open_official_disclosure_signal_correlation_hints: 1
    },
    gates: [],
    nodes: [],
    profile_expansion_candidates: [],
    expected_source_coverage: [],
    official_disclosure_signals: [],
    official_disclosure_signal_correlation_hints: [
      {
        review_id: "REV-1",
        edge_id: "EDGE-1",
        status: "pending",
        source_adapter_id: "samsung-ir",
        signal_title: "Samsung memory disclosure",
        edge_summary: "NVIDIA -> Samsung Memory (COMP-MEMORY)",
        disposition: "needs_explicit_single_source_disposition",
        relevance_score: 0.8,
        match_reasons: ["signal_mentions_to_company"],
        disposition_status: "open",
        recorded_decision: null,
        review_policy: "review_only_no_fact_mutation",
        action: "Review the signal without mutating the fact edge."
      }
    ],
    corroboration_queue: [
      {
        edge_id: "EDGE-1",
        priority: "P2",
        disposition: "needs_explicit_single_source_disposition",
        reason: "Only one official source is visible.",
        from_id: "ENT-NVIDIA",
        from_name: "NVIDIA",
        to_id: "ENT-SAMSUNG-MEMORY",
        to_name: "Samsung Memory",
        component_id: "COMP-MEMORY",
        existing_source_adapters: ["sec-edgar"],
        candidate_node_ids: ["ENT-SAMSUNG-MEMORY"],
        candidate_source_ids: ["samsung-ir"],
        source_plan_refs: ["source-plan:item:samsung-ir"],
        source_targets: [sourceTargetFixture()],
        unknown_ids: [],
        proposed_unknown: {
          unknown_id: "UNK-EDGE-1-SINGLE-SOURCE",
          scope_kind: "edge",
          scope_id: "EDGE-1",
          question: "Is there an independent official second source for this edge?",
          why_unknown: "Only one official source is visible.",
          blocking_data_sources: ["counterparty official disclosure"],
          proxies: [],
          created_by: "gate1.fixture"
        },
        action: "Record explicit unknown if no second source path is available."
      }
    ],
    edges: [],
    source_plan_items: [],
    gaps: []
  };
}

function criterion(
  criterionId: OfficialDisclosureReadinessReport["scorecard"]["criteria"][number]["criterion_id"],
  kind: OfficialDisclosureReadinessReport["scorecard"]["criteria"][number]["kind"],
  measured: number,
  target: number
): OfficialDisclosureReadinessReport["scorecard"]["criteria"][number] {
  return {
    criterion_id: criterionId,
    label: criterionId,
    kind,
    status: "partial",
    measured,
    target,
    progress: target === 0 ? 0 : measured / target,
    rationale: "fixture"
  };
}

function sourceTargetFixture(): OfficialDisclosureReadinessReport["corroboration_queue"][number]["source_targets"][number] {
  return {
    source_adapter_id: "samsung-ir",
    target_kind: "official-html-disclosure",
    runnable: true,
    target_key: "samsung-ir:official-html-disclosure:2025",
    target_entity_id: "ENT-SAMSUNG-MEMORY",
    target_component_id: "COMP-MEMORY",
    check_target_id: null,
    state: "not_synced",
    synced: false,
    observations: 0,
    latest_event_type: null
  };
}

function corroborationSourcePlanFixture(): CorroborationSourcePlan {
  return {
    schema_version: "1.0.0",
    generated_at: "2026-01-01T00:00:00.000Z",
    company_id: "ENT-NVIDIA",
    summary: {
      review_edges: 1,
      disposition_only_edges: 0,
      source_plan_items: 0,
      runnable_targets: 1,
      targets_need_sync: 1,
      targets_need_enable: 0,
      targets_due: 0,
      targets_failed_preflight: 0,
      targets_missing_credentials: 0,
      by_next_action: { smoke_target: 1 },
      by_source: { "samsung-ir": 1 }
    },
    target_refs: [],
    source_plan: []
  };
}

function supplyChainExpansionPlanFixture(): SupplyChainExpansionPlan {
  return {
    schema_version: "1.0.0",
    generated_at: "2026-01-01T00:00:00.000Z",
    company_id: "ENT-NVIDIA",
    max_depth: 7,
    summary: {
      fact_edges_considered: 1,
      frontier_edges: 1,
      frontier_companies: 1,
      component_dependency_leads: 0,
      leads_with_fact_coverage: 0,
      leads_with_source_path: 0,
      lead_only_items: 0,
      observation_layer_items: 0,
      blocked_frontier_edges: 0,
      stop_conditions: 0,
      explicit_unknown_refs: 1
    },
    frontier: [
      {
        frontier_id: "frontier:EDGE-1",
        edge_id: "EDGE-1",
        path_depth: 1,
        expansion_state: "expand_candidate",
        from_id: "ENT-NVIDIA",
        from_name: "NVIDIA",
        to_id: "ENT-SAMSUNG-MEMORY",
        to_name: "Samsung Memory",
        next_company_id: "ENT-SAMSUNG-MEMORY",
        next_company_name: "Samsung Memory",
        relation: "BUYS_FROM",
        component_id: "COMP-MEMORY",
        evidence_level: 5,
        unknown_ids: ["UNK-EDGE-1-SINGLE-SOURCE"],
        source_plan_refs: ["source-plan:item:samsung-ir"],
        rationale: "Component-scoped frontier company is ready for the generic research path.",
        action: "Run generic research pack."
      }
    ],
    component_dependency_leads: [],
    stop_conditions: []
  };
}
