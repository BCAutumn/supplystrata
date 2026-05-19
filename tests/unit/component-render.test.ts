import { describe, expect, it } from "vitest";
import { renderComponentCard, type ComponentCardModel } from "@supplystrata/render";

describe("ComponentCard renderer", () => {
  it("renders supplier, consumer, evidence, source coverage, and unknown map", () => {
    const output = renderComponentCard(componentCardFixture(), "markdown");

    expect(output).toContain("# Component memory [COMP-MEMORY]");
    expect(output).toContain("## Known suppliers");
    expect(output).toContain("SK Hynix [ENT-SKHYNIX]");
    expect(output).toContain("## Known consumers");
    expect(output).toContain("NVIDIA [ENT-NVIDIA]");
    expect(output).toContain("SK Hynix -> NVIDIA via BUYS_FROM");
    expect(output).toContain("Intelligence: dependency=1 dependency_index; freshness 0.85");
    expect(output).toContain("## Trade and material taxonomy");
    expect(output).toContain("HS 854232");
    expect(output).toContain("Proxy only: yes");
    expect(output).toContain("## Related observations");
    expect(output).toContain("INVENTORY_OBSERVATION: inventory_days");
    expect(output).toContain("Anomaly: within baseline; change 5.00% vs baseline");
    expect(output).toContain("## Linked company financial signals");
    expect(output).toContain("Micron [ENT-MICRON] as supplier");
    expect(output).toContain("revenue: 30391000000 USD");
    expect(output).toContain("Change: 260.08% vs baseline 8440000000; delta 21951000000");
    expect(output).toContain("## Risk baseline");
    expect(output).toContain("supplier_concentration_hhi: unknown");
    expect(output).toContain("Share unknown: yes");
    expect(output).toContain("Exact allocation by HBM generation");
  });

  it("renders a stable JSON envelope", () => {
    const parsed = JSON.parse(renderComponentCard(componentCardFixture(), "json")) as {
      schema_version: string;
      component: { component_id: string };
      known_suppliers: unknown[];
      evidence_edges: unknown[];
      trade_taxonomy: { hs_codes: unknown[]; materials: unknown[] };
      related_observations: Array<{ anomaly: { is_anomaly: boolean } | null }>;
      linked_company_observations: Array<{ entity_id: string; observations: unknown[] }>;
      risk_view: { risk_view_id: string; metrics: unknown[] } | null;
    };

    expect(parsed.schema_version).toBe("1.0.0");
    expect(parsed.component.component_id).toBe("COMP-MEMORY");
    expect(parsed.known_suppliers).toHaveLength(1);
    expect(parsed.evidence_edges).toHaveLength(1);
    expect(parsed.trade_taxonomy.hs_codes).toHaveLength(1);
    expect(parsed.related_observations).toHaveLength(1);
    expect(parsed.related_observations[0]?.anomaly?.is_anomaly).toBe(false);
    expect(parsed.linked_company_observations).toHaveLength(1);
    expect(parsed.linked_company_observations[0]?.entity_id).toBe("ENT-MICRON");
    expect(parsed.linked_company_observations[0]?.observations).toHaveLength(1);
    expect(parsed.risk_view?.metrics).toHaveLength(1);
  });
});

