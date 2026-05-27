import { describe, expect, it } from "vitest";
import {
  buildPropagationReadinessReport,
  buildGate1DataDepthActionBatch,
  buildGate1DataDepthWorkbench,
  renderGate1DataDepthWorkbenchMarkdown,
  buildOfficialDisclosureReadinessReport,
  type SourceTargetCoverageReport
} from "@supplystrata/research-pack";
import type { SourcePlanItem } from "@supplystrata/source-plan";
import {
  adjacentOfficialFactsReportFixture,
  emptyWorkbench,
  emptySupplyChainExpansionPlanFixture,
  gate1DataDepthActionBatchDefinition,
  officialSourcePlanItem,
  officialSourceTargetCoverage
} from "./research-pack-fixtures.js";
import { emptyObservationCoverageReport, propagationReadinessWithAiComputeGaps } from "./research-pack-propagation-fixtures.js";

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
      supply_chain_expansion_plan: emptySupplyChainExpansionPlanFixture()
    });

    const layer = report.ai_compute_matrix.layers.find((item) => item.layer_id === "construction_to_equipment");
    if (layer === undefined) throw new Error("Expected construction_to_equipment layer");
    expect(layer.readiness_answers.source_targets.blocked_targets).toBe(1);
    expect(layer.readiness_answers.source_targets.missing_credentials).toBe(1);
    expect(layer.execution_queue.summary).toEqual(
      expect.objectContaining({
        items: 3,
        repair_source_target: 1,
        review_intelligence_context: 1,
        keep_unknown_open: 1,
        blocked_source_targets: 1
      })
    );
    expect(layer.execution_queue.items.find((item) => item.action === "repair_source_target")).toEqual(
      expect.objectContaining({
        source_target_refs: ["source_target:plan:nvidia-equipment-2025:asml-ir:official-html-disclosure:fixture:scheduled"],
        repair_reason: "failure_kind=missing_credentials; state=scheduled",
        automatic_fact_mutation_allowed: false
      })
    );
    expect(layer.readiness_answers.source_targets.blocked_refs).toEqual([
      "source_target:plan:nvidia-equipment-2025:asml-ir:official-html-disclosure:fixture:scheduled"
    ]);
    expect(layer.readiness_answers.source_targets.missing_credentials_refs).toEqual([
      "source_target:plan:nvidia-equipment-2025:asml-ir:official-html-disclosure:fixture:scheduled"
    ]);
    expect(layer.readiness_answers.output_policy.prohibited_truth_store_writes).toEqual([
      "create_fact_edge",
      "raise_evidence_level",
      "close_unknown",
      "convert_observation_to_evidence_without_review"
    ]);
    expect(layer).toEqual(
      expect.objectContaining({
        status: "blocked_source",
        source_target_groups: [
          expect.objectContaining({
            group_kind: "official_evidence",
            source_adapters: ["asml-ir"],
            target_kinds: ["official-html-disclosure"],
            failure_kinds: ["missing_credentials"]
          })
        ],
        source_target_statuses: [
          expect.objectContaining({
            source_adapter_id: "asml-ir",
            target_kind: "official-html-disclosure",
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
      supply_chain_expansion_plan: emptySupplyChainExpansionPlanFixture(),
      propagation_readiness: propagationReadinessWithAiComputeGaps(),
      adjacent_official_facts: adjacentOfficialFactsReportFixture(),
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
    expect(item?.rationale).toContain("official_source_not_reviewed source_group:official_evidence");
    expect(item?.refs).toContain("source_plan:asml-ir");
    expect(item?.refs).toContain("source_target:CHK-ASML:scheduled");
    expect(item?.refs).toContain("source_target_group:official_evidence");
    expect(item?.refs).toContain("official_evidence_gap:official_source_not_reviewed:source_group:official_evidence");
    expect(item?.refs).toContain("next_research_target:source_group:official_evidence");
    expect(item?.refs).toContain("unknown:UNK-EQUIPMENT");
    expect(item?.refs).toContain("unknown_seed:AI-COMPUTE-UNKNOWN-SEED-CONSTRUCTION-TO-EQUIPMENT");
    expect(item?.rationale).toContain("AI-COMPUTE-UNKNOWN-SEED-CONSTRUCTION-TO-EQUIPMENT run_source_target");
    expect(item?.source_adapters).toEqual(["asml-ir"]);
    expect(item?.action_source_groups).toEqual(["official_evidence"]);
    expect(item?.source_targets).toEqual([
      expect.objectContaining({
        check_target_id: "CHK-ASML",
        source_adapter_id: "asml-ir",
        target_kind: "official-html-disclosure",
        state: "scheduled",
        failure_kind: null
      })
    ]);
    expect(item?.source_target_status_summary).toEqual({
      targets: 1,
      runnable_targets: 1,
      blocked_targets: 0,
      degraded_targets: 0,
      missing_credentials: 0,
      source_failed_targets: 0,
      by_state: { scheduled: 1 },
      by_failure_kind: {}
    });
    expect(item?.readiness_answers?.official_evidence).toEqual({ gaps: 1, by_gap_kind: { official_source_not_reviewed: 1 } });
    expect(item?.readiness_answers?.unknowns.existing_unknowns).toBe(1);
    expect(item?.readiness_answers?.unknowns.seeds).toBe(1);
    expect(item?.readiness_answers?.unknowns.by_recommended_review_action).toEqual({ run_source_target: 1 });
    expect(item?.readiness_answers?.source_targets.targets).toBe(2);
    expect(item?.readiness_answers?.source_targets.runnable_targets).toBe(2);
    expect(item?.readiness_answers?.source_targets.blocked_targets).toBe(0);
    expect(item?.readiness_answers?.source_targets.runnable_refs).toEqual([
      "source_target:CHK-ASML:scheduled",
      "source_target:plan:nvidia-memory-2025:census-trade:trade-flow-observation:fixture:not_synced"
    ]);
    expect(item?.execution_queue?.summary).toEqual(
      expect.objectContaining({
        items: 3,
        run_source_target: 1,
        repair_source_target: 0,
        review_intelligence_context: 1,
        keep_unknown_open: 1,
        runnable_source_targets: 1,
        unknown_refs: 2
      })
    );
    expect(item?.execution_queue?.items.find((queueItem) => queueItem.action === "run_source_target")?.source_target_refs).toEqual([
      "source_target:CHK-ASML:scheduled"
    ]);
    expect(item?.execution_queue?.items.find((queueItem) => queueItem.action === "run_source_target")?.source_target_actions).toEqual([
      expect.objectContaining({
        source_target_ref: "source_target:CHK-ASML:scheduled",
        check_target_id: "CHK-ASML",
        source_adapter_id: "asml-ir",
        target_kind: "official-html-disclosure",
        state: "scheduled",
        recommended_cli_command: "pnpm --silent cli sources run-due --check-target-id CHK-ASML --format markdown",
        writes_truth_store: true,
        requires_database: true
      })
    ]);
    expect(item?.execution_queue?.items.map((queueItem) => queueItem.action)).toEqual([
      "run_source_target",
      "review_intelligence_context",
      "keep_unknown_open"
    ]);
    expect(item?.evidence_layer_summary?.map((summary) => [summary.layer_kind, summary.count])).toEqual([
      ["unknown", 2],
      ["source_target", 2],
      ["official_evidence_gap", 3]
    ]);
    expect(item?.evidence_layer_summary?.find((summary) => summary.layer_kind === "source_target")?.prohibited_truth_store_writes).toEqual([
      "create_fact_edge"
    ]);
    expect(item?.official_evidence_gaps).toEqual([
      expect.objectContaining({
        gap_kind: "official_source_not_reviewed",
        target_kind: "source_group",
        target_id: "official_evidence",
        truth_store_write_policy: "review_only_no_automatic_write"
      })
    ]);
    expect(item?.unknown_backlog_summary).toEqual(
      expect.objectContaining({
        existing_unknowns: 1,
        seeds: 1,
        by_recommended_review_action: { run_source_target: 1 },
        truth_store_write_policy: "review_only_no_automatic_write"
      })
    );
    expect(item?.command_hints[0]?.command).toContain("--source asml-ir");
    expect(item?.command_hints[0]?.command).not.toContain("census-trade");
    expect(workbenchModel.summary.ai_compute_propagation_layers_not_covered).toBe(2);
    expect(workbenchModel.summary.ai_compute_propagation_unknown_open).toBe(0);
    expect(workbenchModel.summary.ai_compute_official_evidence_gaps).toBe(3);
    expect(workbenchModel.summary.ai_compute_official_evidence_gaps_by_kind).toEqual({
      component_without_l4_l5_fact: 1,
      official_source_blocked: 1,
      official_source_not_reviewed: 1
    });

    const coveredGapItem = workbenchModel.items.find((candidate) => candidate.item_id === "gate1-ai-compute-propagation:demand_to_compute");
    expect(coveredGapItem).toEqual(
      expect.objectContaining({
        priority: "P2",
        recommended_decision: "keep_unknown_open",
        title: "Close partial AI compute evidence gaps: Demand to compute"
      })
    );
    expect(coveredGapItem?.refs).toContain("official_evidence_gap:component_without_l4_l5_fact:component:COMP-HBM");

    const blockedItem = workbenchModel.items.find((candidate) => candidate.item_id === "gate1-ai-compute-propagation:equipment_to_process_inputs");
    expect(blockedItem).toEqual(
      expect.objectContaining({
        priority: "P1",
        recommended_decision: "rerun_source_check"
      })
    );
    expect(blockedItem?.rationale).toContain("missing_credentials");
    expect(blockedItem?.rationale).toContain("official_source_blocked source_group:official_evidence");
    expect(blockedItem?.refs).toContain("source_target_group:official_evidence");
    expect(blockedItem?.refs).toContain("official_evidence_gap:official_source_blocked:source_group:official_evidence");
    expect(blockedItem?.source_adapters).toEqual(["materials-ir"]);
    expect(blockedItem?.source_targets).toEqual([
      expect.objectContaining({
        check_target_id: "CHK-MATERIALS",
        source_adapter_id: "materials-ir",
        target_kind: "official-html-disclosure",
        state: "retry_wait",
        failure_kind: "missing_credentials"
      })
    ]);
    expect(blockedItem?.source_target_status_summary).toEqual({
      targets: 1,
      runnable_targets: 0,
      blocked_targets: 1,
      degraded_targets: 0,
      missing_credentials: 1,
      source_failed_targets: 0,
      by_state: { retry_wait: 1 },
      by_failure_kind: { missing_credentials: 1 }
    });
    expect(blockedItem?.execution_queue?.items.find((queueItem) => queueItem.action === "repair_source_target")?.source_target_actions).toEqual([
      expect.objectContaining({
        source_target_ref: "source_target:CHK-MATERIALS:retry_wait",
        check_target_id: "CHK-MATERIALS",
        source_adapter_id: "materials-ir",
        target_kind: "official-html-disclosure",
        state: "retry_wait",
        failure_kind: "missing_credentials",
        recommended_cli_command: "pnpm --silent cli sources due --check-target-id CHK-MATERIALS --format markdown",
        writes_truth_store: false,
        requires_database: true
      })
    ]);
    expect(workbenchModel.summary.ai_compute_propagation_blocked_source).toBe(1);

    const batch = buildGate1DataDepthActionBatch(workbenchModel, gate1DataDepthActionBatchDefinition("intelligence_context"));
    expect(batch.items.some((candidate) => candidate.item_id === "gate1-ai-compute-propagation:construction_to_equipment")).toBe(true);
    expect(batch.items.some((candidate) => candidate.item_id === "gate1-ai-compute-propagation:equipment_to_process_inputs")).toBe(true);
    expect(batch.items.find((candidate) => candidate.item_id === "gate1-ai-compute-propagation:construction_to_equipment")?.evidence_layer_summary).toEqual(
      item?.evidence_layer_summary
    );
    expect(batch.items.find((candidate) => candidate.item_id === "gate1-ai-compute-propagation:construction_to_equipment")?.official_evidence_gaps).toEqual(
      item?.official_evidence_gaps
    );
    expect(batch.items.find((candidate) => candidate.item_id === "gate1-ai-compute-propagation:construction_to_equipment")?.readiness_answers).toEqual(
      item?.readiness_answers
    );
    expect(batch.items.find((candidate) => candidate.item_id === "gate1-ai-compute-propagation:construction_to_equipment")?.execution_queue).toEqual(
      item?.execution_queue
    );
    expect(renderGate1DataDepthWorkbenchMarkdown(workbenchModel)).toContain("Evidence layer summary: unknown=2");
    expect(renderGate1DataDepthWorkbenchMarkdown(workbenchModel)).toContain(
      "Readiness answers: facts=0; non_fact_inputs=0; official_gaps=1(official_source_not_reviewed=1); unknowns=1+1(run_source_target=1)"
    );
    expect(renderGate1DataDepthWorkbenchMarkdown(workbenchModel)).toContain(
      "Execution queue: items=3; run=1; repair=0; review=1; keep_unknown=1; p1=1; p2=2; runnable_targets=1; blocked_targets=0; unknown_refs=2"
    );
    expect(renderGate1DataDepthWorkbenchMarkdown(workbenchModel)).toContain(
      'Execution source-target actions: asml-ir/official-html-disclosure target=CHK-ASML state=scheduled failure=none writes=true command="pnpm --silent cli sources run-due --check-target-id CHK-ASML --format markdown"'
    );
    expect(renderGate1DataDepthWorkbenchMarkdown(workbenchModel)).toContain("Action source groups: official_evidence");
    expect(renderGate1DataDepthWorkbenchMarkdown(workbenchModel)).toContain(
      'Official evidence gaps: official_source_not_reviewed:source_group:official_evidence action="Run this source target through review paths."'
    );
    expect(renderGate1DataDepthWorkbenchMarkdown(workbenchModel)).toContain(
      "Source target status summary: targets=1; runnable=1; blocked=0; degraded=0; missing_credentials=0; source_failed=0; by_state=scheduled=1; by_failure=none"
    );
    expect(renderGate1DataDepthWorkbenchMarkdown(workbenchModel)).toContain(
      "Unknown/backlog summary: existing=1; seeds=1; by_action=run_source_target=1; policy=review_only_no_automatic_write"
    );
  });

  it("does not borrow unrelated source targets from a broad source-plan item", () => {
    const sourcePlan = [broadEquipmentAndMaterialsSourcePlanItem()];
    const sourceTargetCoverage = sourceTargetCoverageForUnrelatedProcessInput();
    const officialDisclosureReadiness = buildOfficialDisclosureReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench: emptyWorkbench(),
      component_ids: ["COMP-SEMICONDUCTOR-EQUIPMENT", "COMP-CMP"],
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
      supply_chain_expansion_plan: emptySupplyChainExpansionPlanFixture()
    });

    const equipmentLayer = report.ai_compute_matrix.layers.find((item) => item.layer_id === "construction_to_equipment");
    const processInputLayer = report.ai_compute_matrix.layers.find((item) => item.layer_id === "equipment_to_process_inputs");
    expect(equipmentLayer?.source_target_status_summary).toEqual({
      targets: 0,
      runnable_targets: 0,
      blocked_targets: 0,
      degraded_targets: 0,
      missing_credentials: 0,
      source_failed_targets: 0,
      by_state: {},
      by_failure_kind: {}
    });
    expect(equipmentLayer?.source_target_statuses).toEqual([]);
    expect(processInputLayer?.source_target_status_summary).toEqual(
      expect.objectContaining({
        targets: 1,
        runnable_targets: 1,
        blocked_targets: 0,
        by_state: { scheduled: 1 }
      })
    );
    expect(processInputLayer?.source_target_statuses).toEqual([
      expect.objectContaining({
        source_adapter_id: "census-trade",
        target_kind: "trade-flow-observation",
        state: "scheduled"
      })
    ]);
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

function broadEquipmentAndMaterialsSourcePlanItem(): SourcePlanItem {
  return {
    source_id: "sec-edgar",
    source_name: "SEC EDGAR",
    purpose: "official_disclosure",
    priority: "P0",
    status: "preview",
    automation: "allowed",
    requires_key: false,
    expected_output_layer: "edge",
    relation_policy: "can_create_fact_edge",
    parent_component_ids: ["COMP-SEMICONDUCTOR-EQUIPMENT"],
    target_ids: ["COMP-SEMICONDUCTOR-EQUIPMENT", "COMP-CMP", "ENT-NVIDIA"],
    trigger_dependency_ids: ["CDEP-BROAD"],
    reasons: ["Broad company filings can mention multiple components, but a layer must not inherit unrelated target status."],
    suggested_check_targets: [
      {
        source_adapter_id: "sec-edgar",
        target_kind: "sec-company-facts",
        runnable: true,
        target_config: { entity_id: "ENT-NVIDIA", cik: "0001045810" },
        reason: "Company-level financial target is intentionally not component-scoped."
      }
    ]
  };
}

function sourceTargetCoverageForUnrelatedProcessInput(): SourceTargetCoverageReport {
  const report = officialSourceTargetCoverage("scheduled");
  const item = report.items[0];
  if (item === undefined) throw new Error("Expected source target coverage fixture item");
  return {
    ...report,
    items: [
      {
        ...item,
        expected_target: {
          ...item.expected_target,
          check_target_id: "plan:nvidia-process-2025:census-trade:trade-flow-observation:cmp",
          source_adapter_id: "census-trade",
          target_kind: "trade-flow-observation",
          target_config: { component_id: "COMP-CMP", scope_kind: "component", scope_id: "COMP-CMP", commodity_code: "382499" }
        },
        matched_check_target_id: "plan:nvidia-process-2025:census-trade:trade-flow-observation:cmp",
        state: "scheduled",
        latest_job: null,
        latest_event: null
      }
    ]
  };
}
