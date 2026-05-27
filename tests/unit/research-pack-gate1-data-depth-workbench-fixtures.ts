import { expect } from "vitest";
import type pg from "pg";
import type { DbClient } from "@supplystrata/db/read";
import type {
  Gate1AdjacentOfficialFactsReport,
  Gate1EntityAffiliationContext,
  PropagationReadinessReport,
  SourceTargetCoverageReport,
  SupplyChainExpansionPlan
} from "@supplystrata/research-pack";
import type { WorkbenchModel } from "@supplystrata/workbench-export";
import { edgeFixture, emptyWorkbench, officialSourceTargetCoverage } from "./research-pack-fixtures.js";

interface QueryCall {
  sql: string;
  params: readonly unknown[];
}

export class EntityAffiliationDbClient implements DbClient {
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

export class AdjacentFactsDbClient implements DbClient {
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

export function workbenchWithSamsungMemoryEdge(): WorkbenchModel {
  const workbench = emptyWorkbench();
  workbench.companies = [
    { entity_id: "ENT-NVIDIA", name: "NVIDIA", role: "root" },
    { entity_id: "ENT-SAMSUNG-MEMORY", name: "Samsung Memory", role: "counterparty" }
  ];
  workbench.edges = [edgeFixture("EDGE-1", "ENT-NVIDIA", "NVIDIA", "ENT-SAMSUNG-MEMORY", "Samsung Memory", "COMP-MEMORY")];
  workbench.chain_segments = [];
  return workbench;
}

export function samsungMemoryAffiliation(): Gate1EntityAffiliationContext {
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

export function samsungMemoryAffiliationWithDisposition(): Gate1EntityAffiliationContext {
  return {
    ...samsungMemoryAffiliation(),
    latest_disposition: {
      change_id: "CHG-ENTITY-AFFILIATION-1",
      decision: "research_parent_entity",
      reviewer: "unit-test",
      reason: "Parent legal entity owns the official disclosure path.",
      recorded_at: "2026-05-26T00:00:00.000Z",
      edge_ids: ["EDGE-1"],
      component_ids: ["COMP-MEMORY"],
      unknown_ids: ["UNK-SAMSUNG-PARENT-ROOT"]
    }
  };
}

export function emptySupplyChainExpansionPlan(): SupplyChainExpansionPlan {
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

export function expansionPlanWithSamsungMemoryFrontier(): SupplyChainExpansionPlan {
  const empty = emptySupplyChainExpansionPlan();
  return {
    ...empty,
    summary: {
      ...empty.summary,
      fact_edges_considered: 1,
      frontier_edges: 1,
      frontier_companies: 1
    },
    frontier: [
      {
        frontier_id: "SCF-SAMSUNG-MEMORY",
        edge_id: "EDGE-1",
        path_depth: 1,
        expansion_state: "expand_candidate",
        from_id: "ENT-NVIDIA",
        from_name: "NVIDIA",
        to_id: "ENT-SAMSUNG-MEMORY",
        to_name: "Samsung Memory",
        next_company_id: "ENT-SAMSUNG-MEMORY",
        next_company_name: "Samsung Memory",
        relation: "supplier",
        component_id: "COMP-MEMORY",
        evidence_level: 5,
        unknown_ids: ["UNK-SAMSUNG-PARENT-ROOT"],
        source_plan_refs: [],
        rationale: "Ready business-unit frontier.",
        action: "Run recursive company research."
      }
    ]
  };
}

export function expansionPlanWithBlockedFacilityAndReadyCompany(): SupplyChainExpansionPlan {
  const empty = emptySupplyChainExpansionPlan();
  return {
    ...empty,
    summary: {
      ...empty.summary,
      fact_edges_considered: 2,
      frontier_edges: 2,
      frontier_companies: 2,
      blocked_frontier_edges: 1
    },
    frontier: [
      {
        frontier_id: "SCF-FACILITY",
        edge_id: "EDGE-FACILITY",
        path_depth: 1,
        expansion_state: "needs_component_context",
        from_id: "ENT-NVIDIA",
        from_name: "NVIDIA",
        to_id: "ENT-FAC-UNIT-TEST",
        to_name: "Facility test node",
        next_company_id: "ENT-FAC-UNIT-TEST",
        next_company_name: "Facility test node",
        relation: "facility",
        component_id: null,
        evidence_level: 4,
        unknown_ids: [],
        source_plan_refs: [],
        rationale: "Missing component context.",
        action: "Backfill component context."
      },
      {
        frontier_id: "SCF-TSMC",
        edge_id: "EDGE-TSMC",
        path_depth: 1,
        expansion_state: "expand_candidate",
        from_id: "ENT-NVIDIA",
        from_name: "NVIDIA",
        to_id: "ENT-TSMC",
        to_name: "TSMC",
        next_company_id: "ENT-TSMC",
        next_company_name: "TSMC",
        relation: "supplier",
        component_id: "COMP-WAFER",
        evidence_level: 5,
        unknown_ids: [],
        source_plan_refs: [],
        rationale: "Ready company frontier.",
        action: "Run recursive company research."
      }
    ]
  };
}

export function emptyPropagationReadinessReport(): PropagationReadinessReport {
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

export function adjacentOfficialFactsReport(): Gate1AdjacentOfficialFactsReport {
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

export function sourceTargetCoverageWithCalibrationCandidates(): SourceTargetCoverageReport {
  const coverage = officialSourceTargetCoverage("succeeded");
  const target = coverage.items[0];
  if (target === undefined) {
    throw new Error("official source target coverage fixture must include one target");
  }
  coverage.summary.targets_with_observations = 1;
  coverage.summary.total_observations = 2;
  coverage.summary.observed_subject_entities = 1;
  coverage.summary.observations_by_source = { "samsung-ir": 2 };
  coverage.summary.observations_by_metric = { purchase_obligations: 1, revenue: 1 };
  coverage.items[0] = {
    ...target,
    observations: 2,
    observations_by_metric: { purchase_obligations: 1, revenue: 1 },
    observation_samples: [observationSample("OBS-CAL-1", "purchase_obligations"), observationSample("OBS-CAL-2", "revenue")],
    latest_observation_at: "2026-01-01T00:00:00.000Z"
  };
  coverage.observation_review = {
    summary: {
      review_items: 2,
      calibration_candidates: 2,
      labeled_calibration_candidates: 0,
      unlabeled_calibration_candidates: 2,
      next_labeling_batch_candidates: 2,
      p0: 1,
      p1: 1,
      p2: 0,
      by_category: {
        supply_chain_signal: 1,
        financial_context: 1,
        metric_mapping_gap: 0
      },
      by_recommended_label: {
        useful_signal: 1,
        background_context: 0,
        needs_context: 1,
        not_useful: 0
      },
      by_persisted_label: {
        useful_signal: 0,
        background_context: 0,
        needs_context: 0,
        not_useful: 0
      },
      next_labeling_batch_by_priority: { P0: 1, P1: 1, P2: 0 },
      next_labeling_batch_by_metric: { purchase_obligations: 1, revenue: 1 }
    },
    items: [],
    calibration_candidates: [],
    labeling_plan: {
      strategy: "stratified_unlabeled_by_priority_metric",
      review_policy: "review_only_no_fact_mutation",
      batch_size: 12,
      candidates: [
        calibrationCandidate("OBS-CAL-1", "purchase_obligations", "P0", "supply_chain_signal", "useful_signal"),
        calibrationCandidate("OBS-CAL-2", "revenue", "P1", "financial_context", "needs_context")
      ]
    }
  };
  return coverage;
}

function observationSample(observationId: string, metricName: string): SourceTargetCoverageReport["items"][number]["observation_samples"][number] {
  return {
    observation_id: observationId,
    observation_type: "metric_observation",
    metric_name: metricName,
    metric_value: "100",
    metric_unit: "USD",
    baseline_value: null,
    change_percent: null,
    scope_kind: "company",
    scope_id: "ENT-SAMSUNG-ELECTRONICS",
    doc_id: "DOC-CAL",
    source_item_id: "SRC-CAL",
    source_url: "https://example.test/calibration",
    time_window_start: null,
    time_window_end: "2026-01-01T00:00:00.000Z",
    confidence: 0.8
  };
}

function calibrationCandidate(
  observationId: string,
  metricName: string,
  priority: "P0" | "P1",
  category: "supply_chain_signal" | "financial_context",
  recommendedLabel: "useful_signal" | "needs_context"
): SourceTargetCoverageReport["observation_review"]["labeling_plan"]["candidates"][number] {
  return {
    candidate_id: `CAL-${observationId}`,
    observation_id: observationId,
    metric_name: metricName,
    priority,
    category,
    recommended_label: recommendedLabel,
    selection_reason: `${priority} ${category} sample`,
    doc_id: "DOC-CAL",
    source_item_id: "SRC-CAL",
    source_url: "https://example.test/calibration",
    time_window_end: "2026-01-01T00:00:00.000Z"
  };
}
