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
    expect(output).toContain("## Trade and material taxonomy");
    expect(output).toContain("HS 854232");
    expect(output).toContain("Proxy only: yes");
    expect(output).toContain("## Related observations");
    expect(output).toContain("INVENTORY_OBSERVATION: inventory_days");
    expect(output).toContain("Exact allocation by HBM generation");
  });

  it("renders a stable JSON envelope", () => {
    const parsed = JSON.parse(renderComponentCard(componentCardFixture(), "json")) as {
      schema_version: string;
      component: { component_id: string };
      known_suppliers: unknown[];
      evidence_edges: unknown[];
      trade_taxonomy: { hs_codes: unknown[]; materials: unknown[] };
      related_observations: unknown[];
    };

    expect(parsed.schema_version).toBe("1.0.0");
    expect(parsed.component.component_id).toBe("COMP-MEMORY");
    expect(parsed.known_suppliers).toHaveLength(1);
    expect(parsed.evidence_edges).toHaveLength(1);
    expect(parsed.trade_taxonomy.hs_codes).toHaveLength(1);
    expect(parsed.related_observations).toHaveLength(1);
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
        source_date: "2026-02-25T00:00:00.000Z"
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
        created_at: "2026-02-25T00:00:00.000Z"
      }
    ],
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
