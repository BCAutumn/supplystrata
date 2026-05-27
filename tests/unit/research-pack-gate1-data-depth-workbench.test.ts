import { describe, expect, it } from "vitest";
import {
  buildGate1DataDepthActionBatch,
  buildGate1DataDepthWorkbench,
  buildOfficialDisclosureReadinessReport,
  loadGate1AdjacentOfficialFacts,
  loadGate1EntityAffiliationContexts
} from "@supplystrata/research-pack";
import { gate1DataDepthActionBatchDefinition, officialSourcePlanItem, officialSourceTargetCoverage } from "./research-pack-fixtures.js";
import {
  AdjacentFactsDbClient,
  EntityAffiliationDbClient,
  adjacentOfficialFactsReport,
  emptyPropagationReadinessReport,
  emptySupplyChainExpansionPlan,
  expansionPlanWithBlockedFacilityAndReadyCompany,
  expansionPlanWithSamsungMemoryFrontier,
  samsungMemoryAffiliation,
  samsungMemoryAffiliationWithDisposition,
  sourceTargetCoverageWithCalibrationCandidates,
  workbenchWithSamsungMemoryEdge
} from "./research-pack-gate1-data-depth-workbench-fixtures.js";

describe("Gate 1 data-depth entity context", () => {
  it("loads parent legal-entity open unknowns into affiliation context", async () => {
    const client = new EntityAffiliationDbClient();

    const contexts = await loadGate1EntityAffiliationContexts(client, { workbench: workbenchWithSamsungMemoryEdge() });

    expect(contexts).toEqual([
      expect.objectContaining({
        subject_entity_id: "ENT-SAMSUNG-MEMORY",
        parent_entity_id: "ENT-SAMSUNG-ELECTRONICS",
        parent_unknown_ids: ["UNK-SAMSUNG-PARENT-ROOT"]
      })
    ]);
    expect(contexts[0]?.latest_disposition?.change_id).toBe("CHG-ENTITY-AFFILIATION-1");
    expect(contexts[0]?.latest_disposition?.decision).toBe("research_parent_entity");
    expect(client.calls[1]?.sql).toContain("scope_kind = 'company'");
    expect(client.calls[1]?.params).toEqual([["ENT-SAMSUNG-ELECTRONICS"]]);
    expect(client.calls[2]?.sql).toContain("ENTITY_AFFILIATION_DISPOSITION_RECORDED");
  });

  it("turns parent/sub-entity context into review-only workbench items", () => {
    const workbench = workbenchWithSamsungMemoryEdge();
    const sourceTargetCoverage = officialSourceTargetCoverage("succeeded");
    const readiness = buildOfficialDisclosureReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench,
      component_ids: ["COMP-MEMORY"],
      target_nodes: [
        {
          node_id: "ENT-SAMSUNG-ELECTRONICS",
          node_kind: "company",
          name: "Samsung Electronics",
          priority: "P0",
          expected_source_ids: ["samsung-ir"]
        }
      ],
      source_plan: [officialSourcePlanItem()],
      source_target_coverage: sourceTargetCoverage
    });

    const workbenchModel = buildGate1DataDepthWorkbench({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      official_disclosure_readiness: readiness,
      source_target_coverage: sourceTargetCoverage,
      supply_chain_expansion_plan: emptySupplyChainExpansionPlan(),
      propagation_readiness: emptyPropagationReadinessReport(),
      adjacent_official_facts: adjacentOfficialFactsReport(),
      entity_affiliation_contexts: [samsungMemoryAffiliation()]
    });

    const item = workbenchModel.items.find((candidate) => candidate.workstream === "entity_context");
    expect(item).toEqual(
      expect.objectContaining({
        item_id: "gate1-entity-affiliation:ENT-SAMSUNG-MEMORY:ENT-SAMSUNG-ELECTRONICS",
        priority: "P0",
        frontend_action_kind: "review_entity_context",
        recommended_decision: "review_entity_affiliation",
        write_impact: "May record review disposition or choose a research scope; must not merge entities or propagate fact edges automatically."
      })
    );
    expect(item?.allowed_decisions).toEqual(["review_entity_affiliation", "run_recursive_company_research", "keep_unknown_open", "defer"]);
    expect(item?.refs).toContain("unknown:UNK-SAMSUNG-PARENT-ROOT");
    expect(item?.rationale).toContain("Parent scope already has explicit unknown(s): UNK-SAMSUNG-PARENT-ROOT");
    expect(item?.edge_ids).toEqual(["EDGE-1"]);
    expect(item?.component_ids).toEqual(["COMP-MEMORY"]);
    expect(item?.source_adapters).toEqual(["samsung-ir"]);
    expect(item?.source_targets[0]).toEqual(
      expect.objectContaining({
        source_adapter_id: "samsung-ir",
        target_entity_id: "ENT-SAMSUNG-ELECTRONICS",
        state: "succeeded"
      })
    );
    expect(workbenchModel.summary.by_workstream.entity_context).toBe(1);
    expect(workbenchModel.summary.entity_context_items).toBe(1);

    const batch = buildGate1DataDepthActionBatch(workbenchModel, gate1DataDepthActionBatchDefinition("entity_context"));
    expect(batch.summary.items).toBe(1);
    expect(batch.items[0]?.automatic_fact_mutation_allowed).toBe(false);
    expect(batch.items[0]?.frontend_action_kind).toBe("review_entity_context");
  });

  it("uses reviewed parent legal-entity scope for frontier business units", () => {
    const sourceTargetCoverage = officialSourceTargetCoverage("succeeded");
    const readiness = buildOfficialDisclosureReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench: workbenchWithSamsungMemoryEdge(),
      component_ids: ["COMP-MEMORY"],
      source_plan: [officialSourcePlanItem()],
      source_target_coverage: sourceTargetCoverage
    });

    const workbenchModel = buildGate1DataDepthWorkbench({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      research_context: {
        depth: 4,
        official_disclosure_year: "2025",
        research_target_profile_id: "ai-compute-memory.v0"
      },
      official_disclosure_readiness: readiness,
      source_target_coverage: sourceTargetCoverage,
      supply_chain_expansion_plan: expansionPlanWithSamsungMemoryFrontier(),
      propagation_readiness: emptyPropagationReadinessReport(),
      adjacent_official_facts: adjacentOfficialFactsReport(),
      entity_affiliation_contexts: [samsungMemoryAffiliationWithDisposition()]
    });

    const frontierItem = workbenchModel.items.find((candidate) => candidate.item_id === "gate1-frontier:recursive-depth");
    expect(frontierItem?.command_hints[0]?.command).toContain("--company ENT-SAMSUNG-ELECTRONICS");
    expect(frontierItem?.command_hints[0]?.command).toContain("--component COMP-MEMORY");
    expect(frontierItem?.command_hints[0]?.command).toContain("--source-target-namespace research-ent-samsung-electronics");
    expect(frontierItem?.command_hints[0]?.command).toContain("--out reports/ent-samsung-electronics-comp-memory-research-pack");
    expect(frontierItem?.command_hints[0]?.command).not.toContain("--company ENT-SAMSUNG-MEMORY");
  });
});

