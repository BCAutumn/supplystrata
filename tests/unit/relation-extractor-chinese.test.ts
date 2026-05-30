import { describe, expect, it } from "vitest";
import type { CandidateRelation, NormalizedDocument } from "@supplystrata/core";
import { secOfficialSupplyChainExtractor } from "@supplystrata/relation-extractor-rule";

describe("rule extractor — Chinese (年度报告) profile", () => {
  it("extracts BUYS_FROM from a 主要供应商 disclosure even without a named component", async () => {
    const candidates = await extract("公司的主要供应商为台积电。", "ENT-X");
    expect(candidates.find((candidate) => candidate.object_resolve.surface === "TSMC")?.relation).toBe("BUYS_FROM");
  });

  it("extracts BUYS_FROM with a component from a 采购 disclosure", async () => {
    const candidates = await extract("公司向美光采购存储芯片。", "ENT-X");
    const micron = candidates.find((candidate) => candidate.object_resolve.surface === "Micron");
    expect(micron?.relation).toBe("BUYS_FROM");
    expect(micron?.component).toBe("memory");
  });

  it("extracts BUYS_FROM from a single-source 依赖特定供应商 disclosure", async () => {
    const candidates = await extract("公司依赖单一供应商宁德时代。", "ENT-X");
    expect(candidates.find((candidate) => candidate.object_resolve.surface === "CATL")?.relation).toBe("BUYS_FROM");
  });

  it("extracts SUPPLIES_TO from a 前五大客户 customer-concentration disclosure", async () => {
    const candidates = await extract("公司的前五大客户包括苹果。", "ENT-X");
    expect(candidates.find((candidate) => candidate.object_resolve.surface === "Apple")?.relation).toBe("SUPPLIES_TO");
  });

  it("does not invent relations from neutral Chinese prose", async () => {
    const candidates = await extract("公司是一家位于深圳的半导体材料制造企业。公司历史沿革如下。", "ENT-X");
    expect(candidates).toHaveLength(0);
  });
});

async function extract(chineseText: string, subjectEntityId: string): Promise<CandidateRelation[]> {
  const doc = chineseDocument(chineseText, subjectEntityId);
  const candidates: CandidateRelation[] = [];
  for await (const candidate of secOfficialSupplyChainExtractor.extract(doc)) candidates.push(candidate);
  return candidates;
}

function chineseDocument(text: string, subjectEntityId: string): NormalizedDocument {
  return {
    doc_id: "DOC-CNINFO-ZH",
    source_adapter_id: "cninfo",
    document_type: "annual_report",
    language: "zh",
    fetched_at: "2026-04-30T00:00:00.000Z",
    source_url: "http://static.cninfo.com.cn/finalpage/2024-04-02/1219712345.PDF",
    storage_key: "official-disclosure/cninfo/600519/2024/sha.pdf",
    bytes_sha256: "sha-zh",
    primary_entity_id: subjectEntityId,
    text,
    chunks: [
      {
        chunk_id: "DOC-CNINFO-ZH-CHK-0001",
        text,
        locator: "第四节 经营情况讨论与分析",
        language: "zh",
        token_count: Math.ceil(text.length / 2)
      }
    ],
    metadata: { parser_version: "pdf-pdftotext-v1" }
  };
}
