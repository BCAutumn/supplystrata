import { describe, expect, it } from "vitest";
import { chunkText, normalizeText, sentenceWindows } from "@supplystrata/parsers-text";

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
});
