import { afterEach, describe, expect, it } from "vitest";
import {
  derive_dynamic_profile,
  disambiguate_entity,
  suggest_source_targets,
  summarize_with_citations,
  type DisambiguateEntityCandidate,
  type LlmProvider
} from "@supplystrata/llm-helpers";

describe("llm helpers", () => {
  afterEach(() => {
    delete process.env["SUPPLYSTRATA_LLM_DISABLED"];
  });

  it("returns disabled candidates for all helper skeletons", async () => {
    const generated_at = "2026-05-28T00:00:00.000Z";
    const results = await Promise.all([
      disambiguate_entity(
        {
          surface: "LVMH",
          candidates: [{ entity_id: "lei:969500FP1Q07I98R6P10", label: "LVMH Moet Hennessy Louis Vuitton SE", confidence: 0.8, reason: "LEI match" }]
        },
        { generated_at }
      ),
      derive_dynamic_profile({ company_id: "ENT-LVMH", company_name: "LVMH" }, { generated_at }),
      suggest_source_targets({ company_id: "ENT-LVMH", current_coverage_refs: [], unknown_context: [] }, { generated_at }),
      summarize_with_citations({ question: "What is supported?", evidence: [{ evidence_id: "EV-1", cite_text: "Official filing text" }] }, { generated_at })
    ]);

    expect(results.map((candidate) => candidate.status)).toEqual(["disabled", "disabled", "disabled", "disabled"]);
    expect(results.every((candidate) => candidate.fact_write_allowed === false)).toBe(true);
    expect(results.every((candidate) => candidate.generated_at === generated_at)).toBe(true);
  });

  it("lets the global env disable helper execution even when a provider is passed", async () => {
    process.env["SUPPLYSTRATA_LLM_DISABLED"] = "1";
    const provider: LlmProvider = {
      async completeJson() {
        throw new Error("provider should not be called by the disabled skeleton");
      }
    };

    const candidate: DisambiguateEntityCandidate = await disambiguate_entity(
      {
        surface: "LVMH",
        candidates: [{ entity_id: "lei:969500FP1Q07I98R6P10", label: "LVMH", confidence: 0.5, reason: "fixture" }]
      },
      { provider, disabled: false, generated_at: "2026-05-28T00:00:00.000Z" }
    );

    expect(candidate).toMatchObject({
      helper: "disambiguate_entity",
      status: "disabled",
      confidence: 0,
      provider_request_id: null,
      model: null,
      ranked_candidates: []
    });
    expect(candidate.rationale).toContain("SUPPLYSTRATA_LLM_DISABLED=1");
  });
});
