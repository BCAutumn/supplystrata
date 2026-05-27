import { describe, expect, it } from "vitest";
import { buildGate1RunLedger, renderGate1RunLedgerMarkdown } from "@supplystrata/research-pack";
import {
  corroborationSourcePlanFixture,
  officialDisclosureReadinessFixture,
  supplyChainExpansionPlanFixture
} from "./research-pack-gate1-run-ledger-fixtures.js";
import { propagationReadinessWithAiComputeGaps } from "./research-pack-propagation-fixtures.js";

describe("Gate 1 propagation execution ledger", () => {
  it("surfaces propagation execution queue in the main Gate 1 run ledger", () => {
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
      supply_chain_expansion_plan: supplyChainExpansionPlanFixture(),
      propagation_readiness: propagationReadinessWithAiComputeGaps()
    });

    expect(ledger.propagation_execution.summary).toEqual(
      expect.objectContaining({
        layers: 3,
        queue_items: 7,
        run_source_target: 1,
        repair_source_target: 1,
        review_intelligence_context: 3,
        keep_unknown_open: 2,
        runnable_source_targets: 2,
        blocked_source_targets: 1
      })
    );
    expect(ledger.propagation_execution.layers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          layer_id: "construction_to_equipment",
          run_source_target: 1,
          runnable_source_targets: 2
        }),
        expect.objectContaining({
          layer_id: "equipment_to_process_inputs",
          repair_source_target: 1,
          blocked_source_targets: 1
        })
      ])
    );
    expect(ledger.action_queue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action_id: "gate1:propagation:construction-to-equipment:run_source_target:wait_for_scheduled_targets:selected-source-targets",
          kind: "wait_for_scheduled_targets",
          command_hint: "supplystrata sources due --check-target-id CHK-ASML --format markdown"
        }),
        expect.objectContaining({
          action_id: "gate1:propagation:construction-to-equipment:run_source_target:sync_targets:census-trade-trade-flow-observation",
          kind: "sync_targets",
          command_hint:
            "supplystrata sources policy sync-plan-targets --source-plan source-plan.json --namespace gate1-review-test --check-target-id plan:nvidia-memory-2025:census-trade:trade-flow-observation:fixture"
        }),
        expect.objectContaining({
          action_id: "gate1:propagation:equipment-to-process-inputs:repair_source_target:investigate_source_failures:selected-source-targets",
          kind: "investigate_source_failures",
          command_hint: "supplystrata sources due --check-target-id CHK-MATERIALS --format markdown"
        })
      ])
    );
    expect(
      ledger.action_queue.find(
        (action) =>
          action.action_id === "gate1:propagation:equipment-to-process-inputs:repair_source_target:investigate_source_failures:selected-source-targets"
      )?.rationale
    ).toContain("failure_kind=missing_credentials");
    expect(ledger.review_workbench.items.some((item) => item.command_hint === "supplystrata sources due --check-target-id CHK-ASML --format markdown")).toBe(
      false
    );
    expect(renderGate1RunLedgerMarkdown(ledger)).toContain("Propagation Execution");
    expect(renderGate1RunLedgerMarkdown(ledger)).toContain("Repair source target: 1");
  });

  it("splits large propagation source-target actions into bounded exact-id batches", () => {
    const readiness = propagationReadinessWithAiComputeGaps();
    const extraRefs = Array.from(
      { length: 11 },
      (_, index) => `source_target:plan:nvidia-memory-2025:census-trade:trade-flow-observation:extra-${index + 1}:not_synced`
    );
    const propagationReadiness = {
      ...readiness,
      ai_compute_matrix: {
        ...readiness.ai_compute_matrix,
        layers: readiness.ai_compute_matrix.layers.map((layer) =>
          layer.layer_id === "construction_to_equipment"
            ? {
                ...layer,
                source_target_statuses: [
                  ...layer.source_target_statuses,
                  ...extraRefs.map((ref) => ({
                    ref,
                    source_adapter_id: "census-trade",
                    target_kind: "trade-flow-observation",
                    state: "not_synced" as const,
                    latest_event_type: null,
                    failure_kind: null,
                    observation_count: 0
                  }))
                ],
                execution_queue: {
                  ...layer.execution_queue,
                  items: layer.execution_queue.items.map((item) =>
                    item.action === "run_source_target"
                      ? {
                          ...item,
                          source_target_refs: [...item.source_target_refs, ...extraRefs],
                          source_target_actions: [
                            ...item.source_target_actions,
                            ...extraRefs.map((ref) => ({
                              source_target_ref: ref,
                              check_target_id: checkTargetIdFromSourceTargetRef(ref),
                              source_adapter_id: "census-trade",
                              target_kind: "trade-flow-observation",
                              state: "not_synced",
                              failure_kind: null,
                              latest_event_type: null,
                              recommended_cli_command: null,
                              writes_truth_store: true,
                              requires_database: true
                            }))
                          ]
                        }
                      : item
                  )
                }
              }
            : layer
        )
      }
    };
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
      supply_chain_expansion_plan: supplyChainExpansionPlanFixture(),
      propagation_readiness: propagationReadiness
    });

    const syncBatches = ledger.action_queue.filter((action) =>
      action.action_id.startsWith("gate1:propagation:construction-to-equipment:run_source_target:sync_targets:census-trade-trade-flow-observation")
    );
    expect(syncBatches.length).toBe(2);
    expect(syncBatches.map((action) => action.command_hint?.match(/--check-target-id ([^ ]+)/)?.[1]?.split(",").length)).toEqual([10, 2]);
  });

  it("uses source-target action state as the execution source of truth", () => {
    const readiness = propagationReadinessWithAiComputeGaps();
    const propagationReadiness = {
      ...readiness,
      ai_compute_matrix: {
        ...readiness.ai_compute_matrix,
        layers: readiness.ai_compute_matrix.layers.map((layer) =>
          layer.layer_id === "construction_to_equipment"
            ? {
                ...layer,
                source_target_statuses: layer.source_target_statuses.map((status) =>
                  status.ref === "source_target:plan:nvidia-memory-2025:census-trade:trade-flow-observation:fixture:not_synced"
                    ? { ...status, state: "due" }
                    : status
                )
              }
            : layer
        )
      }
    };
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
      supply_chain_expansion_plan: supplyChainExpansionPlanFixture(),
      propagation_readiness: propagationReadiness
    });

    expect(ledger.action_queue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action_id: "gate1:propagation:construction-to-equipment:run_source_target:sync_targets:census-trade-trade-flow-observation",
          kind: "sync_targets",
          command_hint:
            "supplystrata sources policy sync-plan-targets --source-plan source-plan.json --namespace gate1-review-test --check-target-id plan:nvidia-memory-2025:census-trade:trade-flow-observation:fixture"
        })
      ])
    );
    expect(
      ledger.action_queue.some(
        (action) =>
          action.kind === "run_due_targets" && action.command_hint?.includes("plan:nvidia-memory-2025:census-trade:trade-flow-observation:fixture") === true
      )
    ).toBe(false);
  });
});

function checkTargetIdFromSourceTargetRef(ref: string): string | null {
  if (!ref.startsWith("source_target:")) return null;
  const body = ref.slice("source_target:".length);
  const lastSeparator = body.lastIndexOf(":");
  if (lastSeparator <= 0) return body.length === 0 ? null : body;
  return body.slice(0, lastSeparator);
}
