import { Buffer } from "node:buffer";
import { type FetchTask, type NormalizedDocument, type RawDocument } from "@supplystrata/core";
import { normalizeTextDocument } from "@supplystrata/source-normalizers";

export interface HkexNewsTitleSearchInput {
  entityId: string;
  stockCode: string;
  fromDate: string;
  toDate: string;
  limit?: number;
}

export interface HkexNewsAnnouncementEntry {
  stockCode: string;
  title: string;
  releaseTime?: string;
  category?: string;
  documentUrl?: string;
}

export function buildHkexNewsTitleSearchUrl(input: HkexNewsTitleSearchInput): string {
  validateHkexNewsTitleSearchInput(input);
  const url = new URL("https://www1.hkexnews.hk/search/titlesearch.xhtml");
  url.searchParams.set("lang", "en");
  url.searchParams.set("market", "SEHK");
  url.searchParams.set("stockCode", input.stockCode);
  url.searchParams.set("fromDate", input.fromDate);
  url.searchParams.set("toDate", input.toDate);
  return url.toString();
}

export function extractHkexNewsAnnouncementEntries(raw: RawDocument<Uint8Array>): HkexNewsAnnouncementEntry[] {
  const entries = parseHkexNewsAnnouncementEntries(decodeHkexNewsHtml(raw.body));
  const limit = numberMetadataValue(raw.metadata["limit"]);
  return limit === undefined ? entries : entries.slice(0, limit);
}

export function normalizeHkexNewsTitleSearch(raw: RawDocument<Uint8Array>): NormalizedDocument {
  const entries = extractHkexNewsAnnouncementEntries(raw);
  const primaryEntityId = stringMetadataValue(raw.metadata["primary_entity_id"]);
  const sourceDate = latestReleaseDate(entries) ?? stringMetadataValue(raw.metadata["to_date"]);
  return normalizeTextDocument({
    raw,
    documentType: "company_registry",
    parserVersion: "hkex-news-title-search-v1",
    language: "en",
    text: formatHkexNewsAnnouncements(entries, raw.url),
    ...(primaryEntityId === undefined ? {} : { primaryEntityId }),
    ...(sourceDate === undefined ? {} : { sourceDate }),
    extraMetadata: {
      announcement_count: entries.length,
      stock_code: stringMetadataValue(raw.metadata["stock_code"]) ?? "unknown"
    }
  });
}

export function hkexNewsTitleSearchTaskMetadata(task: FetchTask, html: string): Record<string, unknown> {
  const entries = parseHkexNewsAnnouncementEntries(html);
  const limit = numberTaskParamValue(task.params?.["limit"]);
  return {
    task_id: task.task_id,
    document_type: "company_registry",
    primary_entity_id: task.hint?.entity_id,
    source_date: latestReleaseDate(entries) ?? firstSearchParam(task.url, "toDate"),
    stock_code: firstSearchParam(task.url, "stockCode"),
    from_date: firstSearchParam(task.url, "fromDate"),
    to_date: firstSearchParam(task.url, "toDate"),
    announcement_count: entries.length,
    ...(limit === undefined ? {} : { limit })
  };
}

export function validateHkexNewsTitleSearchInput(input: HkexNewsTitleSearchInput): void {
  if (!/^\d{1,5}$/.test(input.stockCode)) throw new Error(`HKEXnews stockCode must be a numeric stock code: ${input.stockCode}`);
  if (input.entityId.trim().length === 0) throw new Error("HKEXnews entityId must not be empty");
  requireIsoDate(input.fromDate, "HKEXnews fromDate");
  requireIsoDate(input.toDate, "HKEXnews toDate");
  if (input.fromDate > input.toDate) throw new Error("HKEXnews fromDate must be on or before toDate");
  if (input.limit !== undefined && (input.limit < 1 || input.limit > 200)) throw new Error(`HKEXnews limit must be between 1 and 200: ${input.limit}`);
}

