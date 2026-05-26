import { describe, expect, it } from "vitest";
import {
  buildGate1DataDepthActionBatch,
  buildGate1DataDepthWorkbench,
  buildOfficialDisclosureReadinessReport,
  type Gate1AdjacentOfficialFactsReport,
  type PropagationReadinessReport,
  type SupplyChainExpansionPlan
} from "@supplystrata/research-pack";
import { emptyWorkbench, gate1DataDepthActionBatchDefinition, officialSourcePlanItem, officialSourceTargetCoverage } from "./research-pack-fixtures.js";

describe("Gate 1 data-depth AI compute propagation", () => {
  it("turns AI compute propagation matrix gaps into frontend-ready review items", () => {
    const sourceTargetCoverage = officialSourceTargetCoverage("succeeded");
    const readiness = buildOfficialDisclosureReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench: emptyWorkbench(),
      component_ids: ["COMP-SEMICONDUCTOR-EQUIPMENT"],
      source_plan: [officialSourcePlanItem()],
      source_target_coverage: sourceTargetCoverage
    });

    const workbenchModel = buildGate1DataDepthWorkbench({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      official_disclosure_readiness: readiness,
      source_target_coverage: sourceTargetCoverage,
      supply_chain_expansion_plan: emptySupplyChainExpansionPlan(),
      propagation_readiness: propagationReadinessWithAiComputeGaps(),
      adjacent_official_facts: adjacentOfficialFactsReport(),
      entity_affiliation_contexts: []
    });

    const item = workbenchModel.items.find((candidate) => candidate.item_id === "gate1-ai-compute-propagation:construction_to_equipment");
    expect(item).toEqual(
      expect.objectContaining({
        workstream: "propagation_context",
        frontend_action_kind: "review_intelligence_context",
        priority: "P1",
        recommended_decision: "sync_or_enable_source_target",
        automatic_fact_mutation_allowed: false
      })
    );
    expect(item?.write_impact).toContain("No fact-layer write is authorized");
    expect(item?.refs).toContain("source_plan:asml-ir");
    expect(item?.refs).toContain("source_target:CHK-ASML:scheduled");
    expect(item?.refs).toContain("unknown:UNK-EQUIPMENT");
    expect(item?.source_adapters).toEqual(["asml-ir"]);
    expect(item?.command_hints[0]?.command).toContain("--source asml-ir");
    expect(workbenchModel.summary.ai_compute_propagation_layers_not_covered).toBe(1);
    expect(workbenchModel.summary.ai_compute_propagation_unknown_open).toBe(0);

    const batch = buildGate1DataDepthActionBatch(workbenchModel, gate1DataDepthActionBatchDefinition("intelligence_context"));
    expect(batch.items.some((candidate) => candidate.item_id === "gate1-ai-compute-propagation:construction_to_equipment")).toBe(true);
  });
});

function propagationReadinessWithAiComputeGaps(): PropagationReadinessReport {
  return {
    ...emptyPropagationReadinessReport(),
    ai_compute_matrix: {
      schema_version: "1.0.0",
      matrix_id: "ai_compute_propagation.v0",
      policy: "reasoning_input_only_no_fact_mutation",
      summary: {
        layers_total: 2,
        covered_fact: 1,
        observation_ready: 0,
        official_target_runnable: 1,
        lead_only: 0,
        unknown_open: 0,
        blocked_source: 0,
        layers_with_fact_refs: 1,
        layers_with_observation_refs: 0,
        layers_with_source_targets: 1,
        layers_with_frontier_refs: 0
      },
      layers: [
        {
          layer_id: "demand_to_compute",
          title: "Demand to compute",
          question: "Do we have demand evidence?",
          status: "covered_fact",
          status_reason: "A fact edge anchors this layer.",
          component_ids: ["COMP-GPU"],
          material_or_process_refs: [],
          fact_edge_refs: ["edge:EDGE-DEMAND"],
          observation_refs: [],
          observation_series_refs: [],
          source_plan_refs: [],
          source_target_refs: [],
          component_dependency_refs: [],
          frontier_refs: [],
          unknown_refs: [],
          next_actions: ["Continue corroboration."],
          policy: "reasoning_input_only_no_fact_mutation"
        },
        {
          layer_id: "construction_to_equipment",
          title: "Construction to semiconductor equipment",
          question: "Can the pack identify equipment delivery or qualification frontier?",
          status: "official_target_runnable",
          status_reason: "A source-plan or source-target path exists.",
          component_ids: ["COMP-SEMICONDUCTOR-EQUIPMENT"],
          material_or_process_refs: [],
          fact_edge_refs: [],
          observation_refs: [],
          observation_series_refs: [],
          source_plan_refs: ["source_plan:asml-ir"],
          source_target_refs: ["source_target:CHK-ASML:scheduled"],
          component_dependency_refs: [],
          frontier_refs: [],
          unknown_refs: ["unknown:UNK-EQUIPMENT"],
          next_actions: ["Sync/enable/run the listed source targets, then review outputs through controlled paths."],
          policy: "reasoning_input_only_no_fact_mutation"
        }
      ]
    }
  };
}

function emptyPropagationReadinessReport(): PropagationReadinessReport {
  return {
    schema_version: "1.0.0",
    generated_at: "2026-01-01T00:00:00.000Z",
    company_id: "ENT-NVIDIA",
    summary: {
      contexts_total: 0,
      ready: 0,
      partial: 0,
      blocked: 0,
      contexts_with_observations: 0,
      contexts_with_source_plan: 0,
      contexts_with_component_leads: 0,
      reasoning_inputs: 0,
      no_fact_mutation_policy: "reasoning_input_only_no_fact_mutation"
    },
    ai_compute_matrix: {
      schema_version: "1.0.0",
      matrix_id: "ai_compute_propagation.v0",
      policy: "reasoning_input_only_no_fact_mutation",
      summary: {
        layers_total: 0,
        covered_fact: 0,
        observation_ready: 0,
        official_target_runnable: 0,
        lead_only: 0,
        unknown_open: 0,
        blocked_source: 0,
        layers_with_fact_refs: 0,
        layers_with_observation_refs: 0,
        layers_with_source_targets: 0,
        layers_with_frontier_refs: 0
      },
      layers: []
    },
    items: []
  };
}

function emptySupplyChainExpansionPlan(): SupplyChainExpansionPlan {
  return {
    schema_version: "1.0.0",
    generated_at: "2026-01-01T00:00:00.000Z",
    company_id: "ENT-NVIDIA",
    max_depth: 3,
    summary: {
      fact_edges_considered: 0,
      frontier_edges: 0,
      frontier_companies: 0,
      component_dependency_leads: 0,
      leads_with_fact_coverage: 0,
      leads_with_source_path: 0,
      leads_with_fact_capable_source_path: 0,
      leads_with_observation_source_path: 0,
      leads_with_lead_only_source_path: 0,
      lead_only_items: 0,
      observation_layer_items: 0,
      blocked_frontier_edges: 0,
      stop_conditions: 0,
      explicit_unknown_refs: 0
    },
    frontier: [],
    component_dependency_leads: [],
    stop_conditions: []
  };
}

function adjacentOfficialFactsReport(): Gate1AdjacentOfficialFactsReport {
  return {
    schema_version: "1.0.0",
    generated_at: "2026-01-01T00:00:00.000Z",
    company_id: "ENT-NVIDIA",
    summary: {
      fact_edges: 0,
      companies: 0,
      components: 0,
      source_adapters: 0,
      visible_edge_exclusions: 0,
      policy: "adjacent_context_only_no_fact_mutation"
    },
    edges: []
  };
}
