import { describe, expect, it } from "vitest";
import type pg from "pg";
import {
  buildGate1DataDepthActionBatch,
  buildGate1DataDepthWorkbench,
  buildOfficialDisclosureReadinessReport,
  loadGate1AdjacentOfficialFacts,
  loadGate1EntityAffiliationContexts,
  type Gate1EntityAffiliationContext,
  type Gate1AdjacentOfficialFactsReport,
  type PropagationReadinessReport,
  type SourceTargetCoverageReport,
  type SupplyChainExpansionPlan
} from "@supplystrata/research-pack";
import type { DbClient } from "@supplystrata/db/read";
import type { WorkbenchModel } from "@supplystrata/workbench-export";
import { rankAdjacentOfficialFactCompanyCandidates } from "../../packages/research-pack/src/gate1-adjacent-company-ranking.js";
import {
  edgeFixture,
  emptyWorkbench,
  gate1DataDepthActionBatchDefinition,
  officialSourcePlanItem,
  officialSourceTargetCoverage
} from "./research-pack-fixtures.js";

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
    expect(item?.command_hints.some((hint) => hint.command.includes("--company ENT-NVIDIA"))).toBe(false);
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
});

describe("Gate 1 adjacent company ranking", () => {
  it("does not let disclosure-center frequency outrank component-relevant upstream candidates", () => {
    const candidates = rankAdjacentOfficialFactCompanyCandidates({
      selected_company_id: "ENT-NVIDIA",
      component_id: "COMP-PCB",
      edges: [
        adjacentFactEdge({
          edge_id: "EDGE-APPLE-COMPEQ",
          from_id: "ENT-APPLE",
          from_name: "Apple",
          from_industry: ["consumer-electronics"],
          to_id: "ENT-COMPEQ",
          to_name: "Compeq",
          to_industry: ["pcb"],
          relation: "BUYS_FROM"
        }),
        adjacentFactEdge({
          edge_id: "EDGE-APPLE-ATS",
          from_id: "ENT-APPLE",
          from_name: "Apple",
          from_industry: ["consumer-electronics"],
          to_id: "ENT-ATS",
          to_name: "AT&S",
          to_industry: ["pcb", "substrate"],
          relation: "BUYS_FROM"
        }),
        adjacentFactEdge({
          edge_id: "EDGE-APPLE-DELTA",
          from_id: "ENT-APPLE",
          from_name: "Apple",
          from_industry: ["consumer-electronics"],
          to_id: "ENT-DELTA",
          to_name: "Delta Electronics",
          to_industry: ["power"],
          relation: "BUYS_FROM"
        })
      ]
    });

    expect(candidates.map((candidate) => candidate.company_id)).toEqual(["ENT-ATS", "ENT-COMPEQ"]);
    expect(candidates.some((candidate) => candidate.company_id === "ENT-APPLE")).toBe(false);
    expect(candidates[0]?.ranking_reason).toContain("component_relevance=2");
  });
});

interface QueryCall {
  sql: string;
  params: readonly unknown[];
}

class EntityAffiliationDbClient implements DbClient {
  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    const rows = rowsForEntityAffiliation<T>(sql);
    return {
      command: "MOCK",
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows
    };
  }
}

class AdjacentFactsDbClient implements DbClient {
  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    expect(sql).toContain("e.component_id = ANY($1::text[])");
    expect(sql).toContain("NOT (e.edge_id = ANY($2::text[]))");
    expect(params[0]).toEqual(["COMP-PCB"]);
    expect(params[1]).toEqual(["EDGE-VISIBLE"]);
    const rows = [
      {
        edge_id: "EDGE-ADJACENT-NVIDIA-PCB",
        from_id: "ENT-IBIDEN",
        from_name: "Ibiden",
        from_kind: "company",
        from_industry: ["pcb", "substrate"],
        to_id: "ENT-NVIDIA",
        to_name: "NVIDIA",
        to_kind: "company",
        to_industry: ["ai-compute"],
        relation: "SUPPLIES_TO",
        component_id: null,
        component_name: null,
        evidence_level: 4,
        confidence: 0.97,
        evidence_ids: ["EV-ADJACENT-NVIDIA-PCB"],
        source_adapters: ["sec-edgar"],
        source_urls: ["https://example.test/ibiden-filing"]
      },
      {
        edge_id: "EDGE-ADJACENT-PCB",
        from_id: "ENT-APPLE",
        from_name: "Apple",
        from_kind: "company",
        from_industry: ["consumer-electronics"],
        to_id: "ENT-COMPEQ",
        to_name: "Compeq",
        to_kind: "company",
        to_industry: ["pcb", "electronics"],
        relation: "BUYS_FROM",
        component_id: null,
        component_name: null,
        evidence_level: 4,
        confidence: 0.92,
        evidence_ids: ["EV-ADJACENT-PCB"],
        source_adapters: ["apple-suppliers"],
        source_urls: ["https://example.test/apple-supplier-list"]
      }
    ] as unknown as T[];
    return { command: "MOCK", rowCount: rows.length, oid: 0, fields: [], rows };
  }
}

