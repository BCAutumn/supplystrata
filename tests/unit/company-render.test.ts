import { describe, expect, it } from "vitest";
import { renderCompanyCard, type CompanyCardModel } from "@supplystrata/render";

describe("CompanyCard renderer", () => {
  it("renders top exposure nodes without collapsing metrics into an opaque score", () => {
    const output = renderCompanyCard(companyCardFixture(), "markdown");

    expect(output).toContain("## Top exposure nodes");
    expect(output).toContain("## Related observations");
    expect(output).toContain("## Financial peer position");
    expect(output).toContain("INVENTORY_OBSERVATION: inventory_days");
    expect(output).toContain("Change: 42.00% vs baseline 100; delta 42");
    expect(output).toContain("Anomaly: moderate increase; change 42.00% vs baseline");
    expect(output).toContain("revenue (FY2026 FY)");
    expect(output).toContain("peer z-score 1.25");
    expect(output).toContain("percentile 90.0%");
    expect(output).toContain("SK Hynix [ENT-SKHYNIX] via memory [COMP-MEMORY]");
    expect(output).toContain("node_knockout_reach: 1");
    expect(output).toContain("path_redundancy: 0");
    expect(output).not.toContain("risk_score");
  });

  it("renders top exposure nodes in the JSON envelope", () => {
    const parsed = JSON.parse(renderCompanyCard(companyCardFixture(), "json")) as {
      schema_version: string;
      related_observations: Array<{ anomaly: { is_anomaly: boolean } | null }>;
      financial_peer_metrics: Array<{ metric_name: string; z_score: number | null }>;
      top_exposure_nodes: Array<{ node_id: string; metrics: unknown[] }>;
    };

    expect(parsed.schema_version).toBe("1.0.0");
    expect(parsed.related_observations).toHaveLength(1);
    expect(parsed.related_observations[0]?.anomaly?.is_anomaly).toBe(true);
    expect(parsed.financial_peer_metrics).toHaveLength(1);
    expect(parsed.financial_peer_metrics[0]?.metric_name).toBe("revenue");
    expect(parsed.financial_peer_metrics[0]?.z_score).toBe(1.25);
    expect(parsed.top_exposure_nodes).toHaveLength(1);
    expect(parsed.top_exposure_nodes[0]?.node_id).toBe("ENT-SKHYNIX");
    expect(parsed.top_exposure_nodes[0]?.metrics).toHaveLength(3);
  });
});

function companyCardFixture(): CompanyCardModel {
  return {
    entity: {
      entity_id: "ENT-NVIDIA",
      canonical_name: "NVIDIA",
      display_name: "NVIDIA"
    },
    directly_disclosed_upstream: [
      {
        edge_id: "EDGE-1",
        relation: "BUYS_FROM",
        component: "memory",
        component_id: "COMP-MEMORY",
        component_specificity: "explicit",
        counterparty_id: "ENT-SKHYNIX",
        counterparty_name: "SK Hynix",
        evidence_level: 5,
        confidence: 0.94,
        is_inferred: false,
        primary_evidence_id: "EV-1",
        cite_text: "We purchase memory from SK Hynix.",
        source_url: "https://example.com/10k",
        source_date: "2026-02-25T00:00:00.000Z"
      }
    ],
    directly_disclosed_downstream: [],
    related_observations: [
      {
        observation_id: "OBS-1",
        observation_type: "INVENTORY_OBSERVATION",
        source_adapter_id: "fixture-observation",
        source_item_id: null,
        doc_id: null,
        scope_kind: "company",
        scope_id: "ENT-NVIDIA",
        geography_kind: null,
        geography_id: null,
        component_id: null,
        metric_name: "inventory_days",
        metric_value: "42",
        metric_unit: "days",
        time_window_start: null,
        time_window_end: null,
        baseline_value: "100",
        change_value: "42",
        change_percent: 42,
        confidence: 0.7,
        provenance: { fixture: true },
        attrs: {},
        anomaly: {
          risk_view_id: "RSK-OBS-1",
          model_version: "observation-anomaly-baseline.v1",
          generated_at: "2026-05-19T00:00:00.000Z",
          metric_id: "RKM-OBS-1",
          is_anomaly: true,
          severity: "moderate",
          direction: "increase",
          change_percent: 42,
          threshold_percent: 25,
          method: "observation-anomaly.baseline-change-percent.v1"
        },
        created_at: "2026-02-25T00:00:00.000Z"
      }
    ],
    financial_peer_metrics: [
      {
        risk_view_id: "RSK-FIN-PEER-1",
        generated_at: "2026-05-19T00:00:00.000Z",
        model_version: "financial-peer-comparison.v1",
        inputs_fingerprint: "peer-fingerprint",
        metric_id: "RKM-FIN-PEER-1",
        value: "1.250000",
        confidence: 0.9,
        metric_name: "revenue",
        metric_value: 89500000000,
        metric_unit: "USD",
        fiscal_year: 2026,
        fiscal_period: "FY",
        period_basis: "fiscal_period",
        peer_count: 5,
        percentile: 0.9,
        rank_descending: 1,
        z_score: 1.25,
        peer_company_ids: ["ENT-AMD", "ENT-INTEL", "ENT-MICRON", "ENT-MICROSOFT", "ENT-NVIDIA"],
        provenance: { observation_id: "OBS-FIN-1" },
        attrs: { limitation: "fixture" }
      }
    ],
    top_exposure_nodes: [
      {
        node_id: "ENT-SKHYNIX",
        node_name: "SK Hynix",
        direction: "upstream",
        component_id: "COMP-MEMORY",
        component: "memory",
        risk_view_id: "RSK-COMP-1",
        model_version: "component-risk-baseline.v1",
        generated_at: "2026-05-19T00:00:00.000Z",
        metrics: [
          {
            metric_id: "RKM-KNOCKOUT",
            metric_kind: "node_knockout_reach",
            subject_kind: "entity",
            subject_id: "ENT-SKHYNIX",
            value: "1",
            confidence: 0.85,
            provenance: { input_edges: ["EDGE-1"] },
            attrs: { knockout_scope: "directed_component_fact_edge_reachability" }
          },
          {
            metric_id: "RKM-SINGLE",
            metric_kind: "single_source_exposure",
            subject_kind: "component",
            subject_id: "COMP-MEMORY",
            value: "1",
            confidence: 0.65,
            provenance: { supplier_ids: ["ENT-SKHYNIX"] },
            attrs: { supplier_count: 1 }
          },
          {
            metric_id: "RKM-REDUNDANCY",
            metric_kind: "path_redundancy",
            subject_kind: "component",
            subject_id: "COMP-MEMORY",
            value: "0",
            confidence: 0.85,
            provenance: { supplier_ids: ["ENT-SKHYNIX"] },
            attrs: { redundancy_scope: "terminal_consumer_simple_paths" }
          }
        ]
      }
    ],
    unknown_map: []
  };
}
