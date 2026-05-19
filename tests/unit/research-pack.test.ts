import { describe, expect, it } from "vitest";
import {
  buildInvestigationBacklog,
  buildResearchPackFromWorkbench,
  collectResearchComponentIds,
  renderInvestigationBacklogMarkdown,
  renderQuestionReadinessMarkdown,
  safeFileSegment
} from "@supplystrata/research-pack";
import type { ChainViewSegmentModel } from "@supplystrata/chain-view";
import type { WorkbenchModel } from "@supplystrata/workbench-export";
import type { QuestionReadinessMatrix, SourceTargetCoverageReport } from "@supplystrata/research-pack";
import type { SourcePlanItem } from "@supplystrata/source-plan";

describe("research-pack", () => {
  it("collects explicit components and chain components into a stable research set", () => {
    const segments: ChainViewSegmentModel[] = [
      {
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
      }
    ];

    expect(collectResearchComponentIds({ chain_segments: segments }, ["COMP-HBM", " COMP-MEMORY "])).toEqual(["COMP-HBM", "COMP-MEMORY"]);
  });

  it("creates safe deterministic file segments", () => {
    expect(safeFileSegment("COMP-HBM")).toBe("comp-hbm");
    expect(safeFileSegment("HBM / Advanced Packaging")).toBe("hbm-advanced-packaging");
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
      evidences: [],
      unknown_items: [],
      sources: [],
      source_plan: [],
      changes: [],
      intelligence: { edge_strengths: [], edge_freshness: [] }
    };

    const pack = buildResearchPackFromWorkbench({ workbench, components: ["COMP-HBM"], depth: 3 });
    expect(pack.manifest.mode).toBe("workbench_snapshot");
    expect(pack.manifest.stats.fact_edges).toBe(1);
    expect(pack.manifest.components).toEqual(["COMP-HBM", "COMP-MEMORY"]);
    expect(pack.manifest.stats.question_readiness_partial).toBeGreaterThan(0);
    expect(pack.manifest.stats.investigation_backlog_items).toBeGreaterThan(0);
    expect(pack.question_readiness.items.some((item) => item.question_id === "company.upstream_dependencies" && item.status === "partial")).toBe(true);
    expect(renderQuestionReadinessMarkdown(pack.question_readiness)).toContain("company.upstream_dependencies");
    expect(renderInvestigationBacklogMarkdown(pack.investigation_backlog)).toContain("Investigation Backlog");
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
});

function emptyWorkbench(): WorkbenchModel {
  return {
    schema_version: "1.0.0",
    generated_at: "2026-01-01T00:00:00.000Z",
    selected_company_id: "ENT-NVIDIA",
    companies: [],
    chain: {
      schema_version: "1.0.0",
      view_type: "company_chain",
      root: { kind: "company", id: "ENT-NVIDIA", name: "NVIDIA" },
      max_depth: 1,
      generated_by: "test",
      segments: [],
      stats: { fact_edges: 0, claims: 0, observations: 0, leads: 0, unknowns: 0 }
    },
    chain_segments: [],
    edges: [],
    upstream_edges: [],
    downstream_edges: [],
    claims: [],
    draft_claims: [],
    evidences: [],
    unknown_items: [],
    sources: [],
    source_plan: [],
    changes: [],
    intelligence: { edge_strengths: [], edge_freshness: [] }
  };
}
