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
    .flatMap((paragraph) => paragraph.split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 30);
}

export interface SentenceWindow {
  sentence: string;
  start: number;
  end: number;
}

export interface CandidateSentenceOptions {
  minLength?: number;
  maxLength?: number;
}

export interface NearbySnippetOptions {
  beforeChars?: number;
  afterChars?: number;
  minLength?: number;
}

export function sentenceWindowsWithOffsets(text: string): SentenceWindow[] {
  const windows: SentenceWindow[] = [];
  let cursor = 0;
  for (const sentence of sentenceWindows(text)) {
    const start = text.indexOf(sentence, cursor);
    if (start < 0) continue;
    const end = start + sentence.length;
    windows.push({ sentence, start, end });
    cursor = end;
  }
  return windows;
}

export function candidateSentences(text: string, options: CandidateSentenceOptions = {}): string[] {
  const minLength = options.minLength ?? 40;
  const maxLength = options.maxLength ?? 1200;
  return normalizeInlineText(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= minLength && sentence.length <= maxLength);
}

export function findSentenceMatching(text: string, patterns: readonly RegExp[], options: CandidateSentenceOptions = {}): string | undefined {
  return candidateSentences(text, options).find((sentence) => patterns.every((pattern) => pattern.test(sentence)));
}

export function findNearbySnippet(text: string, patterns: readonly RegExp[], options: NearbySnippetOptions = {}): string | undefined {
  const normalized = normalizeInlineText(text);
  const beforeChars = options.beforeChars ?? 260;
  const afterChars = options.afterChars ?? 520;
  const minLength = options.minLength ?? 40;
  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    if (match === null) continue;
    const start = Math.max(0, match.index - beforeChars);
    const end = Math.min(normalized.length, match.index + afterChars);
    const snippet = normalized.slice(start, end).trim();
    if (snippet.length >= minLength && patterns.every((item) => item.test(snippet))) return snippet;
  }
  return undefined;
}

export function countExactOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let cursor = 0;
  while (cursor < haystack.length) {
    const index = haystack.indexOf(needle, cursor);
    if (index === -1) return count;
    count += 1;
    cursor = index + needle.length;
  }
  return count;
}

function normalizeInlineText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
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
