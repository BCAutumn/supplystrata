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

// 中日韩文字范围（含假名/汉字/全角半角片假名/谚文音节与字母）。CJK 信息密度高，分句与最短长度都要单独处理。
const CJK_CHAR = /[\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\uff66-\uff9f]/;

// 句末终止符：中日句号 。 经 NFKC 仍保留（！？ 已被规整成 ASCII !?）。先按 。 切，再在每段里按英文/韩文规则切。
// 韩文用 ASCII 句点（…습니다.），下一句以谚文开头，故 lookahead 含谚文音节区；英文行为与原实现完全一致
// （英文文本里既无 。 也不会出现谚文）。
function splitIntoSentences(text: string): string[] {
  return text.split(/(?<=。)/).flatMap((part) => part.split(/(?<=[.!?])\s+(?=[A-Z0-9"“\uac00-\ud7af])/));
}

// CJK 句子用更低字符阈值：英文 30 字符的下限会把"主要な仕入先は信越化学である。"（约 16 字）整句滤掉。
function isSentenceLongEnough(sentence: string, minLength: number, cjkMinLength: number): boolean {
  return CJK_CHAR.test(sentence) ? sentence.length >= cjkMinLength : sentence.length >= minLength;
}

export function sentenceWindows(text: string): string[] {
  return normalizeText(text)
    .split(/\n{2,}/)
    .flatMap((paragraph) => splitIntoSentences(paragraph))
    .map((sentence) => sentence.trim())
    .filter((sentence) => isSentenceLongEnough(sentence, 30, 8));
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
  const cjkMinLength = Math.min(minLength, 8);
  return splitIntoSentences(normalizeInlineText(text))
    .map((sentence) => sentence.trim())
    .filter((sentence) => isSentenceLongEnough(sentence, minLength, cjkMinLength) && sentence.length <= maxLength);
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
