import { describe, expect, it } from "vitest";
import { EXTRACTOR_ID_PREFIXES, inferExtractionMethod } from "@supplystrata/core";

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
