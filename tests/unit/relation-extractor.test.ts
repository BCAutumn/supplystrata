import { describe, expect, it } from "vitest";
import type { CandidateRelation, NormalizedDocument } from "@supplystrata/core";
import { extractFromSentence, secOfficialSupplyChainExtractor } from "@supplystrata/relation-extractor-rule";

describe("SEC official supply-chain rule extractor", () => {
  it("extracts memory supplier candidates from explicit purchase text", () => {
    const candidates = extractFixtureSentence("We purchase memory from SK hynix, Micron Technology and Samsung for our data center products.");
    expect(
      candidates.map(
        (candidate) =>
          `${candidate.relation}:${candidate.object_resolve.surface}:${candidate.component}:${candidate.component_id}:${candidate.component_specificity}`
      )
    ).toEqual([
      "BUYS_FROM:SK hynix:memory:COMP-MEMORY:unspecified",
      "BUYS_FROM:Micron:memory:COMP-MEMORY:unspecified",
      "BUYS_FROM:Samsung:memory:COMP-MEMORY:unspecified"
    ]);
  });

  it("keeps HBM only when the source text explicitly says HBM", () => {
    const candidates = extractFixtureSentence(
      "We purchase HBM3e and High Bandwidth Memory products from SK hynix and Samsung for accelerated computing systems."
    );
    expect(
      candidates.map(
        (candidate) =>
          `${candidate.relation}:${candidate.object_resolve.surface}:${candidate.component}:${candidate.component_id}:${candidate.component_specificity}`
      )
    ).toEqual(["BUYS_FROM:SK hynix:HBM:COMP-HBM:explicit", "BUYS_FROM:Samsung:HBM:COMP-HBM:explicit"]);
  });

  it("keeps DRAM distinct from unspecified memory", () => {
    const candidates = extractFixtureSentence("We purchase DRAM from Micron Technology for server products.");
    expect(
      candidates.map(
        (candidate) =>
          `${candidate.relation}:${candidate.object_resolve.surface}:${candidate.component}:${candidate.component_id}:${candidate.component_specificity}`
      )
    ).toEqual(["BUYS_FROM:Micron:DRAM:COMP-DRAM:explicit"]);
  });

  it("does not infer memory supplier edges from generic supplier language", () => {
    const candidates = extractFixtureSentence("We rely on suppliers including SK hynix for certain products.");
    expect(candidates).toHaveLength(0);
  });

  it("extracts foundry candidates from manufacturing context", () => {
    const candidates = extractFixtureSentence(
      "We utilize foundries such as Taiwan Semiconductor Manufacturing Company Limited and Samsung to manufacture semiconductor wafers."
    );
    expect(candidates.map((candidate) => `${candidate.relation}:${candidate.object_resolve.surface}`)).toContain("USES_FOUNDRY:TSMC");
    expect(candidates.map((candidate) => `${candidate.relation}:${candidate.object_resolve.surface}`)).toContain("USES_FOUNDRY:Samsung");
  });

  it("does not treat competitor mentions as suppliers", () => {
    const candidates = extractFixtureSentence("Our competitors include TSMC and Samsung in some markets.");
    expect(candidates).toHaveLength(0);
  });

  it("does not infer Samsung foundry from distant list context", () => {
    const candidates = extractFixtureSentence(
      "Large cloud services companies design hardware and software for internal platforms, such as Alibaba, Alphabet, Amazon, Samsung, and Microsoft; suppliers of CPUs and companies that incorporate hardware and software for CPUs as part of their solutions."
    );
    expect(candidates).toHaveLength(0);
  });

  it("extracts contract manufacturers from assembly and packaging disclosure", () => {
    const candidates = extractFixtureSentence(
      "We engage with independent subcontractors and contract manufacturers such as Hon Hai Precision Industry Co., Ltd., Wistron Corporation, and Fabrinet to perform assembly, testing and packaging of our final products."
    );
    expect(
      candidates.map(
        (candidate) =>
          `${candidate.relation}:${candidate.object_resolve.surface}:${candidate.component}:${candidate.component_id}:${candidate.component_specificity}`
      )
    ).toEqual([
      "BUYS_FROM:Hon Hai:manufacturing services:COMP-MANUFACTURING-SERVICES:explicit",
      "BUYS_FROM:Wistron:manufacturing services:COMP-MANUFACTURING-SERVICES:explicit",
      "BUYS_FROM:Fabrinet:manufacturing services:COMP-MANUFACTURING-SERVICES:explicit"
    ]);
  });

  it("extracts named major customer disclosures without relying on NVIDIA-specific logic", () => {
    const candidates = extractFixtureSentence("Sales to Microsoft accounted for 18% of our total revenue from GPU products during fiscal 2026.", {
      subjectSurface: "ENT-BROADCOM"
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      subject_resolve: { surface: "ENT-BROADCOM" },
      object_resolve: { surface: "Microsoft" },
      relation: "SUPPLIES_TO",
      component: "GPU",
      component_id: "COMP-GPU",
      component_specificity: "explicit",
      extractor_id: "rule.sec.official-supply-chain"
    });
  });

  it("keeps anonymous customer concentration out of company edges", () => {
    const candidates = extractFixtureSentence("One customer accounted for 21% of total revenue in fiscal 2026.");

    expect(candidates).toHaveLength(0);
  });

  it("does not turn generic customer lists into SUPPLIES_TO edges", () => {
    const candidates = extractFixtureSentence("Our cloud customers include Microsoft, Amazon, Alphabet, Meta and Oracle.");

    expect(candidates).toHaveLength(0);
  });

  it("extracts named purchase obligations and capacity reservations as supplier edges", () => {
    const candidates = extractFixtureSentence("We have long-term wafer supply agreements and capacity reservations with TSMC for semiconductor wafers.", {
      subjectSurface: "ENT-AMD"
    });

    expect(candidates.map((candidate) => `${candidate.relation}:${candidate.object_resolve.surface}:${candidate.component_id}`)).toEqual([
      "USES_FOUNDRY:TSMC:COMP-WAFER",
      "BUYS_FROM:TSMC:COMP-WAFER"
    ]);
  });

  it("extracts named single-source supplier risk but ignores anonymous supplier risk", () => {
    const named = extractFixtureSentence("We depend on ASML as a sole supplier for lithography systems used in advanced semiconductor manufacturing.", {
      subjectSurface: "ENT-INTEL"
    });
    const anonymous = extractFixtureSentence("We depend on a limited number of suppliers for critical components.", { subjectSurface: "ENT-INTEL" });

    expect(named).toHaveLength(1);
    expect(named[0]).toMatchObject({
      relation: "BUYS_FROM",
      object_resolve: { surface: "ASML" }
    });
    expect(anonymous).toHaveLength(0);
  });

  it("runs against non-NVIDIA SEC disclosures using the document primary entity", async () => {
    const doc: NormalizedDocument = {
      doc_id: "DOC-AMD-FIXTURE",
      source_adapter_id: "sec-edgar",
      document_type: "10-K",
      primary_entity_id: "ENT-AMD",
      language: "en",
      fetched_at: "2026-01-01T00:00:00.000Z",
      source_url: "https://www.sec.gov/Archives/fixture",
      storage_key: "fixtures/sec/amd-10k.html",
      bytes_sha256: "fixture",
      text: "We utilize foundries such as Taiwan Semiconductor Manufacturing Company Limited to manufacture semiconductor wafers.",
      chunks: [
        {
          chunk_id: "CHK-AMD-1",
          text: "We utilize foundries such as Taiwan Semiconductor Manufacturing Company Limited to manufacture semiconductor wafers.",
          locator: "fixture#amd"
        }
      ],
      metadata: {}
    };

    const candidates = await collect(secOfficialSupplyChainExtractor.extract(doc));

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      subject_resolve: { surface: "ENT-AMD" },
      object_resolve: { surface: "TSMC" },
      relation: "USES_FOUNDRY",
      extractor_id: "rule.sec.official-supply-chain",
      source_location: {
        chunk_id: "CHK-AMD-1",
        chunk_locator: "fixture#amd",
        cite_start_char: 0,
        cite_end_char: doc.chunks[0]?.text.length
      }
    });
  });

  it("does not run the SEC rule pack against non-SEC source documents", async () => {
    const doc: NormalizedDocument = {
      doc_id: "DOC-IR-FIXTURE",
      source_adapter_id: "company-ir",
      document_type: "annual_report",
      primary_entity_id: "ENT-AMD",
      language: "en",
      fetched_at: "2026-01-01T00:00:00.000Z",
      source_url: "https://example.com/ir",
      storage_key: "fixtures/ir/amd.html",
      bytes_sha256: "fixture",
      text: "We utilize foundries such as Taiwan Semiconductor Manufacturing Company Limited to manufacture semiconductor wafers.",
      chunks: [
        {
          chunk_id: "CHK-IR-1",
          text: "We utilize foundries such as Taiwan Semiconductor Manufacturing Company Limited to manufacture semiconductor wafers.",
          locator: "fixture#ir"
        }
      ],
      metadata: {}
    };

    const candidates = await collect(secOfficialSupplyChainExtractor.extract(doc));

    expect(candidates).toHaveLength(0);
  });

  it("treats the offline SEC fixture adapter as the same rule domain", async () => {
    const doc: NormalizedDocument = {
      doc_id: "DOC-NVIDIA-FIXTURE",
      source_adapter_id: "sec-edgar-fixture",
      document_type: "10-K",
      primary_entity_id: "ENT-NVIDIA",
      language: "en",
      fetched_at: "2026-01-01T00:00:00.000Z",
      source_url: "fixture://sec-edgar/nvidia-10k.html",
      storage_key: "fixtures/sec/nvidia-10k.html",
      bytes_sha256: "fixture",
      text: "We purchase memory from SK hynix.",
      chunks: [
        {
          chunk_id: "CHK-NVIDIA-1",
          text: "We purchase memory from SK hynix.",
          locator: "fixture#nvidia"
        }
      ],
      metadata: {}
    };

    const candidates = await collect(secOfficialSupplyChainExtractor.extract(doc));

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      subject_resolve: { surface: "ENT-NVIDIA" },
      object_resolve: { surface: "SK hynix" }
    });
  });
});

function extractFixtureSentence(sentence: string, options: Partial<Parameters<typeof extractFromSentence>[2]> = {}): CandidateRelation[] {
  return extractFromSentence(sentence, "fixture", { subjectSurface: "ENT-NVIDIA", ...options });
}

async function collect(iterable: AsyncIterable<CandidateRelation>): Promise<CandidateRelation[]> {
  const items: CandidateRelation[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}
