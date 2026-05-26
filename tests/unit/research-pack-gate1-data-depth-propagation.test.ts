import { describe, expect, it } from "vitest";
import {
  buildPropagationReadinessReport,
  buildGate1DataDepthActionBatch,
  buildGate1DataDepthWorkbench,
  buildObservationCoverageReport,
  buildOfficialDisclosureReadinessReport,
  type Gate1AdjacentOfficialFactsReport,
  type PropagationReadinessReport,
  type SourceTargetCoverageReport,
  type SupplyChainExpansionPlan
} from "@supplystrata/research-pack";
import type { SourcePlanItem } from "@supplystrata/source-plan";
import { emptyWorkbench, gate1DataDepthActionBatchDefinition, officialSourcePlanItem, officialSourceTargetCoverage } from "./research-pack-fixtures.js";

describe("Gate 1 data-depth AI compute propagation", () => {
  it("classifies missing credentials as a blocked AI compute source target", () => {
    const sourcePlan = [equipmentSourcePlanItem()];
    const sourceTargetCoverage = sourceTargetCoverageWithMissingCredentials();
    const officialDisclosureReadiness = buildOfficialDisclosureReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench: emptyWorkbench(),
      component_ids: ["COMP-SEMICONDUCTOR-EQUIPMENT"],
      source_plan: sourcePlan,
      source_target_coverage: sourceTargetCoverage
    });

    const report = buildPropagationReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench: emptyWorkbench(),
      observation_coverage: emptyObservationCoverageReport(),
      official_disclosure_readiness: officialDisclosureReadiness,
      source_plan: sourcePlan,
      source_target_coverage: sourceTargetCoverage,
      supply_chain_expansion_plan: emptySupplyChainExpansionPlan()
    });

    const layer = report.ai_compute_matrix.layers.find((item) => item.layer_id === "construction_to_equipment");
    expect(layer).toEqual(
      expect.objectContaining({
        status: "blocked_source",
        source_target_statuses: [
          expect.objectContaining({
            source_adapter_id: "asml-ir",
            state: "scheduled",
            failure_kind: "missing_credentials"
          })
        ]
      })
    );
  });

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
    expect(item?.rationale).toContain("Missing official evidence");
    expect(item?.refs).toContain("source_plan:asml-ir");
    expect(item?.refs).toContain("source_target:CHK-ASML:scheduled");
    expect(item?.refs).toContain("unknown:UNK-EQUIPMENT");
    expect(item?.refs).toContain("unknown_seed:AI-COMPUTE-UNKNOWN-SEED-CONSTRUCTION-TO-EQUIPMENT");
    expect(item?.rationale).toContain("AI-COMPUTE-UNKNOWN-SEED-CONSTRUCTION-TO-EQUIPMENT run_source_target");
    expect(item?.source_adapters).toEqual(["asml-ir"]);
    expect(item?.command_hints[0]?.command).toContain("--source asml-ir");
    expect(workbenchModel.summary.ai_compute_propagation_layers_not_covered).toBe(2);
    expect(workbenchModel.summary.ai_compute_propagation_unknown_open).toBe(0);

    const blockedItem = workbenchModel.items.find((candidate) => candidate.item_id === "gate1-ai-compute-propagation:equipment_to_process_inputs");
    expect(blockedItem).toEqual(
      expect.objectContaining({
        priority: "P1",
        recommended_decision: "rerun_source_check"
      })
    );
    expect(blockedItem?.rationale).toContain("missing_credentials");
    expect(blockedItem?.source_adapters).toEqual(["materials-ir"]);
    expect(workbenchModel.summary.ai_compute_propagation_blocked_source).toBe(1);

    const batch = buildGate1DataDepthActionBatch(workbenchModel, gate1DataDepthActionBatchDefinition("intelligence_context"));
    expect(batch.items.some((candidate) => candidate.item_id === "gate1-ai-compute-propagation:construction_to_equipment")).toBe(true);
    expect(batch.items.some((candidate) => candidate.item_id === "gate1-ai-compute-propagation:equipment_to_process_inputs")).toBe(true);
  });
});

function equipmentSourcePlanItem(): SourcePlanItem {
  return {
    source_id: "asml-ir",
    source_name: "ASML Investor Relations",
    purpose: "official_disclosure",
    priority: "P0",
    status: "preview",
    automation: "allowed",
    requires_key: false,
    expected_output_layer: "edge",
    relation_policy: "can_create_fact_edge",
    parent_component_ids: ["COMP-SEMICONDUCTOR-EQUIPMENT"],
    target_ids: ["COMP-SEMICONDUCTOR-EQUIPMENT"],
    trigger_dependency_ids: ["CDEP-EQUIPMENT"],
    reasons: ["ASML IR can disclose semiconductor equipment context."],
    suggested_check_targets: [
      {
        source_adapter_id: "asml-ir",
        target_kind: "official-html-disclosure",
        runnable: true,
        target_config: { entity_id: "ENT-ASML", year: 2025 },
        reason: "ASML IR can provide equipment disclosure context."
      }
    ]
  };
}

function sourceTargetCoverageWithMissingCredentials(): SourceTargetCoverageReport {
  const report = officialSourceTargetCoverage("scheduled");
  const item = report.items[0];
  if (item === undefined) throw new Error("Expected source target coverage fixture item");
  return {
    ...report,
    summary: {
      ...report.summary,
      source_failure_kinds: {
        ...report.summary.source_failure_kinds,
        missing_credentials: 1
      }
    },
    items: [
      {
        ...item,
        expected_target: {
          ...item.expected_target,
          check_target_id: "plan:nvidia-equipment-2025:asml-ir:official-html-disclosure:fixture",
          source_adapter_id: "asml-ir",
          target_config: { entity_id: "ENT-ASML", year: 2025 }
        },
        matched_check_target_id: "plan:nvidia-equipment-2025:asml-ir:official-html-disclosure:fixture",
        latest_job: {
          job_id: "JOB-ASML-MISSING-CREDENTIALS",
          status: "failed",
          attempts: 1,
          last_error: "Missing required source credentials: ASML_API_KEY",
          failure_kind: "missing_credentials",
          next_attempt_at: "2026-01-01T01:00:00.000Z",
          completed_at: "2026-01-01T00:30:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:30:00.000Z"
        }
      }
    ]
  };
}

