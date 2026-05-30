import { describe, expect, it } from "vitest";
import { isValidCandidateRelation, type CandidateRelation } from "@supplystrata/core";

// 回归：candidate 校验闸门的引用最短长度必须按语言密度判定。英文沿用 30 字下限；中日韩/谚文用 8 字下限，
// 否则像"公司向美光采购存储芯片。"这种语义完整但仅十余字的披露会被静默丢弃，导致 CJK 正文永远产不出边。
function candidate(citeText: string): CandidateRelation {
  return {
    subject_resolve: { surface: "Issuer" },
    object_resolve: { surface: "Micron" },
    relation: "BUYS_FROM",
    cite_text: citeText,
    cite_locator: "test",
    extractor_id: "rule.test",
    raw_evidence_level_hint: 4,
    raw_confidence_hint: 0.8
  };
}

describe("isValidCandidateRelation cite-length floor", () => {
  it("keeps the 30-char floor for Latin-script citations", () => {
    const tooShort = "We buy chips from Micron.";
    const longEnough = "We purchase memory chips directly from Micron Technology.";
    expect(isValidCandidateRelation(candidate(tooShort), tooShort)).toBe(false);
    expect(isValidCandidateRelation(candidate(longEnough), longEnough)).toBe(true);
  });

  it("applies a density-aware 8-char floor to Chinese/Japanese/Korean citations", () => {
    for (const cite of ["公司向美光采购存储芯片。", "当社の主要な仕入先は台湾積体電路です。", "당사는 인텔로부터 부품을 구매합니다."]) {
      expect(isValidCandidateRelation(candidate(cite), cite)).toBe(true);
    }
  });

  it("still rejects citations absent from the document text", () => {
    expect(isValidCandidateRelation(candidate("公司向美光采购存储芯片。"), "完全不同的正文内容。")).toBe(false);
  });
});
