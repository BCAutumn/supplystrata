import { describe, expect, it } from "vitest";
import {
  candidateSentences,
  chunkText,
  countExactOccurrences,
  findNearbySnippet,
  findSentenceMatching,
  normalizeText,
  sentenceWindows,
  sentenceWindowsWithOffsets
} from "@supplystrata/parsers-text";

describe("text parser", () => {
  it("normalizes whitespace and unicode consistently", () => {
    expect(normalizeText("Ａ  \t B\r\n\r\n\r\n  C")).toBe("A B\n\nC");
  });

  it("creates stable chunks with locators", () => {
    const chunks = chunkText("First paragraph.\n\nSecond paragraph with enough text.", "DOC-test", 20);
    expect(chunks.length).toBe(2);
    expect(chunks[0]?.chunk_id).toBe("DOC-test-CHK-0001");
    expect(chunks[0]?.locator).toBe("chunk 1");
  });

  it("splits sentence windows conservatively", () => {
    const sentences = sentenceWindows("NVIDIA Corporation\n\nWe purchase memory from SK hynix, Micron Technology and Samsung. Competitors include others.");
    expect(sentences).toContain("We purchase memory from SK hynix, Micron Technology and Samsung.");
    expect(sentences).not.toContain("NVIDIA Corporation\n\nWe purchase memory from SK hynix, Micron Technology and Samsung.");
  });

  it("segments CJK sentences on 。 with a density-aware minimum length", () => {
    const sentences = sentenceWindows("当社の主要な仕入先はサムスン電子です。事業等のリスクとして特定の供給業者への依存があります。");
    expect(sentences).toContain("当社の主要な仕入先はサムスン電子です。");
    expect(sentences).toContain("事業等のリスクとして特定の供給業者への依存があります。");
    // 不能把整段当成一句（否则远距离词会假性共现，污染抽取精度）。
    expect(sentences.length).toBeGreaterThanOrEqual(2);
  });

  it("segments Korean sentences on ASCII period + Hangul boundary with a density-aware minimum length", () => {
    const sentences = sentenceWindows("당사의 주요 공급업체는 삼성전자입니다. 특정 공급업체에 대한 의존도가 높습니다.");
    expect(sentences).toContain("당사의 주요 공급업체는 삼성전자입니다.");
    expect(sentences).toContain("특정 공급업체에 대한 의존도가 높습니다.");
    expect(sentences.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps English segmentation behavior unchanged when CJK is absent", () => {
    const sentences = sentenceWindows("We purchase memory from Micron. We use TSMC foundry services. ok");
    expect(sentences).toContain("We purchase memory from Micron.");
    expect(sentences).toContain("We use TSMC foundry services. ok");
    expect(sentences).not.toContain("ok");
  });

  it("returns sentence windows with stable offsets for citation-aware extractors", () => {
    const text = "Header.\n\nPrefix. NVIDIA purchases memory from SK hynix and Micron. Suffix.";
    const windows = sentenceWindowsWithOffsets(text);
    const memory = windows.find((window) => window.sentence.includes("SK hynix"));
    expect(memory).toEqual({
      sentence: "NVIDIA purchases memory from SK hynix and Micron.",
      start: "Header.\n\nPrefix. ".length,
      end: "Header.\n\nPrefix. NVIDIA purchases memory from SK hynix and Micron.".length
    });
  });

  it("finds shared candidate sentences and fallback snippets", () => {
    const text = [
      "Short.",
      "Micron describes HBM demand from AI data center customers with enough context for a signal.",
      "The rest of this paragraph keeps the extracted snippet long enough for review."
    ].join(" ");
    expect(candidateSentences(text, { minLength: 40, maxLength: 120 })).toContain(
      "Micron describes HBM demand from AI data center customers with enough context for a signal."
    );
    expect(findSentenceMatching(text, [/HBM/i, /AI data center/i], { minLength: 40, maxLength: 120 })).toContain("HBM demand");
    expect(findNearbySnippet("prefix ".repeat(20) + "HBM demand from AI customers " + "suffix ".repeat(20), [/HBM/i, /AI/i])).toContain("HBM demand");
  });

  it("counts exact citation occurrences", () => {
    expect(countExactOccurrences("A citation. A citation.", "A citation.")).toBe(2);
    expect(countExactOccurrences("A citation.", "")).toBe(0);
  });
});
