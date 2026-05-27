import { describe, expect, it } from "vitest";
import {
  buildCorroborationSourcePlan,
  buildCorroborationSourcePlanActionBatch,
  buildInvestigationBacklog,
  buildOfficialDisclosureReadinessReport,
  parseSourceTargetPreflightReport,
  renderCorroborationSourcePlanMarkdown,
  renderInvestigationBacklogMarkdown
} from "@supplystrata/research-pack";
import { buildSourcePolicyConfigFromPlanTargets, parseManagedSourcePlanDocument } from "@supplystrata/source-management";
import {
  actionBatchDefinition,
  emptyWorkbench,
  evidenceFixture,
  officialSourcePlanItem,
  officialSourceTargetCoverage,
  readyQuestionReadiness
} from "./research-pack-fixtures.js";
import type { InvestigationBacklog } from "@supplystrata/research-pack";
import type { SourcePlanItem } from "@supplystrata/source-plan";

describe("research-pack corroboration source plan", () => {
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

  it("keeps recorded single-source disposition out of runnable corroboration targets", () => {
    const officialDisclosureReadiness = buildOfficialDisclosureReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      component_ids: ["COMP-DRAM"],
      source_plan: [officialSourcePlanItem()],
      source_target_coverage: officialSourceTargetCoverage("succeeded"),
      edge_corroboration_dispositions: [
        {
          change_id: "CHG-EDGE-CORROBORATION-RECORDED-1",
          edge_id: "EDGE-SAMSUNG-RECORDED-1",
          decision: "record_single_source_unknown",
          reviewer: "unit-test",
          reason: "Counterparty official target completed without edge-specific second-source evidence.",
          evidence_id: null,
          unknown_id: null,
          check_target_id: "CHK-SAMSUNG-IR",
          recorded_at: "2026-05-26T00:00:00.000Z"
        }
      ],
      workbench: {
        ...emptyWorkbench(),
        companies: [
          { entity_id: "ENT-NVIDIA", name: "NVIDIA", role: "root" },
          { entity_id: "ENT-SAMSUNG-ELECTRONICS", name: "Samsung Electronics", role: "counterparty" }
        ],
        edges: [
          {
            edge_id: "EDGE-SAMSUNG-RECORDED-1",
            from_id: "ENT-NVIDIA",
            from_name: "NVIDIA",
            to_id: "ENT-SAMSUNG-ELECTRONICS",
            to_name: "Samsung Electronics",
            relation: "BUYS_FROM",
            component: "dram",
            component_id: "COMP-DRAM",
            evidence_level: 5,
            confidence: 0.95,
            evidence_ids: ["EV-SAMSUNG-RECORDED-1"]
          }
        ],
        evidences: [
          evidenceFixture("EV-SAMSUNG-RECORDED-1", {
            edge_id: "EDGE-SAMSUNG-RECORDED-1",
            evidence_level: 5,
            source_adapter_id: "sec-edgar",
            source_url: "https://www.sec.gov/Archives/fixture/nvidia-10k.htm",
            cite_text_sha256: "abc123"
          })
        ],
        unknown_items: [
          {
            unknown_id: "UNK-SAMSUNG-RECORDED-SINGLE-SOURCE",
            scope_kind: "edge",
            scope_id: "EDGE-SAMSUNG-RECORDED-1",
            question: "Can this relationship be corroborated by a second official source?",
            why_unknown: "A single-source disposition was materialized after official target review.",
            blocking_data_sources: ["single-source disposition", "counterparty official disclosure"],
            proxies: ["check_target:CHK-SAMSUNG-IR"],
            status: "open"
          }
        ],
        intelligence: { edge_strengths: [], edge_freshness: [] }
      }
    });
    const backlog = buildInvestigationBacklog({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench: emptyWorkbench(),
      components: [],
      source_plan: [officialSourcePlanItem()],
      source_target_coverage: officialSourceTargetCoverage("succeeded"),
      question_readiness: readyQuestionReadiness(),
      official_disclosure_readiness: officialDisclosureReadiness
    });

    expect(backlog.summary.corroboration_reviews).toBe(1);
    expect(backlog.summary.corroboration_review_runnable_targets).toBe(0);
    expect(backlog.summary.corroboration_review_explicit_disposition_only).toBe(1);
    expect(backlog.items.find((item) => item.kind === "corroboration_review")?.runnable_check_targets).toEqual([]);

    const corroborationSourcePlan = buildCorroborationSourcePlan({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      source_plan: [officialSourcePlanItem()],
      investigation_backlog: backlog
    });
    expect(corroborationSourcePlan.summary).toEqual(
      expect.objectContaining({
        review_edges: 1,
        disposition_only_edges: 1,
        source_plan_items: 0,
        runnable_targets: 0,
        by_next_action: {}
      })
    );
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
    const enableTarget = {
      ...smokeTarget,
      target_config: { entity_id: "ENT-SAMSUNG-ELECTRONICS", year: 2022 },
      reason: "Samsung IR 2022 connector target."
    };
    const reviewTarget = {
      ...smokeTarget,
      target_config: { entity_id: "ENT-SAMSUNG-ELECTRONICS", year: 2023 },
      reason: "Samsung IR 2023 connector target."
    };
    const sourcePlan: SourcePlanItem[] = [
      {
        ...sourcePlanItem,
        suggested_check_targets: [smokeTarget, syncTarget, enableTarget, reviewTarget]
      }
    ];
    const backlog: InvestigationBacklog = {
      schema_version: "1.0.0",
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      summary: {
        open_items: 4,
        p0: 0,
        p1: 4,
        p2: 0,
        p3: 0,
        runnable_check_targets: 4,
        source_target_coverage_items: 3,
        corroboration_reviews: 4,
        corroboration_review_runnable_targets: 4,
        corroboration_review_with_source_target_coverage: 3,
        corroboration_review_explicit_disposition_only: 0,
        corroboration_review_need_sync: 1,
        corroboration_review_need_enable: 1,
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
        },
        {
          backlog_id: "BACKLOG-ENABLE",
          kind: "corroboration_review",
          priority: "P1",
          title: "Enable Samsung IR target",
          rationale: "The source target is policy disabled.",
          action: "Enable target before due processing.",
          target: {
            component_ids: ["COMP-DRAM"],
            edge_ids: ["EDGE-ENABLE"],
            unknown_ids: [],
            source_ids: ["samsung-ir"],
            question_ids: ["official_disclosure.corroboration"]
          },
          supporting_refs: [],
          runnable_check_targets: [enableTarget],
          source_target_coverage: [
            {
              source_adapter_id: "samsung-ir",
              target_kind: "official-html-disclosure",
              target_config: enableTarget.target_config,
              check_target_id: "plan:nvidia-memory-2025:samsung-ir:official-html-disclosure:enable",
              state: "policy_disabled",
              synced: true,
              observations: 0,
              latest_job_id: null,
              latest_job_status: null,
              latest_event_id: null,
              latest_event_type: null,
              preflight_status: null,
              preflight_issue_kind: null,
              preflight_error_message: null,
              preflight_missing_credential_env_keys: [],
              preflight_normalized_documents: 0,
              preflight_degraded_documents: 0
            }
          ]
        },
        {
          backlog_id: "BACKLOG-REVIEW",
          kind: "corroboration_review",
          priority: "P1",
          title: "Review completed Samsung IR target",
          rationale: "The source target already completed successfully.",
          action: "Review normalized output instead of repeating smoke.",
          target: {
            component_ids: ["COMP-DRAM"],
            edge_ids: ["EDGE-REVIEW"],
            unknown_ids: [],
            source_ids: ["samsung-ir"],
            question_ids: ["official_disclosure.corroboration"]
          },
          supporting_refs: [],
          runnable_check_targets: [reviewTarget],
          source_target_coverage: [
            {
              source_adapter_id: "samsung-ir",
              target_kind: "official-html-disclosure",
              target_config: reviewTarget.target_config,
              check_target_id: "plan:nvidia-memory-2025:samsung-ir:official-html-disclosure:review",
              state: "succeeded",
              synced: true,
              observations: 0,
              latest_job_id: "job-review",
              latest_job_status: "succeeded",
              latest_event_id: "event-review",
              latest_event_type: "DOCUMENT_UNCHANGED",
              preflight_status: null,
              preflight_issue_kind: null,
              preflight_error_message: null,
              preflight_missing_credential_env_keys: [],
              preflight_normalized_documents: 0,
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
    const enableBatch = buildCorroborationSourcePlanActionBatch(plan, actionBatchDefinition("enable"));

    expect(plan.summary.targets_need_enable).toBe(1);
    expect(plan.summary.by_next_action).toEqual({ enable_target: 1, review_observations: 1, smoke_target: 1, sync_target: 1 });
    expect(plan.target_refs.find((target) => target.edge_ids.includes("EDGE-REVIEW"))?.next_action).toBe("review_observations");
    expect(enableBatch.check_target_ids).toEqual(["plan:nvidia-memory-2025:samsung-ir:official-html-disclosure:enable"]);
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
    expect(enableBatch.source_plan[0]?.suggested_check_targets[0]?.target_config["year"]).toBe(2022);
    expect(parseManagedSourcePlanDocument(JSON.stringify(smokeBatch)).source_plan[0]?.suggested_check_targets).toHaveLength(1);
    expect(parseManagedSourcePlanDocument(JSON.stringify(syncBatch)).source_plan[0]?.suggested_check_targets).toHaveLength(1);
    expect(parseManagedSourcePlanDocument(JSON.stringify(enableBatch)).source_plan[0]?.suggested_check_targets).toHaveLength(1);
    expect(renderCorroborationSourcePlanMarkdown(plan)).toContain("corroboration-source-plan-smoke.json");
  });
});
