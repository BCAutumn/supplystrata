import { createId, type DocumentChunk } from "@supplystrata/core";

export function normalizeText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/\uFEFF/g, "")
    .replace(/[ ]*\n[ ]*/g, "\n")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function chunkText(text: string, docId: string, targetChars = 6000): DocumentChunk[] {
  const normalized = normalizeText(text);
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const chunks: DocumentChunk[] = [];
  let buffer: string[] = [];
  let bufferLength = 0;
  let chunkIndex = 0;

  for (const paragraph of paragraphs) {
    if (bufferLength + paragraph.length > targetChars && buffer.length > 0) {
      chunks.push(buildChunk(docId, chunkIndex, buffer.join("\n\n")));
      chunkIndex += 1;
      buffer = [];
      bufferLength = 0;
    }
    buffer.push(paragraph);
    bufferLength += paragraph.length;
  }

  if (buffer.length > 0) {
    chunks.push(buildChunk(docId, chunkIndex, buffer.join("\n\n")));
  }

  return chunks;
}

export function sentenceWindows(text: string): string[] {
  return normalizeText(text)
    .split(/\n{2,}/)
    .flatMap((paragraph) => paragraph.split(/(?<=[.!?])\s+(?=[A-Z"“])/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 30);
}

function buildChunk(docId: string, index: number, text: string): DocumentChunk {
  return {
    chunk_id: `${docId}-CHK-${String(index + 1).padStart(4, "0")}`,
    text,
    locator: `chunk ${index + 1}`,
    language: "en",
    token_count: estimateTokens(text)
  };
}

export function createDetachedChunk(text: string, locator: string): DocumentChunk {
  return {
    chunk_id: createId("CHK"),
    text: normalizeText(text),
    locator,
    language: "en",
    token_count: estimateTokens(text)
  };
}
