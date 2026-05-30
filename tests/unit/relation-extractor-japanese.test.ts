import { describe, expect, it } from "vitest";
import type { CandidateRelation, NormalizedDocument } from "@supplystrata/core";
import { secOfficialSupplyChainExtractor } from "@supplystrata/relation-extractor-rule";

describe("rule extractor — Japanese (有価証券報告書) profile", () => {
  it("extracts BUYS_FROM from a 仕入先 disclosure even without a named component", async () => {
    const candidates = await extract("当社の主要な仕入先はサムスン電子です。", "ENT-SK-HYNIX");
    const buys = candidates.filter((candidate) => candidate.relation === "BUYS_FROM");
    expect(buys.map((candidate) => candidate.object_resolve.surface)).toContain("Samsung");
  });

  it("extracts BUYS_FROM with a component from a 調達 disclosure", async () => {
    const candidates = await extract("当社はメモリをマイクロンから調達しています。", "ENT-X");
    const micron = candidates.find((candidate) => candidate.object_resolve.surface === "Micron");
    expect(micron?.relation).toBe("BUYS_FROM");
    expect(micron?.component).toBe("memory");
  });

  it("extracts BUYS_FROM from a single-source 特定の仕入先 dependency disclosure", async () => {
    const candidates = await extract("当社は特定の仕入先であるパナソニックに依存しています。", "ENT-X");
    expect(candidates.find((candidate) => candidate.object_resolve.surface === "Panasonic")?.relation).toBe("BUYS_FROM");
  });

  it("extracts SUPPLIES_TO from a 主要な販売先 customer-concentration disclosure", async () => {
    const candidates = await extract("当社の主要な販売先はアップルです。", "ENT-X");
    expect(candidates.find((candidate) => candidate.object_resolve.surface === "Apple")?.relation).toBe("SUPPLIES_TO");
  });

  it("does not invent relations from neutral Japanese prose", async () => {
    const candidates = await extract("当社は東京都に本社を置く半導体材料メーカーです。沿革は次のとおりです。", "ENT-X");
    expect(candidates).toHaveLength(0);
  });

  it("caps evidence hint at the rule level (L5) so source authority still governs the final cap", async () => {
    const candidates = await extract("当社はメモリをマイクロンから調達しています。", "ENT-X");
    expect(candidates[0]?.raw_evidence_level_hint).toBe(5);
  });
});

async function extract(japaneseText: string, subjectEntityId: string): Promise<CandidateRelation[]> {
  const doc = japaneseDocument(japaneseText, subjectEntityId);
  const candidates: CandidateRelation[] = [];
  for await (const candidate of secOfficialSupplyChainExtractor.extract(doc)) candidates.push(candidate);
  return candidates;
}

function japaneseDocument(text: string, subjectEntityId: string): NormalizedDocument {
  return {
    doc_id: "DOC-EDINET-JA",
    source_adapter_id: "edinet",
    document_type: "annual_report",
    language: "ja",
    fetched_at: "2026-06-30T00:00:00.000Z",
    source_url: "https://api.edinet-fsa.go.jp/api/v2/documents/S100AAAA?type=1",
    storage_key: "official-disclosure/edinet/body/S100AAAA/sha.zip",
    bytes_sha256: "sha-ja",
    primary_entity_id: subjectEntityId,
    text,
    chunks: [
      {
        chunk_id: "DOC-EDINET-JA-CHK-0001",
        text,
        locator: "事業の状況",
        language: "ja",
        token_count: Math.ceil(text.length / 2)
      }
    ],
    metadata: { parser_version: "edinet-body-v1" }
  };
}