describe("Gate 1 data-depth recursive research actions", () => {
  it("turns adjacent official facts into recursive research context without mutating facts", async () => {
    const adjacentFacts = await loadGate1AdjacentOfficialFacts(new AdjacentFactsDbClient(), {
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      component_ids: ["COMP-PCB"],
      visible_edge_ids: ["EDGE-VISIBLE"]
    });
    const sourceTargetCoverage = officialSourceTargetCoverage("succeeded");
    const readiness = buildOfficialDisclosureReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench: workbenchWithSamsungMemoryEdge(),
      component_ids: ["COMP-PCB"],
      source_plan: [officialSourcePlanItem()],
      source_target_coverage: sourceTargetCoverage
    });

    const workbenchModel = buildGate1DataDepthWorkbench({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      research_context: {
        depth: 4,
        official_disclosure_year: "2025",
        research_target_profile_id: "ai-compute-memory.v0"
      },
      official_disclosure_readiness: readiness,
      source_target_coverage: sourceTargetCoverage,
      supply_chain_expansion_plan: emptySupplyChainExpansionPlan(),
      propagation_readiness: emptyPropagationReadinessReport(),
      adjacent_official_facts: adjacentFacts,
      entity_affiliation_contexts: [],
      ranking_calibration_labels: [
        {
          label_id: "RANK-CAL-LABEL-PCB-1",
          ranking_context_id: "ranking:adjacent-company:COMP-PCB:adjacent-company-ranking.v1",
          candidate_entity_id: "ENT-IBIDEN",
          label: "useful_target",
          reviewer: "unit-test",
          reviewed_at: "2026-05-26T00:00:00.000Z",
          rationale: "Useful upstream PCB research target."
        }
      ]
    });

    const item = workbenchModel.items.find((candidate) => candidate.workstream === "adjacent_official_facts");
    expect(adjacentFacts.summary).toEqual(
      expect.objectContaining({
        fact_edges: 2,
        companies: 4,
        components: 1,
        policy: "adjacent_context_only_no_fact_mutation"
      })
    );
    expect(adjacentFacts.edges[0]?.component_attribution_kind).toBe("counterparty_industry");
    expect(item).toEqual(
      expect.objectContaining({
        item_id: "gate1-adjacent-official-facts:COMP-PCB",
        frontend_action_kind: "run_adjacent_company_research",
        recommended_decision: "run_recursive_company_research",
        automatic_fact_mutation_allowed: false
      })
    );
    expect(item?.rationale).toContain("do not prove an NVIDIA relationship");
    expect(item?.command_hints[0]?.command).toContain("--company ENT-IBIDEN");
    expect(item?.command_hints[0]?.command).toContain("--component COMP-PCB");
    expect(item?.command_hints[0]?.command).toContain("--depth 4");
    expect(item?.command_hints[0]?.command).toContain("--target-profile ai-compute-memory.v0");
    expect(item?.command_hints[0]?.command).toContain("--official-year 2025");
    expect(item?.command_hints[0]?.command).toContain("--source-target-namespace research-ent-ibiden");
    expect(item?.command_hints[0]?.command).toContain("--out reports/ent-ibiden-comp-pcb-research-pack");
    expect(item?.command_hints.some((hint) => hint.command.includes("--company ENT-NVIDIA"))).toBe(false);
    const factGrowthItem = workbenchModel.items.find((candidate) => candidate.item_id === "gate1-gap:official-disclosure:l4-l5-edge-coverage");
    expect(factGrowthItem?.command_hints[0]?.command).toContain("--company ENT-NVIDIA");
    expect(factGrowthItem?.command_hints[0]?.command).toContain("--component");
    expect(factGrowthItem?.command_hints[0]?.command).toContain("COMP-PCB");
    expect(factGrowthItem?.command_hints[0]?.command).toContain("--depth 4");
    expect(factGrowthItem?.command_hints[0]?.command).toContain("--target-profile ai-compute-memory.v0");
    expect(factGrowthItem?.command_hints[0]?.command).toContain("--official-year 2025");
    expect(factGrowthItem?.command_hints[0]?.command).toContain("--source-target-namespace research-ent-nvidia");
    expect(factGrowthItem?.command_hints[0]?.command).toContain("--out reports/ent-nvidia-");
    expect(factGrowthItem?.command_hints[0]?.command).not.toContain("<research-pack-out>");
    expect(item?.ranking_contexts[0]).toEqual(
      expect.objectContaining({
        context_id: "ranking:adjacent-company:COMP-PCB:adjacent-company-ranking.v1",
        ranking_kind: "adjacent_company_candidate",
        policy: "candidate_generation_not_probability",
        calibration_status: "uncalibrated",
        needs_label: true
      })
    );
    const topRankingCandidate = item?.ranking_contexts[0]?.candidates[0];
    expect(topRankingCandidate?.candidate_id).toBe("ranking:adjacent-company:COMP-PCB:adjacent-company-ranking.v1:ENT-IBIDEN");
    expect(topRankingCandidate?.entity_id).toBe("ENT-IBIDEN");
    expect(topRankingCandidate?.review_status).toBe("labeled");
    expect(topRankingCandidate?.latest_label).toEqual(
      expect.objectContaining({
        label: "useful_target",
        reviewer: "unit-test"
      })
    );
    expect(topRankingCandidate?.existing_labels).toHaveLength(1);
    expect(topRankingCandidate?.suggested_label).toBe("useful_target");
    expect(topRankingCandidate?.suggested_label_policy).toBe("rule_suggestion_not_gold_label");
    expect(topRankingCandidate?.suggested_label_reason).toContain("strong component-token relevance");
    expect(topRankingCandidate?.score_breakdown.component_relevance).toBe(2);
    expect(topRankingCandidate?.score_breakdown.edge_frequency_tiebreaker).toBe(1);
    expect(item?.edge_ids).toEqual(["EDGE-ADJACENT-NVIDIA-PCB", "EDGE-ADJACENT-PCB"]);
    expect(item?.source_adapters).toEqual(["apple-suppliers", "sec-edgar"]);
    expect(workbenchModel.summary.adjacent_official_fact_edges).toBe(2);
    expect(workbenchModel.summary.by_workstream.adjacent_official_facts).toBe(1);

    const batch = buildGate1DataDepthActionBatch(workbenchModel, gate1DataDepthActionBatchDefinition("adjacent_facts"));
    expect(batch.summary.items).toBe(1);
    expect(batch.items[0]?.write_impact).toContain("No fact edge mutation");
  });

  it("uses runnable company frontier commands and skips blocked facility frontier candidates", () => {
    const sourceTargetCoverage = officialSourceTargetCoverage("succeeded");
    const readiness = buildOfficialDisclosureReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench: workbenchWithSamsungMemoryEdge(),
      component_ids: ["COMP-WAFER"],
      source_plan: [officialSourcePlanItem()],
      source_target_coverage: sourceTargetCoverage
    });

    const workbenchModel = buildGate1DataDepthWorkbench({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      research_context: {
        depth: 4,
        official_disclosure_year: "2025",
        research_target_profile_id: "ai-compute-memory.v0"
      },
      official_disclosure_readiness: readiness,
      source_target_coverage: sourceTargetCoverage,
      supply_chain_expansion_plan: expansionPlanWithBlockedFacilityAndReadyCompany(),
      propagation_readiness: emptyPropagationReadinessReport(),
      adjacent_official_facts: adjacentOfficialFactsReport(),
      entity_affiliation_contexts: []
    });

    const frontierItem = workbenchModel.items.find((candidate) => candidate.item_id === "gate1-frontier:recursive-depth");
    expect(frontierItem?.command_hints[0]?.command).toContain("--company ENT-TSMC");
    expect(frontierItem?.command_hints[0]?.command).toContain("--component COMP-WAFER");
    expect(frontierItem?.command_hints[0]?.command).toContain("--target-profile ai-compute-memory.v0");
    expect(frontierItem?.command_hints[0]?.command).toContain("--official-year 2025");
    expect(frontierItem?.command_hints[0]?.command).toContain("--source-target-namespace research-ent-tsmc");
    expect(frontierItem?.command_hints[0]?.command).not.toContain("ENT-FAC-");
    expect(frontierItem?.command_hints[0]?.command).not.toContain("<research-pack-out>");
  });
});