function emptyObservationCoverageReport(): Parameters<typeof buildPropagationReadinessReport>[0]["observation_coverage"] {
  return buildObservationCoverageReport({
    generated_at: "2026-01-01T00:00:00.000Z",
    company_id: "ENT-NVIDIA",
    workbench: { chain_segments: [] },
    company: null,
    components: []
  });
}

function propagationReadinessWithAiComputeGaps(): PropagationReadinessReport {
  return {
    ...emptyPropagationReadinessReport(),
    ai_compute_matrix: {
      schema_version: "1.0.0",
      matrix_id: "ai_compute_propagation.v0",
      policy: "reasoning_input_only_no_fact_mutation",
      summary: {
        layers_total: 3,
        covered_fact: 1,
        observation_ready: 0,
        official_target_runnable: 1,
        lead_only: 0,
        unknown_open: 0,
        blocked_source: 1,
        layers_with_fact_refs: 1,
        layers_with_observation_refs: 0,
        layers_with_source_targets: 2,
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
          source_target_statuses: [],
          component_dependency_refs: [],
          frontier_refs: [],
          unknown_refs: [],
          unknown_backlog_seeds: [],
          missing_official_evidence: [],
          allowed_research_outputs: ["chain_anchor", "corroboration_review", "strength_freshness_review"],
          prohibited_truth_store_writes: ["raise_evidence_level_without_review", "close_unknown_without_review"],
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
          source_target_statuses: [
            {
              ref: "source_target:CHK-ASML:scheduled",
              source_adapter_id: "asml-ir",
              state: "scheduled",
              failure_kind: null,
              latest_event_type: null
            }
          ],
          component_dependency_refs: [],
          frontier_refs: [],
          unknown_refs: ["unknown:UNK-EQUIPMENT"],
          unknown_backlog_seeds: [
            {
              seed_id: "AI-COMPUTE-UNKNOWN-SEED-CONSTRUCTION-TO-EQUIPMENT",
              question:
                "Which reviewed citation from the planned official source can answer: Can the pack identify equipment delivery or qualification frontier?",
              why_unknown: "A source path exists, but no reviewed citation has been accepted into the evidence layer yet.",
              target_scope_refs: ["component:COMP-SEMICONDUCTOR-EQUIPMENT"],
              existing_unknown_refs: ["unknown:UNK-EQUIPMENT"],
              source_plan_refs: ["source_plan:asml-ir"],
              source_target_refs: ["source_target:CHK-ASML:scheduled"],
              recommended_review_action: "run_source_target",
              truth_store_write_policy: "review_only_no_automatic_write"
            }
          ],
          missing_official_evidence: [
            "Run or sync the listed official source targets, then review extracted citations through the existing review/apply path."
          ],
          allowed_research_outputs: ["source_target_action", "review_queue_seed"],
          prohibited_truth_store_writes: ["create_fact_edge", "raise_evidence_level", "close_unknown", "convert_observation_to_evidence_without_review"],
          next_actions: ["Sync/enable/run the listed source targets, then review outputs through controlled paths."],
          policy: "reasoning_input_only_no_fact_mutation"
        },
        {
          layer_id: "equipment_to_process_inputs",
          title: "Equipment to process inputs",
          question: "Can the pack name process consumables?",
          status: "blocked_source",
          status_reason: "A matching source target exists but is blocked by missing_credentials.",
          component_ids: ["COMP-PHOTORESIST"],
          material_or_process_refs: [],
          fact_edge_refs: [],
          observation_refs: [],
          observation_series_refs: [],
          source_plan_refs: [],
          source_target_refs: ["source_target:CHK-MATERIALS:retry_wait"],
          source_target_statuses: [
            {
              ref: "source_target:CHK-MATERIALS:retry_wait",
              source_adapter_id: "materials-ir",
              state: "retry_wait",
              failure_kind: "missing_credentials",
              latest_event_type: null
            }
          ],
          component_dependency_refs: [],
          frontier_refs: [],
          unknown_refs: [],
          unknown_backlog_seeds: [
            {
              seed_id: "AI-COMPUTE-UNKNOWN-SEED-EQUIPMENT-TO-PROCESS-INPUTS",
              question: "Which official source target must be repaired before the Equipment to process inputs layer can be researched?",
              why_unknown: "A relevant source target exists, but its current operational state prevents evidence collection.",
              target_scope_refs: ["component:COMP-PHOTORESIST"],
              existing_unknown_refs: [],
              source_plan_refs: [],
              source_target_refs: ["source_target:CHK-MATERIALS:retry_wait"],
              recommended_review_action: "repair_source_target",
              truth_store_write_policy: "review_only_no_automatic_write"
            }
          ],
          missing_official_evidence: ["Repair the blocked/degraded official source target and rerun it before relying on this layer."],
          allowed_research_outputs: ["source_repair_action", "operational_backlog"],
          prohibited_truth_store_writes: ["create_fact_edge", "raise_evidence_level", "close_unknown", "convert_observation_to_evidence_without_review"],
          next_actions: ["Inspect source target failure/degradation before relying on this layer."],
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
