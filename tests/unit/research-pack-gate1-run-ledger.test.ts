import { describe, expect, it } from "vitest";
import { buildGate1RunLedger, renderGate1RunLedgerMarkdown } from "@supplystrata/research-pack";
import {
  corroborationSourcePlanFixture,
  officialDisclosureReadinessFixture,
  samsungMemoryAffiliation,
  samsungMemoryAffiliationWithDisposition,
  sourceTargetCoverageFixture,
  sourceTargetPreflightFixture,
  supplyChainExpansionPlanFixture
} from "./research-pack-gate1-run-ledger-fixtures.js";

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
    expect(ledger.scorecard.fact_edge_scope).toBe("research_pack_visible_target_profile_l4_l5_edges");
    expect(ledger.data_progress.fact_edge_scope).toBe("research_pack_visible_target_profile_l4_l5_edges");
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
          item.kind === "official_signal_disposition" &&
          item.command_hint?.includes("review signal-disposition") === true &&
          item.command_hint.includes("--decision record_single_source_unknown")
      )
    ).toBe(true);
    expect(ledger.data_progress.open_official_signal_correlation_hints).toBe(1);
    expect(ledger.action_queue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action_id: "gate1:official-signals:disposition",
          kind: "record_official_signal_dispositions",
          priority: "P1"
        })
      ])
    );
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
    expect(renderGate1RunLedgerMarkdown(ledger)).toContain("Fact edge scope: research_pack_visible_target_profile_l4_l5_edges");
    expect(renderGate1RunLedgerMarkdown(ledger)).toContain("fact mutation: false");
  });

  it("does not re-open edge corroboration review items after single-source disposition is recorded", () => {
    const readiness = officialDisclosureReadinessFixture();
    readiness.corroboration_queue = readiness.corroboration_queue.map((item) => ({
      ...item,
      disposition: "single_source_disposition_recorded",
      reason: "Single-source disposition already recorded.",
      unknown_ids: ["UNK-EDGE-1-SINGLE-SOURCE"],
      latest_disposition: {
        change_id: "CHG-EDGE-CORROBORATION-RECORDED-1",
        edge_id: item.edge_id,
        decision: "record_single_source_unknown",
        reviewer: "unit-test",
        reason: "Counterparty official target completed without edge-specific second-source evidence.",
        evidence_id: null,
        unknown_id: null,
        check_target_id: "CHK-SAMSUNG-IR",
        recorded_at: "2026-05-26T00:00:00.000Z"
      },
      proposed_unknown: null,
      action: "Review linked single-source unknown during research updates."
    }));
    const ledger = buildGate1RunLedger({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      research_input: {
        company: "ENT-NVIDIA",
        depth: 3,
        officialDisclosureYear: "2025",
        sourceTargetNamespace: "gate1-review-test"
      },
      official_disclosure_readiness: readiness,
      corroboration_source_plan: {
        ...corroborationSourcePlanFixture(),
        summary: { ...corroborationSourcePlanFixture().summary, runnable_targets: 0, by_next_action: {} },
        target_refs: [],
        source_plan: []
      },
      supply_chain_expansion_plan: supplyChainExpansionPlanFixture()
    });

    expect(ledger.review_workbench.items.some((item) => item.kind === "edge_corroboration")).toBe(false);
    expect(ledger.action_queue.some((action) => action.action_id === "gate1:corroboration:review-observations")).toBe(false);
  });

  it("turns source target coverage into operational monitoring batches", () => {
    const readiness = officialDisclosureReadinessFixture();
    readiness.summary.synced_official_targets = 8;
    const ledger = buildGate1RunLedger({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      research_input: {
        company: "ENT-NVIDIA",
        depth: 3,
        officialDisclosureYear: "2025",
        sourceTargetNamespace: "gate1-review-test"
      },
      official_disclosure_readiness: readiness,
      corroboration_source_plan: corroborationSourcePlanFixture(),
      supply_chain_expansion_plan: supplyChainExpansionPlanFixture(),
      source_target_coverage: sourceTargetCoverageFixture()
    });

    const officialBatch = ledger.monitoring_config.batches.find((batch) => batch.batch_id === "official_source_path");

    expect(officialBatch).toEqual(
      expect.objectContaining({
        current_state: "retry_wait",
        recommended_next_decision: "defer",
        recommended_operational_action: "investigate_source_failure",
        attention_hint: "2 targets need credentials before they can produce monitoring data."
      })
    );
    expect(officialBatch?.state_counts).toEqual(
      expect.objectContaining({
        disabled: 1,
        enabled: 7,
        retry_wait: 2,
        degraded: 1,
        source_failed: 2,
        missing_credentials: 2
      })
    );
    expect(ledger.source_path_progress.enabled_targets).toBe(7);
    expect(ledger.source_path_progress.retry_wait_targets).toBe(2);
    expect(ledger.action_queue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action_id: "gate1:source-failures:triage",
          kind: "investigate_source_failures",
          priority: "P0"
        })
      ])
    );
    expect(renderGate1RunLedgerMarkdown(ledger)).toContain("action=investigate_source_failure");
  });

  it("uses exact check target ids for due official source target actions", () => {
    const coverage = sourceTargetCoverageFixture();
    coverage.summary = {
      ...coverage.summary,
      enabled_targets: 8,
      due_targets: 1,
      retry_wait: 0,
      degraded_targets: 0,
      source_failed_targets: 0,
      source_failure_kinds: {
        missing_credentials: 0,
        target_config_invalid: 0,
        source_unreachable: 0,
        source_response_error: 0,
        rate_limited: 0,
        adapter_error: 0,
        unknown_failure: 0
      }
    };
    const firstCoverageItem = coverage.items[0];
    if (firstCoverageItem === undefined) throw new Error("sourceTargetCoverageFixture must include at least one item");
    coverage.items = [{ ...firstCoverageItem, state: "due", latest_event: null, latest_job: null }];

    const readiness = officialDisclosureReadinessFixture();
    readiness.summary.synced_official_targets = 8;
    const ledger = buildGate1RunLedger({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      research_input: {
        company: "ENT-NVIDIA",
        depth: 3,
        officialDisclosureYear: "2025",
        sourceTargetNamespace: "gate1-review-test"
      },
      official_disclosure_readiness: readiness,
      corroboration_source_plan: corroborationSourcePlanFixture(),
      supply_chain_expansion_plan: supplyChainExpansionPlanFixture(),
      source_target_coverage: coverage
    });

    const runDueAction = ledger.action_queue.find((action) => action.action_id === "gate1:source-targets:run-due");
    expect(runDueAction?.command_hint).toBe("supplystrata sources run-due --check-target-id target-dart --format markdown");
    expect(runDueAction?.command_hint).not.toContain("--source-plan");
    expect(
      ledger.review_workbench.items.some(
        (item) =>
          item.kind === "source_target_batch" &&
          item.recommended_decision === "approve_run_due" &&
          item.command_hint === "supplystrata sources run-due --check-target-id target-dart --format markdown"
      )
    ).toBe(true);
  });

  it("does not force smoke-first when corroboration preflight already failed", () => {
    const corroborationPlan = corroborationSourcePlanFixture();
    corroborationPlan.summary = {
      ...corroborationPlan.summary,
      targets_failed_preflight: 1,
      targets_missing_credentials: 1,
      by_next_action: { configure_credentials: 1 }
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
      corroboration_source_plan: corroborationPlan,
      supply_chain_expansion_plan: supplyChainExpansionPlanFixture(),
      source_target_preflight: sourceTargetPreflightFixture()
    });

    const corroborationBatch = ledger.monitoring_config.batches.find((batch) => batch.batch_id === "edge_corroboration");

    expect(corroborationBatch).toEqual(
      expect.objectContaining({
        current_state: "retry_wait",
        recommended_next_decision: "defer",
        recommended_operational_action: "investigate_source_failure",
        attention_hint: "1 targets need credentials before they can produce monitoring data."
      })
    );
    expect(corroborationBatch?.state_counts).toEqual(
      expect.objectContaining({
        not_synced: 1,
        preflight_failed: 1,
        missing_credentials: 1
      })
    );
    expect(ledger.action_queue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action_id: "gate1:corroboration:preflight-triage",
          kind: "investigate_source_failures",
          priority: "P0"
        })
      ])
    );
    expect(ledger.action_queue.some((action) => action.action_id === "gate1:corroboration:smoke")).toBe(false);
  });

  it("turns smoke-cleared corroboration targets into observation review actions", () => {
    const corroborationPlan = corroborationSourcePlanFixture();
    corroborationPlan.summary = {
      ...corroborationPlan.summary,
      by_next_action: { review_observations: 3 },
      targets_failed_preflight: 0,
      targets_missing_credentials: 0
    };
    corroborationPlan.target_refs = [
      {
        backlog_id: "BACKLOG-CORROB-1",
        edge_ids: ["EDGE-1"],
        unknown_ids: ["UNK-EDGE-1-SINGLE-SOURCE"],
        source_adapter_id: "samsung-ir",
        target_kind: "official-html-disclosure",
        target_config: { entity_id: "ENT-SAMSUNG-ELECTRONICS", year: "2025" },
        coverage_state: "succeeded",
        check_target_id: "CHK-SAMSUNG-IR",
        preflight_status: null,
        preflight_issue_kind: null,
        preflight_missing_credential_env_keys: [],
        next_action: "review_observations",
        next_action_reason: "Source target already produced normalized observations."
      }
    ];
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
      corroboration_source_plan: corroborationPlan,
      supply_chain_expansion_plan: supplyChainExpansionPlanFixture(),
      source_target_preflight: sourceTargetPreflightFixture()
    });

    expect(ledger.action_queue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action_id: "gate1:corroboration:review-observations",
          kind: "review_observations",
          priority: "P0",
          command_hint:
            'supplystrata review edge-corroboration-disposition EDGE-1 --decision needs_more_evidence --reviewer <name> --reason "Reviewed produced observations; not enough to promote into fact evidence yet." --check-target CHK-SAMSUNG-IR'
        })
      ])
    );
    expect(ledger.action_queue.some((action) => action.action_id === "gate1:corroboration:smoke")).toBe(false);
  });

  it("turns official target observations into calibration review command hints", () => {
    const readiness = officialDisclosureReadinessFixture();
    readiness.summary.official_targets_with_observations = 2;
    const coverage = sourceTargetCoverageFixture();
    coverage.summary.targets_with_observations = 2;
    const ledger = buildGate1RunLedger({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      research_input: {
        company: "ENT-NVIDIA",
        depth: 3,
        officialDisclosureYear: "2025",
        sourceTargetNamespace: "gate1-review-test"
      },
      official_disclosure_readiness: readiness,
      corroboration_source_plan: corroborationSourcePlanFixture(),
      supply_chain_expansion_plan: supplyChainExpansionPlanFixture(),
      source_target_coverage: coverage
    });

    const action = ledger.action_queue.find((item) => item.action_id === "gate1:observations:review");
    expect(action?.kind).toBe("review_observations");
    expect(action?.command_hint).toContain("intelligence observation-calibration-label <OBS-id>");
  });

  it("includes the source target namespace in executable corroboration action hints", () => {
    const corroborationPlan = corroborationSourcePlanFixture();
    corroborationPlan.summary = {
      ...corroborationPlan.summary,
      by_next_action: { sync_target: 1, enable_target: 1, run_due_target: 1 },
      targets_need_sync: 1,
      targets_need_enable: 1,
      targets_due: 1
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
      corroboration_source_plan: corroborationPlan,
      supply_chain_expansion_plan: supplyChainExpansionPlanFixture()
    });

    const corroborationCommands = ledger.action_queue
      .filter((action) => action.action_id.startsWith("gate1:corroboration:"))
      .map((action) => action.command_hint)
      .filter((command): command is string => command !== null);

    expect(corroborationCommands).toEqual(
      expect.arrayContaining([
        "supplystrata sources policy sync-plan-targets --source-plan corroboration-source-plan-sync.json --namespace gate1-review-test",
        "supplystrata sources policy enable-plan-targets --source-plan corroboration-source-plan-enable.json --namespace gate1-review-test",
        "supplystrata sources run-due --source-plan corroboration-source-plan-run-due.json --namespace gate1-review-test"
      ])
    );
  });

  it("asks for entity affiliation disposition before opening parent legal-entity research", () => {
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
      entity_affiliation_contexts: [samsungMemoryAffiliation()]
    });

    expect(ledger.review_workbench.summary.entity_affiliation_disposition_items).toBe(1);
    expect(
      ledger.review_workbench.items.some(
        (item) =>
          item.kind === "entity_affiliation_disposition" &&
          item.recommended_decision === "review_entity_affiliation" &&
          item.command_hint?.includes("review entity-affiliation-disposition")
      )
    ).toBe(true);
    expect(ledger.company_switching.next_research_targets.every((target) => target.scope_kind !== "affiliation_parent_entity")).toBe(true);
    expect(renderGate1RunLedgerMarkdown(ledger)).toContain("Entity affiliation dispositions: 1");
  });

  it("does not ask for entity affiliation disposition again after a reviewed parent decision is recorded", () => {
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
      entity_affiliation_contexts: [samsungMemoryAffiliationWithDisposition("research_parent_entity")]
    });

    expect(ledger.review_workbench.summary.entity_affiliation_disposition_items).toBe(0);
    expect(ledger.review_workbench.items.some((item) => item.kind === "entity_affiliation_disposition")).toBe(false);
    expect(ledger.company_switching.next_research_targets[0]).toEqual(
      expect.objectContaining({
        company_id: "ENT-SAMSUNG-ELECTRONICS",
        scope_kind: "affiliation_parent_entity"
      })
    );
    expect(ledger.company_switching.next_research_targets[0]?.rationale).toContain("CHG-ENTITY-AFFILIATION-1");
  });

  it("removes parent legal-entity research targets when the affiliation disposition rejects that scope", () => {
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
      entity_affiliation_contexts: [samsungMemoryAffiliationWithDisposition("research_child_entity")]
    });

    expect(ledger.review_workbench.summary.entity_affiliation_disposition_items).toBe(0);
    expect(ledger.company_switching.next_research_targets.every((target) => target.scope_kind !== "affiliation_parent_entity")).toBe(true);
  });
});
