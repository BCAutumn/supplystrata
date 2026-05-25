import { describe, expect, it } from "vitest";
import {
  buildInvestigationBacklog,
  buildObservationCoverageReport,
  buildOfficialDisclosureReadinessReport,
  parseSourceTargetPreflightReport,
  renderInvestigationBacklogMarkdown,
  renderObservationCoverageMarkdown,
  renderSourceTargetPreflightMarkdown
} from "@supplystrata/research-pack";
import {
  emptyWorkbench,
  evidenceFixture,
  observationFixture,
  officialSourcePlanItem,
  officialSourceTargetCoverage,
  readyQuestionReadiness
} from "./research-pack-fixtures.js";
import type { ObservationCoverageReport, QuestionReadinessMatrix, SourceTargetCoverageReport } from "@supplystrata/research-pack";
import type { SourcePlanItem } from "@supplystrata/source-plan";

describe("research-pack observation and backlog readiness", () => {
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
        targets_with_observations: 0,
        total_observations: 0,
        observed_subject_entities: 0,
        observations_by_source: {},
        observations_by_target_kind: {},
        observations_by_metric: {}
      },
      observation_review: {
        summary: {
          review_items: 0,
          calibration_candidates: 0,
          labeled_calibration_candidates: 0,
          unlabeled_calibration_candidates: 0,
          next_labeling_batch_candidates: 0,
          p0: 0,
          p1: 0,
          p2: 0,
          by_category: {
            supply_chain_signal: 0,
            financial_context: 0,
            metric_mapping_gap: 0
          },
          by_recommended_label: {
            useful_signal: 0,
            background_context: 0,
            needs_context: 0,
            not_useful: 0
          },
          by_persisted_label: {
            useful_signal: 0,
            background_context: 0,
            needs_context: 0,
            not_useful: 0
          },
          next_labeling_batch_by_priority: { P0: 0, P1: 0, P2: 0 },
          next_labeling_batch_by_metric: {}
        },
        items: [],
        calibration_candidates: [],
        labeling_plan: {
          strategy: "stratified_unlabeled_by_priority_metric",
          review_policy: "review_only_no_fact_mutation",
          batch_size: 12,
          candidates: []
        }
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
          observations_by_metric: {},
          observation_samples: [],
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
});