describe("Gate 1 data-depth source and observation operations", () => {
  it("uses exact check target ids for source blocker repair commands", () => {
    const sourceTargetCoverage = officialSourceTargetCoverage("retry_wait");
    const readiness = buildOfficialDisclosureReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench: workbenchWithSamsungMemoryEdge(),
      component_ids: ["COMP-MEMORY"],
      source_plan: [officialSourcePlanItem()],
      source_target_coverage: sourceTargetCoverage
    });

    const workbenchModel = buildGate1DataDepthWorkbench({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      official_disclosure_readiness: readiness,
      source_target_coverage: sourceTargetCoverage,
      supply_chain_expansion_plan: emptySupplyChainExpansionPlan(),
      propagation_readiness: emptyPropagationReadinessReport(),
      adjacent_official_facts: adjacentOfficialFactsReport(),
      entity_affiliation_contexts: []
    });

    const sourceBlocker = workbenchModel.items.find((candidate) => candidate.item_id.startsWith("gate1-source-blocker:"));
    expect(sourceBlocker?.command_hints[0]?.command).toBe(
      "pnpm --silent cli sources due --check-target-id plan:nvidia-memory-2025:samsung-ir:official-html-disclosure:0a2adc4a3479a3f6 --format markdown"
    );
    expect(sourceBlocker?.command_hints[1]?.command).toBe(
      "pnpm --silent cli sources run-due --check-target-id plan:nvidia-memory-2025:samsung-ir:official-html-disclosure:0a2adc4a3479a3f6 --format markdown"
    );
    expect(sourceBlocker?.command_hints.some((hint) => hint.command.includes("--source samsung-ir"))).toBe(false);
  });

  it("creates calibration label commands for the whole next observation batch", () => {
    const sourceTargetCoverage = sourceTargetCoverageWithCalibrationCandidates();
    const readiness = buildOfficialDisclosureReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench: workbenchWithSamsungMemoryEdge(),
      component_ids: ["COMP-MEMORY"],
      source_plan: [officialSourcePlanItem()],
      source_target_coverage: sourceTargetCoverage
    });

    const workbenchModel = buildGate1DataDepthWorkbench({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      official_disclosure_readiness: readiness,
      source_target_coverage: sourceTargetCoverage,
      supply_chain_expansion_plan: emptySupplyChainExpansionPlan(),
      propagation_readiness: emptyPropagationReadinessReport(),
      adjacent_official_facts: adjacentOfficialFactsReport(),
      entity_affiliation_contexts: []
    });

    const calibrationItem = workbenchModel.items.find((candidate) => candidate.item_id === "gate1-observation-calibration:next-labeling-batch");
    expect(calibrationItem?.command_hints).toHaveLength(2);
    expect(calibrationItem?.command_hints[0]?.command).toContain("OBS-CAL-1 --label useful_signal");
    expect(calibrationItem?.command_hints[1]?.command).toContain("OBS-CAL-2 --label needs_context");
    expect(calibrationItem?.source_adapters).toEqual(["samsung-ir"]);
    expect(calibrationItem?.automatic_fact_mutation_allowed).toBe(false);
  });
});