function componentCardFixture(): ComponentCardModel {
  return {
    component: {
      component_id: "COMP-MEMORY",
      name: "memory",
      taxonomy_path: ["semiconductor", "memory"],
      aliases: ["DRAM/HBM"]
    },
    known_suppliers: [
      {
        entity_id: "ENT-SKHYNIX",
        name: "SK Hynix",
        roles: ["BUYS_FROM"],
        edge_count: 1,
        best_evidence_level: 5,
        best_confidence: 0.94
      }
    ],
    known_consumers: [
      {
        entity_id: "ENT-NVIDIA",
        name: "NVIDIA",
        roles: ["BUYS_FROM"],
        edge_count: 1,
        best_evidence_level: 5,
        best_confidence: 0.94
      }
    ],
    evidence_edges: [
      {
        edge_id: "EDGE-1",
        relation: "BUYS_FROM",
        supplier_id: "ENT-SKHYNIX",
        supplier_name: "SK Hynix",
        consumer_id: "ENT-NVIDIA",
        consumer_name: "NVIDIA",
        evidence_level: 5,
        confidence: 0.94,
        is_inferred: false,
        primary_evidence_id: "EV-1",
        cite_text: "We purchase memory from SK Hynix.",
        source_url: "https://example.com/10k",
        source_date: "2026-02-25T00:00:00.000Z",
        intelligence: {
          strengths: [
            {
              strength_kind: "dependency",
              value: "1",
              unit: "dependency_index",
              method: "intelligence-refresh.dependency-text.v1",
              evidence_id: "EV-1"
            }
          ],
          freshness: {
            last_verified_at: "2026-02-25T00:00:00.000Z",
            age_days: 200,
            freshness_score: 0.85,
            decay_model: "methodology.v1"
          },
          unknowns: []
        }
      }
    ],
    source_coverage: {
      sources: 1,
      evidence_edges: 1,
      latest_source_date: "2026-02-25"
    },
    trade_taxonomy: {
      hs_codes: [
        {
          system: "HS",
          code: "854232",
          description: "Electronic integrated circuits: memories",
          confidence: 0.72,
          proxy_only: true,
          notes: "Broad memory IC trade proxy; cannot distinguish buyer-specific allocation."
        }
      ],
      materials: [
        {
          material_id: "MAT-SILICON",
          name: "Semiconductor-grade silicon",
          role: "wafer substrate input",
          confidence: 0.55,
          source_suggestions: ["USGS Mineral Commodity Summaries"]
        }
      ]
    },
    related_observations: [
      {
        observation_id: "OBS-1",
        observation_type: "INVENTORY_OBSERVATION",
        source_adapter_id: "fixture-observation",
        source_item_id: null,
        doc_id: null,
        scope_kind: "component",
        scope_id: "COMP-MEMORY",
        geography_kind: null,
        geography_id: null,
        component_id: "COMP-MEMORY",
        metric_name: "inventory_days",
        metric_value: "42",
        metric_unit: "days",
        time_window_start: null,
        time_window_end: null,
        baseline_value: null,
        change_value: null,
        change_percent: null,
        confidence: 0.7,
        provenance: { fixture: true },
        attrs: {},
        anomaly: {
          risk_view_id: "RSK-OBS-1",
          model_version: "observation-anomaly-baseline.v1",
          generated_at: "2026-05-19T00:00:00.000Z",
          metric_id: "RKM-OBS-1",
          is_anomaly: false,
          severity: "none",
          direction: "increase",
          change_percent: 5,
          threshold_percent: 25,
          method: "observation-anomaly.baseline-change-percent.v1"
        },
        created_at: "2026-02-25T00:00:00.000Z"
      }
    ],
    linked_company_observations: [
      {
        entity_id: "ENT-MICRON",
        entity_name: "Micron",
        role: "supplier",
        edge_ids: ["EDGE-1"],
        observations: [
          {
            observation_id: "OBS-FIN-1",
            observation_type: "FINANCIAL_METRIC_OBSERVATION",
            source_adapter_id: "sec-edgar",
            source_item_id: "SRCITEM-1",
            doc_id: "DOC-MICRON",
            scope_kind: "company",
            scope_id: "ENT-MICRON",
            geography_kind: null,
            geography_id: null,
            component_id: null,
            metric_name: "revenue",
            metric_value: "30391000000",
            metric_unit: "USD",
            time_window_start: "2024-08-30T00:00:00.000Z",
            time_window_end: "2025-08-28T00:00:00.000Z",
            baseline_value: "8440000000",
            change_value: "21951000000",
            change_percent: 260.082938,
            confidence: 0.9,
            provenance: { accession: "0000723125-25-000064", xbrl_tag: "Revenues" },
            attrs: { semantic_layer: "observation" },
            anomaly: {
              risk_view_id: "RSK-OBS-FIN-1",
              model_version: "observation-anomaly-baseline.v2",
              generated_at: "2026-05-19T00:00:00.000Z",
              metric_id: "RKM-OBS-FIN-1",
              is_anomaly: true,
              severity: "critical",
              direction: "increase",
              change_percent: 260.082938,
              threshold_percent: 25,
              baseline_method: "explicit_baseline",
              baseline_value: "8440000000",
              method: "observation-anomaly.baseline-change-percent.v1"
            },
            created_at: "2026-05-19T00:00:00.000Z"
          }
        ]
      }
    ],
    risk_view: {
      risk_view_id: "RSK-COMP-1",
      generated_at: "2026-05-19T00:00:00.000Z",
      model_version: "component-risk-baseline.v1",
      inputs_fingerprint: "0123456789abcdef",
      summary: { share_unknown: true },
      attrs: { experimental: true },
      metrics: [
        {
          metric_id: "RKM-1",
          metric_kind: "supplier_concentration_hhi",
          subject_kind: "component",
          subject_id: "COMP-MEMORY",
          component_id: "COMP-MEMORY",
          value: null,
          confidence: 0,
          provenance: { input_edges: ["EDGE-1"] },
          attrs: { share_unknown: true, missing_share_edge_ids: ["EDGE-1"] }
        }
      ]
    },
    unknown_map: [
      {
        unknown_id: "UNK-1",
        question: "Exact allocation by HBM generation",
        why_unknown: "The official disclosure says memory, not generation-specific allocation.",
        blocking_data_sources: ["private contracts"],
        proxies: ["supplier capex commentary"],
        status: "open"
      }
    ]
  };
}
