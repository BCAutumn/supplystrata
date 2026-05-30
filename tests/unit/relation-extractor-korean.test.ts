import { describe, expect, it } from "vitest";
import type { CandidateRelation, NormalizedDocument } from "@supplystrata/core";
import { secOfficialSupplyChainExtractor } from "@supplystrata/relation-extractor-rule";

describe("rule extractor — Korean (사업보고서) profile", () => {
  it("extracts BUYS_FROM from a 구매 disclosure with a component", async () => {
    const candidates = await extract("당사는 메모리반도체를 마이크론으로부터 구매하고 있습니다.", "ENT-X");
    const micron = candidates.find((candidate) => candidate.object_resolve.surface === "Micron");
    expect(micron?.relation).toBe("BUYS_FROM");
    expect(micron?.component).toBe("memory");
  });

  it("extracts BUYS_FROM from a 주요 공급업체 disclosure even without a named component", async () => {
    const candidates = await extract("당사의 주요 공급업체는 삼성전자입니다.", "ENT-X");
    expect(candidates.find((candidate) => candidate.object_resolve.surface === "Samsung")?.relation).toBe("BUYS_FROM");
  });

  it("extracts BUYS_FROM from a single-source 특정 공급업체 의존 disclosure", async () => {
    const candidates = await extract("당사는 특정 공급업체인 마이크론에 대한 의존도가 높습니다.", "ENT-X");
    expect(candidates.find((candidate) => candidate.object_resolve.surface === "Micron")?.relation).toBe("BUYS_FROM");
  });

  it("extracts SUPPLIES_TO from a 주요 고객 customer-concentration disclosure", async () => {
    const candidates = await extract("당사의 주요 고객은 애플입니다.", "ENT-X");
    expect(candidates.find((candidate) => candidate.object_resolve.surface === "Apple")?.relation).toBe("SUPPLIES_TO");
  });

  it("does not invent relations from neutral Korean prose", async () => {
    const candidates = await extract("당사는 경기도에 위치한 반도체 소재 제조 기업입니다. 연혁은 다음과 같습니다.", "ENT-X");
    expect(candidates).toHaveLength(0);
  });
});

async function extract(koreanText: string, subjectEntityId: string): Promise<CandidateRelation[]> {
  const doc = koreanDocument(koreanText, subjectEntityId);
  const candidates: CandidateRelation[] = [];
  for await (const candidate of secOfficialSupplyChainExtractor.extract(doc)) candidates.push(candidate);
  return candidates;
}

function koreanDocument(text: string, subjectEntityId: string): NormalizedDocument {
  return {
    doc_id: "DOC-DART-KO",
    source_adapter_id: "dart-kr",
    document_type: "annual_report",
    language: "ko",
    fetched_at: "2024-03-12T00:00:00.000Z",
    source_url: "https://opendart.fss.or.kr/api/document.xml?rcept_no=20240312000736",
    storage_key: "official-disclosure/dart-kr/body/20240312000736/sha.zip",
    bytes_sha256: "sha-ko",
    primary_entity_id: subjectEntityId,
    text,
    chunks: [
      {
        chunk_id: "DOC-DART-KO-CHK-0001",
        text,
        locator: "II. 사업의 내용",
        language: "ko",
        token_count: Math.ceil(text.length / 2)
      }
    ],
    metadata: { parser_version: "dart-kr-body-v1" }
  };
}