function rowsForEntityAffiliation<T extends pg.QueryResultRow>(sql: string): T[] {
  if (sql.includes("FROM entity_master child")) {
    return [
      {
        subject_entity_id: "ENT-SAMSUNG-MEMORY",
        subject_name: "Samsung Memory",
        subject_kind: "business_unit",
        parent_entity_id: "ENT-SAMSUNG-ELECTRONICS",
        parent_name: "Samsung Electronics",
        parent_kind: "company"
      }
    ] as unknown as T[];
  }
  if (sql.includes("FROM unknown_items")) {
    return [{ scope_id: "ENT-SAMSUNG-ELECTRONICS", unknown_id: "UNK-SAMSUNG-PARENT-ROOT" }] as unknown as T[];
  }
  if (sql.includes("FROM change_records")) {
    return [
      {
        change_id: "CHG-ENTITY-AFFILIATION-1",
        context_id: "gate1-entity-affiliation:ENT-SAMSUNG-MEMORY:ENT-SAMSUNG-ELECTRONICS",
        after: {
          context_id: "gate1-entity-affiliation:ENT-SAMSUNG-MEMORY:ENT-SAMSUNG-ELECTRONICS",
          subject_entity_id: "ENT-SAMSUNG-MEMORY",
          parent_entity_id: "ENT-SAMSUNG-ELECTRONICS",
          decision: "research_parent_entity",
          reviewer: "unit-test",
          reason: "Parent legal entity owns the official disclosure path.",
          edge_ids: ["EDGE-1"],
          component_ids: ["COMP-MEMORY"],
          unknown_ids: ["UNK-SAMSUNG-PARENT-ROOT"],
          recorded_at: "2026-05-26T00:00:00.000Z",
          fact_write_policy: {
            automatic_fact_mutation_allowed: false,
            allowed_edge_mutation: "none",
            requires_human_review: true
          }
        },
        caused_by: "unit-test",
        detected_at: new Date("2026-05-26T00:00:00.000Z")
      }
    ] as unknown as T[];
  }
  return [];
}

function workbenchWithSamsungMemoryEdge(): WorkbenchModel {
  const workbench = emptyWorkbench();
  workbench.companies = [
    { entity_id: "ENT-NVIDIA", name: "NVIDIA", role: "root" },
    { entity_id: "ENT-SAMSUNG-MEMORY", name: "Samsung Memory", role: "counterparty" }
  ];
  workbench.edges = [edgeFixture("EDGE-1", "ENT-NVIDIA", "NVIDIA", "ENT-SAMSUNG-MEMORY", "Samsung Memory", "COMP-MEMORY")];
  workbench.chain_segments = [];
  return workbench;
}

function samsungMemoryAffiliation(): Gate1EntityAffiliationContext {
  return {
    context_id: "gate1-entity-affiliation:ENT-SAMSUNG-MEMORY:ENT-SAMSUNG-ELECTRONICS",
    subject_entity_id: "ENT-SAMSUNG-MEMORY",
    subject_name: "Samsung Memory",
    subject_kind: "business_unit",
    parent_entity_id: "ENT-SAMSUNG-ELECTRONICS",
    parent_name: "Samsung Electronics",
    parent_kind: "company",
    parent_unknown_ids: ["UNK-SAMSUNG-PARENT-ROOT"],
    edge_ids: ["EDGE-1"],
    component_ids: ["COMP-MEMORY"],
    latest_disposition: null
  };
}

function emptySupplyChainExpansionPlan(): SupplyChainExpansionPlan {
  return {
    schema_version: "1.0.0",
    generated_at: "2026-01-01T00:00:00.000Z",
    company_id: "ENT-NVIDIA",
    max_depth: 7,
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
    items: []
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

function adjacentFactEdge(
  input: Pick<
    Gate1AdjacentOfficialFactsReport["edges"][number],
    "edge_id" | "from_id" | "from_name" | "from_industry" | "to_id" | "to_name" | "to_industry" | "relation"
  >
): Gate1AdjacentOfficialFactsReport["edges"][number] {
  return {
    ...input,
    component_id: "COMP-PCB",
    component_name: null,
    component_attribution_kind: "counterparty_industry",
    component_attribution_reason: "unit test",
    evidence_level: 4,
    confidence: 0.9,
    evidence_ids: [`EV-${input.edge_id}`],
    source_adapters: ["apple-suppliers"],
    source_urls: ["https://example.test"]
  };
}
