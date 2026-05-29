import { describe, expect, it } from "vitest";
import { selectOrDeriveResearchTargetProfile } from "@supplystrata/research-pack";
import type { LlmProvider, LlmProviderJsonRequest, LlmProviderJsonResponse } from "@supplystrata/llm-helpers";

class FixtureProvider implements LlmProvider {
  readonly calls: LlmProviderJsonRequest[] = [];

  constructor(private readonly output: Record<string, unknown>) {}

  async completeJson(request: LlmProviderJsonRequest): Promise<LlmProviderJsonResponse> {
    this.calls.push(request);
    return {
      provider_request_id: "fixture-request",
      model: "fixture-model",
      output: this.output
    };
  }
}

describe("dynamic research target profile derive", () => {
  it("returns an anchor profile without calling the llm-helper", async () => {
    const provider = new FixtureProvider({
      confidence: 0.9,
      rationale: "Should not be used.",
      citations: [],
      expected_upstream_components: [],
      source_targets: []
    });

    const selection = await selectOrDeriveResearchTargetProfile({
      company_id: "ENT-NVIDIA",
      company_name: "NVIDIA",
      component_ids: [],
      llm: { provider }
    });

    expect(selection.layer).toBe("anchor");
    expect(selection.profile?.profile_id).toBe("ai-compute-memory.v0");
    expect(provider.calls).toHaveLength(0);
  });

  it("derives a candidate profile for anchor misses and keeps it candidate-only", async () => {
    const provider = new FixtureProvider({
      confidence: 0.8,
      rationale: "Luxury goods supply chains often depend on packaging and specialty materials.",
      citations: [{ source_ref: "wikidata:Q504998" }],
      expected_upstream_components: [{ component_id: "COMP-PACKAGING", label: "premium packaging", rationale: "Public profile mentions luxury goods." }],
      source_targets: [{ source_adapter_id: "gleif", target_ref: "969500FP1Q07I98R6P10", rationale: "Official legal identity context." }]
    });

    const selection = await selectOrDeriveResearchTargetProfile({
      company_id: "ENT-LVMH",
      company_name: "LVMH Moët Hennessy Louis Vuitton SE",
      component_ids: [],
      public_description: "French luxury goods group.",
      source_refs: ["wikidata:Q504998"],
      llm: { provider, generated_at: "2026-05-29T00:00:00.000Z" }
    });

    expect(selection.layer).toBe("derived");
    expect(selection.profile).not.toBeNull();
    if (selection.profile === null || selection.profile.layer !== "derived") throw new Error("Expected derived profile.");
    expect(selection.profile.derivation.status).toBe("candidate");
    if (selection.profile.derivation.status !== "candidate") throw new Error("Expected candidate derivation.");
    expect(selection.profile.derivation.fact_write_allowed).toBe(false);
    expect(selection.profile.derivation.expected_upstream_components).toEqual([
      { component_id: "COMP-PACKAGING", label: "premium packaging", rationale: "Public profile mentions luxury goods." }
    ]);
    expect(selection.profile.derivation.source_targets).toEqual([
      { source_adapter_id: "gleif", target_ref: "969500FP1Q07I98R6P10", rationale: "Official legal identity context." }
    ]);
    expect(selection.profile.applies_to_component_ids).toEqual(["COMP-PACKAGING"]);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.helper).toBe("derive_dynamic_profile");
  });

  it("falls back to a generic derived profile when the helper is disabled", async () => {
    const selection = await selectOrDeriveResearchTargetProfile({
      company_id: "ENT-ASTRAZENECA",
      company_name: "AstraZeneca PLC",
      component_ids: ["COMP-PHARMA-INGREDIENT"],
      country_code: "GB",
      sic_code: "2834",
      source_refs: ["wikidata:Q731938"],
      llm: { disabled: true, generated_at: "2026-05-29T00:00:00.000Z" }
    });

    expect(selection.layer).toBe("derived");
    expect(selection.profile).not.toBeNull();
    if (selection.profile === null || selection.profile.layer !== "derived") throw new Error("Expected derived profile.");
    expect(selection.profile.derivation.status).toBe("generic");
    if (selection.profile.derivation.status !== "generic") throw new Error("Expected generic derivation.");
    expect(selection.profile.derivation.helper_status).toBe("disabled");
    expect(selection.profile.derivation.fact_write_allowed).toBe(false);
    expect(selection.profile.derivation.country_code).toBe("GB");
    expect(selection.profile.derivation.sic_code).toBe("2834");
    expect(selection.profile.derivation.expected_upstream_components).toEqual([]);
    expect(selection.profile.derivation.source_targets).toEqual([]);
  });

  it("keeps profile none as a hard opt-out for both anchor and derived layers", async () => {
    const selection = await selectOrDeriveResearchTargetProfile({
      profile_id: "none",
      company_id: "ENT-LVMH",
      company_name: "LVMH",
      component_ids: [],
      llm: { disabled: true }
    });

    expect(selection).toEqual({
      profile: null,
      layer: "none",
      reason: "Research target profile disabled by caller."
    });
  });
});
