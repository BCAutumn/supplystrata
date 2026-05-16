import { describe, expect, it } from "vitest";
import { extractFromSentence } from "@supplystrata/relation-extractor-rule";

describe("NVIDIA rule extractor", () => {
  it("extracts memory supplier candidates from explicit purchase text", () => {
    const candidates = extractFromSentence("We purchase memory from SK hynix, Micron Technology and Samsung for our data center products.", "fixture");
    expect(candidates.map((candidate) => `${candidate.relation}:${candidate.object_resolve.surface}:${candidate.component}`)).toEqual([
      "BUYS_FROM:SK hynix:memory",
      "BUYS_FROM:Micron:memory",
      "BUYS_FROM:Samsung:memory"
    ]);
  });

  it("keeps HBM only when the source text explicitly says HBM", () => {
    const candidates = extractFromSentence(
      "We purchase HBM3e and High Bandwidth Memory products from SK hynix and Samsung for accelerated computing systems.",
      "fixture"
    );
    expect(candidates.map((candidate) => `${candidate.relation}:${candidate.object_resolve.surface}:${candidate.component}`)).toEqual([
      "BUYS_FROM:SK hynix:HBM",
      "BUYS_FROM:Samsung:HBM"
    ]);
  });

  it("keeps DRAM distinct from unspecified memory", () => {
    const candidates = extractFromSentence("We purchase DRAM from Micron Technology for server products.", "fixture");
    expect(candidates.map((candidate) => `${candidate.relation}:${candidate.object_resolve.surface}:${candidate.component}`)).toEqual([
      "BUYS_FROM:Micron:DRAM"
    ]);
  });

  it("does not infer memory supplier edges from generic supplier language", () => {
    const candidates = extractFromSentence("We rely on suppliers including SK hynix for certain products.", "fixture");
    expect(candidates).toHaveLength(0);
  });

  it("extracts foundry candidates from manufacturing context", () => {
    const candidates = extractFromSentence(
      "We utilize foundries such as Taiwan Semiconductor Manufacturing Company Limited and Samsung to manufacture semiconductor wafers.",
      "fixture"
    );
    expect(candidates.map((candidate) => `${candidate.relation}:${candidate.object_resolve.surface}`)).toContain("USES_FOUNDRY:TSMC");
    expect(candidates.map((candidate) => `${candidate.relation}:${candidate.object_resolve.surface}`)).toContain("USES_FOUNDRY:Samsung");
  });

  it("does not treat competitor mentions as suppliers", () => {
    const candidates = extractFromSentence("Our competitors include TSMC and Samsung in some markets.", "fixture");
    expect(candidates).toHaveLength(0);
  });

  it("does not infer Samsung foundry from distant list context", () => {
    const candidates = extractFromSentence(
      "Large cloud services companies design hardware and software for internal platforms, such as Alibaba, Alphabet, Amazon, Samsung, and Microsoft; suppliers of CPUs and companies that incorporate hardware and software for CPUs as part of their solutions.",
      "fixture"
    );
    expect(candidates).toHaveLength(0);
  });

  it("extracts contract manufacturers from assembly and packaging disclosure", () => {
    const candidates = extractFromSentence(
      "We engage with independent subcontractors and contract manufacturers such as Hon Hai Precision Industry Co., Ltd., Wistron Corporation, and Fabrinet to perform assembly, testing and packaging of our final products.",
      "fixture"
    );
    expect(candidates.map((candidate) => `${candidate.relation}:${candidate.object_resolve.surface}:${candidate.component}`)).toEqual([
      "BUYS_FROM:Hon Hai:manufacturing services",
      "BUYS_FROM:Wistron:manufacturing services",
      "BUYS_FROM:Fabrinet:manufacturing services"
    ]);
  });
});
