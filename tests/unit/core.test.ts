import { describe, expect, it } from "vitest";
import {
  CHAIN_ENDPOINT_KINDS,
  CLAIM_TYPES,
  EDGE_FRESHNESS_DECAY_MODELS,
  EDGE_STRENGTH_KINDS,
  EXTRACTOR_ID_PREFIXES,
  LEAD_TYPES,
  OBSERVATION_TYPES,
  ALERT_KINDS,
  RANKING_CALIBRATION_LABELS,
  SEMANTIC_LAYERS,
  calculateEdgeFreshness,
  createDeterministicId,
  createId,
  inferExtractionMethod,
  stripEntityScopePrefix
} from "@supplystrata/core";

describe("core entity scope prefix", () => {
  it("strips company:/entity: scope prefixes case-insensitively", () => {
    expect(stripEntityScopePrefix("company:ENT-ASML")).toBe("ENT-ASML");
    expect(stripEntityScopePrefix("Company: ENT-ASML")).toBe("ENT-ASML");
    expect(stripEntityScopePrefix("entity:ENT-ASML")).toBe("ENT-ASML");
  });

  it("leaves bare queries and non-entity scope kinds untouched", () => {
    expect(stripEntityScopePrefix("ENT-ASML")).toBe("ENT-ASML");
    expect(stripEntityScopePrefix("ASML Holding N.V.")).toBe("ASML Holding N.V.");
    expect(stripEntityScopePrefix("component:CMP-EUV")).toBe("component:CMP-EUV");
    expect(stripEntityScopePrefix("edge:EDGE-1")).toBe("edge:EDGE-1");
  });
});

describe("core extraction method inference", () => {
  it("maps every supported extractor_id prefix explicitly", () => {
    expect(EXTRACTOR_ID_PREFIXES).toEqual(["rule.", "llm.", "manual.", "review."]);
    expect(inferExtractionMethod("rule.10k.nvidia-supply-chain")).toBe("rule");
    expect(inferExtractionMethod("llm.sec-supply-chain")).toBe("llm");
    expect(inferExtractionMethod("manual.import-yeti")).toBe("manual");
    expect(inferExtractionMethod("review.supplier-list-row")).toBe("hybrid");
  });

  it("fails fast for unknown extractor_id prefixes", () => {
    expect(() => inferExtractionMethod("rules.10k.typo")).toThrow(/Unknown extractor_id prefix/);
    expect(() => inferExtractionMethod("10k.nvidia-supply-chain")).toThrow(/rule\., llm\., manual\., review\./);
  });
});

describe("core intelligence-network contract constants", () => {
  it("keeps midterm semantic layers explicit and small", () => {
    expect(SEMANTIC_LAYERS).toEqual(["edge", "claim", "observation", "lead", "unknown"]);
  });

  it("defines first-class claim, observation, and lead types", () => {
    expect(CLAIM_TYPES).toContain("SUPPLY_RELATION_CLAIM");
    expect(CLAIM_TYPES).toContain("UNKNOWN_BOUNDARY_CLAIM");
    expect(OBSERVATION_TYPES).toContain("TRADE_FLOW_OBSERVATION");
    expect(OBSERVATION_TYPES).toContain("PORT_ACTIVITY_OBSERVATION");
    expect(LEAD_TYPES).toContain("BOL_SINGLE_RECORD");
    expect(LEAD_TYPES).toContain("UNVERIFIED_FACILITY_SIGNAL");
    expect(ALERT_KINDS).toContain("policy_constraint");
  });

  it("supports chain endpoints beyond company-to-company graph edges", () => {
    expect(CHAIN_ENDPOINT_KINDS).toEqual([
      "company",
      "entity",
      "facility",
      "component",
      "country",
      "port",
      "vessel",
      "carrier",
      "mineral",
      "route",
      "document"
    ]);
  });

  it("creates stable ids for midterm objects", () => {
    expect(createId("CLM")).toMatch(/^CLM-/);
    expect(createId("OBS")).toMatch(/^OBS-/);
    expect(createId("LEAD")).toMatch(/^LEAD-/);
    expect(createId("CHAIN")).toMatch(/^CHAIN-/);
    expect(createId("SEG")).toMatch(/^SEG-/);
    expect(createId("STR")).toMatch(/^STR-/);
  });

  it("derives deterministic ids that are stable per key and distinct across keys", () => {
    const first = createDeterministicId("UNK", ["ENT-ASML", "BUYS_FROM", "carl zeiss smt"]);
    const same = createDeterministicId("UNK", ["ENT-ASML", "BUYS_FROM", "carl zeiss smt"]);
    const different = createDeterministicId("UNK", ["ENT-ASML", "USES_FOUNDRY", "carl zeiss smt"]);

    expect(first).toMatch(/^UNK-[0-9a-f]{32}$/);
    expect(same).toBe(first);
    expect(different).not.toBe(first);
  });

  it("keeps relation strength and freshness methodology explicit", () => {
    expect(EDGE_STRENGTH_KINDS).toEqual(["share", "spend_band", "dependency", "capacity", "qualitative"]);
    expect(EDGE_FRESHNESS_DECAY_MODELS).toEqual(["methodology.v1"]);
    expect(
      calculateEdgeFreshness({
        last_verified_at: "2026-01-01T00:00:00.000Z",
        computed_at: "2026-07-15T00:00:00.000Z"
      })
    ).toEqual({ age_days: 195, freshness_score: 0.85, decay_model: "methodology.v1" });
  });

  it("keeps research target ranking calibration labels explicit", () => {
    expect(RANKING_CALIBRATION_LABELS).toEqual(["useful_target", "wrong_direction", "brand_center_bias", "needs_more_context", "not_relevant"]);
  });
});
