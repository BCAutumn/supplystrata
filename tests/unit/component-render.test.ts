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
    expect(output).toContain("Exact allocation by HBM generation");
  });

  it("renders a stable JSON envelope", () => {
    const parsed = JSON.parse(renderComponentCard(componentCardFixture(), "json")) as {
      schema_version: string;
      component: { component_id: string };
      known_suppliers: unknown[];
      evidence_edges: unknown[];
    };

    expect(parsed.schema_version).toBe("1.0.0");
    expect(parsed.component.component_id).toBe("COMP-MEMORY");
    expect(parsed.known_suppliers).toHaveLength(1);
    expect(parsed.evidence_edges).toHaveLength(1);
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
    known_suppliers: [{
      entity_id: "ENT-SKHYNIX",
      name: "SK Hynix",
      roles: ["BUYS_FROM"],
      edge_count: 1,
      best_evidence_level: 5,
      best_confidence: 0.94
    }],
    known_consumers: [{
      entity_id: "ENT-NVIDIA",
      name: "NVIDIA",
      roles: ["BUYS_FROM"],
      edge_count: 1,
      best_evidence_level: 5,
      best_confidence: 0.94
    }],
    evidence_edges: [{
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
      source_date: new Date("2026-02-25T00:00:00.000Z")
    }],
    source_coverage: {
      sources: 1,
      evidence_edges: 1,
      latest_source_date: "2026-02-25"
    },
    unknown_map: [{
      unknown_id: "UNK-1",
      question: "Exact allocation by HBM generation",
      why_unknown: "The official disclosure says memory, not generation-specific allocation.",
      blocking_data_sources: ["private contracts"],
      proxies: ["supplier capex commentary"],
      status: "open"
    }]
  };
}
