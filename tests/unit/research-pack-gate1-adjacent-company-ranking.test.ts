import { describe, expect, it } from "vitest";
import type { Gate1AdjacentOfficialFactsReport } from "@supplystrata/research-pack";
import { rankAdjacentOfficialFactCompanyCandidates } from "../../packages/research-pack/src/gate1-adjacent-company-ranking.js";

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
    expect(candidates[0]?.suggested_label).toBe("useful_target");
  });

  it("flags repeated non-component disclosure-center candidates as review suggestions, not gold labels", () => {
    const candidates = rankAdjacentOfficialFactCompanyCandidates({
      selected_company_id: "ENT-NVIDIA",
      component_id: "COMP-PCB",
      edges: [
        adjacentFactEdge({
          edge_id: "EDGE-BRAND-1",
          from_id: "ENT-BRAND",
          from_name: "Brand Center",
          from_industry: ["consumer-electronics"],
          to_id: "ENT-UNMAPPED-A",
          to_name: "Unmapped Supplier A",
          to_industry: ["assembly"],
          relation: "BUYS_FROM"
        }),
        adjacentFactEdge({
          edge_id: "EDGE-BRAND-2",
          from_id: "ENT-BRAND",
          from_name: "Brand Center",
          from_industry: ["consumer-electronics"],
          to_id: "ENT-UNMAPPED-B",
          to_name: "Unmapped Supplier B",
          to_industry: ["assembly"],
          relation: "BUYS_FROM"
        })
      ]
    });

    const brandCandidate = candidates.find((candidate) => candidate.company_id === "ENT-BRAND");
    expect(brandCandidate).toEqual(
      expect.objectContaining({
        company_id: "ENT-BRAND",
        edge_count: 2,
        suggested_label: "brand_center_bias",
        suggestion_policy: "rule_suggestion_not_gold_label"
      })
    );
    expect(brandCandidate?.suggested_label_reason).toContain("disclosure-center");
  });
});

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
