import { describe, expect, it } from "vitest";
import { buildResearchPackFromWorkbench, collectResearchComponentIds, safeFileSegment } from "@supplystrata/research-pack";
import type { ChainViewSegmentModel } from "@supplystrata/chain-view";
import type { WorkbenchModel } from "@supplystrata/workbench-export";

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
  });
});