export function decodeHkexNewsHtml(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

function formatHkexNewsAnnouncements(entries: readonly HkexNewsAnnouncementEntry[], sourceUrl: string): string {
  const header = [`hkex_news_announcement_count: ${entries.length}`, `source_url: ${sourceUrl}`].join("\n");
  if (entries.length === 0) return `${header}\n\nNo HKEXnews title-search announcements matched this monitor target.`;
  const documents = entries
    .map((item) =>
      [
        `stock_code: ${item.stockCode}`,
        item.releaseTime === undefined ? undefined : `release_time: ${item.releaseTime}`,
        item.category === undefined ? undefined : `category: ${item.category}`,
        `title: ${item.title}`,
        item.documentUrl === undefined ? undefined : `document_url: ${item.documentUrl}`
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n")
    )
    .join("\n\n");
  return `${header}\n\n${documents}`;
}

function parseHkexNewsAnnouncementEntries(html: string): HkexNewsAnnouncementEntry[] {
  const entries: HkexNewsAnnouncementEntry[] = [];
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const rowHtml = rowMatch[1] ?? "";
    const documentUrl = absoluteHkexUrl(firstHref(rowHtml));
    if (documentUrl === undefined) continue;
    const cells = extractTableCells(rowHtml);
    const rowText = cleanHtmlText(rowHtml);
    const stockCode = firstStockCode(cells) ?? firstStockCode([rowText]);
    const title = firstNonEmpty([anchorText(rowHtml), cells.at(-1)]);
    if (stockCode === undefined || title === undefined) continue;
    const releaseTime = firstReleaseTime(cells);
    const category = categoryFromCells(cells, title);
    entries.push({
      stockCode,
      title,
      ...(releaseTime === undefined ? {} : { releaseTime }),
      ...(category === undefined ? {} : { category }),
      documentUrl
    });
  }
  return entries;
}

function extractTableCells(rowHtml: string): string[] {
  const cells: string[] = [];
  const cellPattern = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
  let cellMatch: RegExpExecArray | null;
  while ((cellMatch = cellPattern.exec(rowHtml)) !== null) cells.push(cleanHtmlText(cellMatch[1] ?? ""));
  return cells;
}

function firstHref(rowHtml: string): string | undefined {
  const match = /href=["']([^"']+)["']/i.exec(rowHtml);
  return match?.[1];
}

function anchorText(rowHtml: string): string | undefined {
  const match = /<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(rowHtml);
  if (match?.[1] === undefined) return undefined;
  return nonEmpty(cleanHtmlText(match[1]));
}

function absoluteHkexUrl(href: string | undefined): string | undefined {
  if (href === undefined || href.trim().length === 0) return undefined;
  return new URL(href, "https://www1.hkexnews.hk").toString();
}

function firstStockCode(values: readonly string[]): string | undefined {
  for (const value of values) {
    if (normalizeReleaseTime(value) !== undefined) continue;
    const match = /\b(\d{1,5})\b/.exec(value);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

function firstReleaseTime(values: readonly string[]): string | undefined {
  for (const value of values) {
    const normalized = normalizeReleaseTime(value);
    if (normalized !== undefined) return normalized;
  }
  return undefined;
}

function normalizeReleaseTime(value: string): string | undefined {
  const match = /(\d{4})[-/](\d{2})[-/](\d{2})(?:\s+(\d{2}):(\d{2}))?/.exec(value);
  if (match === null) return undefined;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  if (match[4] === undefined || match[5] === undefined) return date;
  return `${date}T${match[4]}:${match[5]}:00+08:00`;
}

function categoryFromCells(cells: readonly string[], title: string): string | undefined {
  const category = cells.find((cell) => cell.length > 0 && cell !== title && firstReleaseTime([cell]) === undefined && firstStockCode([cell]) === undefined);
  return category;
}

function latestReleaseDate(entries: readonly HkexNewsAnnouncementEntry[]): string | undefined {
  return entries
    .map((item) => item.releaseTime?.slice(0, 10))
    .filter((value): value is string => value !== undefined)
    .sort()
    .at(-1);
}

function firstNonEmpty(values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    const cleaned = nonEmpty(value);
    if (cleaned !== undefined) return cleaned;
  }
  return undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function cleanHtmlText(value: string): string {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function firstSearchParam(url: string, key: string): string | undefined {
  return new URL(url).searchParams.get(key) ?? undefined;
}

function requireIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must use YYYY-MM-DD format`);
}

function stringMetadataValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberMetadataValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberTaskParamValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}
