import { afterEach, describe, expect, it } from "vitest";
import {
  derive_dynamic_profile,
  disambiguate_entity,
  suggest_source_targets,
  summarize_with_citations,
  type DisambiguateEntityCandidate,
  type LlmProvider,
  type LlmProviderJsonRequest,
  type LlmProviderJsonResponse
} from "@supplystrata/llm-helpers";

describe("llm helpers", () => {
  afterEach(() => {
    delete process.env["SUPPLYSTRATA_LLM_DISABLED"];
  });

  it("returns disabled candidates when no provider is supplied", async () => {
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
    const provider = new FixtureProvider({});

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
    expect(provider.requests).toHaveLength(0);
  });

  it("disambiguates by accepting only ranked input candidates", async () => {
    const provider = new FixtureProvider({
      confidence: 0.91,
      rationale: "The LEI-backed candidate matches the local context.",
      citations: [{ source_ref: "lei:969500FP1Q07I98R6P10", cite_text: "LEI match" }],
      ranked_candidates: [
        {
          entity_id: "lei:969500FP1Q07I98R6P10",
          label: "LVMH Moet Hennessy Louis Vuitton SE",
          confidence: 0.91,
          reason: "The legal name expands the acronym."
        }
      ]
    });

    const candidate = await disambiguate_entity(
      {
        surface: "LVMH",
        nearby_text: "Luxury group headquartered in France",
        candidates: [{ entity_id: "lei:969500FP1Q07I98R6P10", label: "LVMH Moet Hennessy Louis Vuitton SE", confidence: 0.8, reason: "LEI match" }]
      },
      { provider, generated_at: "2026-05-28T00:00:00.000Z" }
    );

    expect(candidate).toMatchObject({
      helper: "disambiguate_entity",
      status: "candidate",
      confidence: 0.91,
      provider_request_id: "provider-request-1",
      ranked_candidates: [{ entity_id: "lei:969500FP1Q07I98R6P10" }]
    });
    expect(provider.requests[0]?.prompt_version).toBe("disambiguate_entity.v1");
    expect(provider.requests[0]?.prompt.system).toContain("All outputs are candidates");
  });

  it("rejects disambiguation output that invents entity ids", async () => {
    const provider = new FixtureProvider({
      confidence: 0.8,
      rationale: "Invented candidate should be rejected.",
      citations: [{ source_ref: "lei:969500FP1Q07I98R6P10" }],
      ranked_candidates: [{ entity_id: "invented", label: "Invented", confidence: 0.8, reason: "Not allowed" }]
    });

    const candidate = await disambiguate_entity(
      {
        surface: "LVMH",
        candidates: [{ entity_id: "lei:969500FP1Q07I98R6P10", label: "LVMH", confidence: 0.5, reason: "fixture" }]
      },
      { provider }
    );

    expect(candidate.status).toBe("invalid_output");
    expect(candidate.ranked_candidates).toEqual([]);
    expect(candidate.rationale).toContain("entity_id must come from input.candidates");
  });

  it("keeps ambiguous disambiguation as deferred instead of forcing a fact-like answer", async () => {
    const provider = new FixtureProvider({
      confidence: 0.42,
      rationale: "The local text is too short to separate the candidates.",
      citations: [{ source_ref: "ENT-A" }],
      ranked_candidates: [{ entity_id: "ENT-A", label: "Candidate A", confidence: 0.42, reason: "Weak local match" }]
    });

    const candidate = await disambiguate_entity(
      {
        surface: "ABC",
        candidates: [
          { entity_id: "ENT-A", label: "Candidate A", confidence: 0.5, reason: "Name match" },
          { entity_id: "ENT-B", label: "Candidate B", confidence: 0.5, reason: "Name match" }
        ]
      },
      { provider }
    );

    expect(candidate).toMatchObject({
      helper: "disambiguate_entity",
      status: "deferred",
      confidence: 0.42,
      fact_write_allowed: false
    });
  });

  it("derives dynamic profile candidates with citation refs constrained to input", async () => {
    const provider = new FixtureProvider({
      confidence: 0.74,
      rationale: "Filing excerpt mentions foundry exposure.",
      citations: [{ source_ref: "filing:2025-10k" }],
      expected_upstream_components: [{ component_id: "GPU", label: "GPU foundry capacity", rationale: "Critical upstream dependency." }],
      source_targets: [{ source_adapter_id: "sec-edgar", target_ref: "CIK0001045810:10-K:2025", rationale: "Official filing target." }]
    });

    const candidate = await derive_dynamic_profile(
      {
        company_id: "ENT-NVIDIA",
        company_name: "NVIDIA",
        filing_excerpt: "We depend on foundries.",
        source_refs: ["filing:2025-10k"]
      },
      { provider }
    );

    expect(candidate).toMatchObject({
      helper: "derive_dynamic_profile",
      status: "candidate",
      expected_upstream_components: [{ label: "GPU foundry capacity" }],
      source_targets: [{ source_adapter_id: "sec-edgar" }]
    });
  });

  it("rejects derived profile citations outside source_refs", async () => {
    const provider = new FixtureProvider({
      confidence: 0.7,
      rationale: "Bad citation.",
      citations: [{ source_ref: "invented" }],
      expected_upstream_components: [],
      source_targets: []
    });

    const candidate = await derive_dynamic_profile({ company_id: "ENT-NVIDIA", company_name: "NVIDIA", source_refs: ["filing:2025-10k"] }, { provider });

    expect(candidate.status).toBe("invalid_output");
    expect(candidate.citations).toEqual([]);
    expect(candidate.rationale).toContain("source_ref must come from helper input");
  });

  it("suggests source targets without claiming they are facts", async () => {
    const provider = new FixtureProvider({
      confidence: 0.83,
      rationale: "Coverage gap points to the official filing adapter.",
      citations: [{ source_ref: "unknown:gpu-foundry" }],
      source_targets: [{ source_adapter_id: "sec-edgar", target_ref: "ENT-NVIDIA:10-K:2025", rationale: "Official annual filing." }]
    });

    const candidate = await suggest_source_targets(
      {
        company_id: "ENT-NVIDIA",
        current_coverage_refs: ["source_target:sec-edgar:nvidia"],
        unknown_context: ["unknown:gpu-foundry"]
      },
      { provider }
    );

    expect(candidate).toMatchObject({
      helper: "suggest_source_targets",
      status: "candidate",
      source_targets: [{ target_ref: "ENT-NVIDIA:10-K:2025" }],
      fact_write_allowed: false
    });
  });

  it("returns provider_error candidates for source target provider failures", async () => {
    const candidate = await suggest_source_targets(
      {
        company_id: "ENT-NVIDIA",
        current_coverage_refs: [],
        unknown_context: []
      },
      {
        provider: new ThrowingProvider()
      }
    );

    expect(candidate).toMatchObject({
      helper: "suggest_source_targets",
      status: "provider_error",
      source_targets: [],
      fact_write_allowed: false
    });
  });

  it("summarizes only cited evidence ids from input", async () => {
    const provider = new FixtureProvider({
      confidence: 0.88,
      rationale: "Both snippets support the short summary.",
      citations: [{ source_ref: "EV-1" }],
      summary: "The official filing supports a foundry dependency, but it does not confirm a supplier edge.",
      cited_evidence_ids: ["EV-1"]
    });

    const candidate = await summarize_with_citations(
      {
        question: "What is supported?",
        evidence: [
          {
            evidence_id: "EV-1",
            cite_text: "We use third-party foundries."
          }
        ]
      },
      { provider }
    );

    expect(candidate).toMatchObject({
      helper: "summarize_with_citations",
      status: "candidate",
      cited_evidence_ids: ["EV-1"],
      fact_write_allowed: false
    });
    expect(candidate.summary).toContain("does not confirm");
  });

  it("rejects summaries that cite evidence ids not present in input", async () => {
    const provider = new FixtureProvider({
      confidence: 0.6,
      rationale: "Bad evidence id.",
      citations: [{ source_ref: "EV-404" }],
      summary: "Unsupported claim.",
      cited_evidence_ids: ["EV-404"]
    });

    const candidate = await summarize_with_citations(
      {
        question: "What is supported?",
        evidence: [{ evidence_id: "EV-1", cite_text: "Official filing text" }]
      },
      { provider }
    );

    expect(candidate.status).toBe("invalid_output");
    expect(candidate.summary).toBe("");
    expect(candidate.rationale).toContain("source_ref must come from helper input");
  });
});

class FixtureProvider implements LlmProvider {
  readonly requests: LlmProviderJsonRequest[] = [];

  constructor(private readonly output: Record<string, unknown>) {}

  async completeJson(request: LlmProviderJsonRequest) {
    this.requests.push(request);
    return {
      provider_request_id: "provider-request-1",
      model: "fixture-model",
      output: this.output
    };
  }
}

class ThrowingProvider implements LlmProvider {
  async completeJson(): Promise<LlmProviderJsonResponse> {
    throw new Error("network unavailable");
  }
}
