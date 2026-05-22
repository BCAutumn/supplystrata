import { Buffer } from "node:buffer";
import { type FetchTask, type NormalizedDocument, type RawDocument } from "@supplystrata/core";
import {
  createAdapterContext,
  createRateLimitedSourceAdapter,
  fetchBytesWithTimeout,
  persistRawDocumentSnapshot,
  type AdapterContext,
  type SourceAdapter
} from "@supplystrata/source-adapter-runtime";
import { normalizeTextDocument } from "@supplystrata/source-normalizers";
import { optionalConfigPositiveInteger, requireConfigString, type SourceCheckConfigSchema, type SourceCheckConnector } from "@supplystrata/source-connectors";
import { sourceWorkflowAdapterContextInput } from "./adapter-context.js";
import { runSourceAdapterCheck, type SourceCheckSummary } from "./source-check-runner.js";
import type { DatabaseStore } from "@supplystrata/db";

const TWSE_MOPS_DOCUMENT_KINDS = ["F", "A", "K"] as const;

export type TwseMopsDocumentKind = (typeof TWSE_MOPS_DOCUMENT_KINDS)[number];

export interface TwseMopsElectronicDocumentsInput {
  entityId: string;
  stockCode: string;
  year: number;
  documentKind?: TwseMopsDocumentKind;
  limit?: number;
}

export interface TwseMopsElectronicDocumentEntry {
  stockCode: string;
  periodLabel: string;
  documentCategory?: string;
  documentDetail?: string;
  kind: string;
  filename: string;
  fileSize?: string;
  uploadedAt?: string;
}

const twseMopsAdapterBase: SourceAdapter<TwseMopsElectronicDocumentsInput, Uint8Array> = {
  id: "twse-mops",
  tier: "P1",
  description: "Taiwan MOPS official electronic documents directory monitor",
  tos_url: "https://mops.twse.com.tw/",
  rate_limit: { requests: 1, per_seconds: 2 },
  async *plan(input: TwseMopsElectronicDocumentsInput): AsyncIterable<FetchTask> {
    validateTwseMopsElectronicDocumentsInput(input);
    yield {
      task_id: `twse-mops-${input.stockCode}-${input.year}-${input.documentKind ?? "F"}`,
      url: buildTwseMopsElectronicDocumentsUrl(input),
      params: {
        ...(input.limit === undefined ? {} : { limit: input.limit })
      },
      expected_format: "html",
      hint: {
        entity_id: input.entityId,
        // 第一版只抓 MOPS 電子文件查詢目錄，不下載 PDF、不進行關係抽取。
        document_type: "company_registry",
        period: `${input.year}-12-31`
      }
    };
  },
  async fetch(task: FetchTask, ctx: AdapterContext): Promise<RawDocument<Uint8Array>> {
    const body = await fetchBytesWithTimeout(task.url, {
      userAgent: ctx.userAgent,
      timeoutMs: 12_000,
      sourceLabel: "TWSE MOPS",
      headers: { Accept: "text/html,application/xhtml+xml" }
    });
    const html = decodeTwseMopsHtml(body);
    assertTwseMopsResponse(html, task.url);
    const metadata = taskMetadata(task, html);
    const stockCode = stringMetadataValue(metadata["stock_code"]);
    const year = stringMetadataValue(metadata["source_year"]);
    const documentKind = stringMetadataValue(metadata["document_kind"]);
    if (stockCode === undefined || year === undefined || documentKind === undefined) {
      throw new Error(`TWSE MOPS task metadata is missing required routing keys for ${task.task_id}`);
    }
    return persistRawDocumentSnapshot({
      ctx,
      sourceAdapterId: "twse-mops",
      url: task.url,
      body,
      metadata,
      storageKeyForSha256: (sha256) => `official-disclosure/twse-mops/${stockCode}/${year}/${documentKind}/${sha256}.html`
    });
  },
  async normalize(raw: RawDocument<Uint8Array>): Promise<NormalizedDocument> {
    return normalizeTwseMopsElectronicDocuments(raw);
  }
};

export const twseMopsAdapter = createRateLimitedSourceAdapter(twseMopsAdapterBase);

export const twseMopsElectronicDocumentsSourceCheckConnector: SourceCheckConnector<DatabaseStore, SourceCheckSummary> = {
  source_adapter_id: "twse-mops",
  target_kind: "electronic-documents",
  config_schema: twseMopsConfigSchema(),
  run(store, target, context) {
    return runSourceAdapterCheck(store, {
      adapter: twseMopsAdapter,
      adapterInput: twseMopsElectronicDocumentsInputFromConfig(target.target_config),
      context: createTwseMopsAdapterContext(),
      options: {
        checkTargetId: target.check_target_id,
        failureCausedBy: "source-check.twse-mops",
        ...(context.logger === undefined ? {} : { logger: context.logger })
      }
    });
  }
};

export function createTwseMopsAdapterContext(): AdapterContext {
  return createAdapterContext(sourceWorkflowAdapterContextInput());
}

export function buildTwseMopsElectronicDocumentsUrl(input: TwseMopsElectronicDocumentsInput): string {
  validateTwseMopsElectronicDocumentsInput(input);
  const url = new URL("https://doc.twse.com.tw/server-java/t57sb01");
  url.searchParams.set("step", "1");
  url.searchParams.set("colorchg", "1");
  url.searchParams.set("co_id", input.stockCode);
  url.searchParams.set("year", String(gregorianYearToRocYear(input.year)));
  url.searchParams.set("mtype", input.documentKind ?? "F");
  return url.toString();
}

export function extractTwseMopsElectronicDocumentEntries(raw: RawDocument<Uint8Array>): TwseMopsElectronicDocumentEntry[] {
  const entries = parseTwseMopsElectronicDocumentEntries(decodeTwseMopsHtml(raw.body));
  const limit = numberMetadataValue(raw.metadata["limit"]);
  return limit === undefined ? entries : entries.slice(0, limit);
}

function normalizeTwseMopsElectronicDocuments(raw: RawDocument<Uint8Array>): NormalizedDocument {
  const entries = extractTwseMopsElectronicDocumentEntries(raw);
  const primaryEntityId = stringMetadataValue(raw.metadata["primary_entity_id"]);
  const sourceDate = latestUploadedDate(entries) ?? stringMetadataValue(raw.metadata["source_date"]);
  return normalizeTextDocument({
    raw,
    documentType: "company_registry",
    parserVersion: "twse-mops-electronic-documents-v1",
    language: "zh-Hant",
    text: formatTwseMopsElectronicDocuments(entries, raw.url),
    ...(primaryEntityId === undefined ? {} : { primaryEntityId }),
    ...(sourceDate === undefined ? {} : { sourceDate }),
    extraMetadata: {
      document_count: entries.length,
      stock_code: stringMetadataValue(raw.metadata["stock_code"]) ?? "unknown",
      document_kind: stringMetadataValue(raw.metadata["document_kind"]) ?? "unknown"
    }
  });
}

function formatTwseMopsElectronicDocuments(entries: readonly TwseMopsElectronicDocumentEntry[], sourceUrl: string): string {
  const header = [`twse_mops_document_count: ${entries.length}`, `source_url: ${sourceUrl}`].join("\n");
  if (entries.length === 0) return `${header}\n\nNo TWSE MOPS electronic documents matched this monitor target.`;
  const documents = entries
    .map((item) =>
      [
        `stock_code: ${item.stockCode}`,
        `period_label: ${item.periodLabel}`,
        item.documentCategory === undefined ? undefined : `document_category: ${item.documentCategory}`,
        item.documentDetail === undefined ? undefined : `document_detail: ${item.documentDetail}`,
        `document_kind: ${item.kind}`,
        `filename: ${item.filename}`,
        item.fileSize === undefined ? undefined : `file_size: ${item.fileSize}`,
        item.uploadedAt === undefined ? undefined : `uploaded_at: ${item.uploadedAt}`,
        `document_query_url: ${twseMopsDocumentQueryUrl(item)}`
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n")
    )
    .join("\n\n");
  return `${header}\n\n${documents}`;
}

function taskMetadata(task: FetchTask, html: string): Record<string, unknown> {
  const entries = parseTwseMopsElectronicDocumentEntries(html);
  const sourceYear = String(rocYearToGregorianYear(Number.parseInt(firstSearchParam(task.url, "year") ?? "0", 10)));
  const limit = numberTaskParamValue(task.params?.["limit"]);
  return {
    task_id: task.task_id,
    document_type: "company_registry",
    primary_entity_id: task.hint?.entity_id,
    source_date: latestUploadedDate(entries) ?? `${sourceYear}-12-31`,
    source_year: sourceYear,
    stock_code: firstSearchParam(task.url, "co_id"),
    roc_year: firstSearchParam(task.url, "year"),
    document_kind: firstSearchParam(task.url, "mtype"),
    document_count: entries.length,
    ...(limit === undefined ? {} : { limit })
  };
}

export function twseMopsElectronicDocumentsInputFromConfig(config: Record<string, unknown>): TwseMopsElectronicDocumentsInput {
  const label = "TWSE MOPS source check target";
  const year = optionalConfigPositiveInteger(config, "year", label);
  if (year === undefined || year < 2000 || year > 2100) throw new Error(`${label} year must be a supported disclosure year`);
  const documentKind = optionalTwseMopsDocumentKind(config, label);
  const limit = optionalConfigPositiveInteger(config, "limit", label);
  return {
    entityId: requireConfigString(config, "entity_id", label),
    stockCode: requireTwseStockCode(config, label),
    year,
    ...(documentKind === undefined ? {} : { documentKind }),
    ...(limit === undefined ? {} : { limit })
  };
}

function twseMopsConfigSchema(): SourceCheckConfigSchema {
  return {
    fields: [
      { key: "stock_code", type: "string", required: true, description: "TWSE/MOPS company stock code, e.g. 2317." },
      { key: "entity_id", type: "string", required: true, description: "Primary SupplyStrata entity id for the filer." },
      { key: "year", type: "positive_integer", required: true, description: "Gregorian disclosure year; adapter converts it to Taiwan ROC year." },
      {
        key: "document_kind",
        type: "string",
        required: false,
        description: "MOPS electronic document kind. F is annual report/shareholder meeting materials.",
        allowed_values: TWSE_MOPS_DOCUMENT_KINDS
      },
      { key: "limit", type: "positive_integer", required: false, description: "Maximum directory rows to keep." }
    ]
  };
}

function validateTwseMopsElectronicDocumentsInput(input: TwseMopsElectronicDocumentsInput): void {
  if (!/^\d{4,6}$/.test(input.stockCode)) throw new Error(`TWSE MOPS stockCode must be a numeric stock code: ${input.stockCode}`);
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) throw new Error(`TWSE MOPS year is outside supported range: ${input.year}`);
  if (input.entityId.trim().length === 0) throw new Error("TWSE MOPS entityId must not be empty");
  if (input.documentKind !== undefined && !isTwseMopsDocumentKind(input.documentKind)) {
    throw new Error(`Unsupported TWSE MOPS document kind: ${input.documentKind}`);
  }
  if (input.limit !== undefined && (input.limit < 1 || input.limit > 200)) throw new Error(`TWSE MOPS limit must be between 1 and 200: ${input.limit}`);
}

function parseTwseMopsElectronicDocumentEntries(html: string): TwseMopsElectronicDocumentEntry[] {
  const entries: TwseMopsElectronicDocumentEntry[] = [];
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const rowHtml = rowMatch[1] ?? "";
    const file = parseReadfileLink(rowHtml);
    if (file === undefined) continue;
    const cells = extractTableCells(rowHtml);
    const stockCode = cells[0];
    const periodLabel = cells[1];
    if (stockCode === undefined || periodLabel === undefined) continue;
    entries.push({
      stockCode,
      periodLabel,
      ...(cells[2] === undefined ? {} : { documentCategory: cells[2] }),
      ...(cells[5] === undefined ? {} : { documentDetail: cells[5] }),
      kind: file.kind,
      filename: file.filename,
      ...(cells[8] === undefined ? {} : { fileSize: cells[8] }),
      ...(cells[9] === undefined ? {} : { uploadedAt: normalizeMopsDateTime(cells[9]) })
    });
  }
  return entries;
}

function decodeTwseMopsHtml(bytes: Uint8Array): string {
  const head = Buffer.from(bytes.slice(0, 512)).toString("ascii").toLowerCase();
  const encoding = head.includes("charset=utf-8") || head.includes('charset="utf-8"') ? "utf-8" : "big5";
  return new TextDecoder(encoding).decode(bytes);
}

function assertTwseMopsResponse(html: string, sourceUrl: string): void {
  if (html.includes("FOR SECURITY REASONS") || html.includes("安全性考量")) throw new Error(`TWSE MOPS security page returned for ${sourceUrl}`);
}

function parseReadfileLink(rowHtml: string): { kind: string; filename: string } | undefined {
  const match = /readfile2?\("([^"]+)","[^"]+","([^"]+)"\)/.exec(rowHtml);
  if (match === null) return undefined;
  const kind = match[1];
  const filename = match[2];
  if (kind === undefined || filename === undefined) return undefined;
  return { kind, filename };
}

function extractTableCells(rowHtml: string): string[] {
  const cells: string[] = [];
  const cellPattern = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
  let cellMatch: RegExpExecArray | null;
  while ((cellMatch = cellPattern.exec(rowHtml)) !== null) cells.push(cleanHtmlText(cellMatch[1] ?? ""));
  return cells;
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

function requireTwseStockCode(config: Record<string, unknown>, label: string): string {
  const stockCode = requireConfigString(config, "stock_code", label);
  if (!/^\d{4,6}$/.test(stockCode)) throw new Error(`${label} stock_code must be a numeric TWSE/MOPS code`);
  return stockCode;
}

function optionalTwseMopsDocumentKind(config: Record<string, unknown>, label: string): TwseMopsDocumentKind | undefined {
  const value = config["document_kind"];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !isTwseMopsDocumentKind(value)) {
    throw new Error(`${label} document_kind must be one of: ${TWSE_MOPS_DOCUMENT_KINDS.join(", ")}`);
  }
  return value;
}

function isTwseMopsDocumentKind(value: string): value is TwseMopsDocumentKind {
  return TWSE_MOPS_DOCUMENT_KINDS.some((item) => item === value);
}

function gregorianYearToRocYear(year: number): number {
  return year - 1911;
}

function rocYearToGregorianYear(year: number): number {
  return year + 1911;
}

function firstSearchParam(url: string, key: string): string | undefined {
  return new URL(url).searchParams.get(key) ?? undefined;
}

function latestUploadedDate(entries: readonly TwseMopsElectronicDocumentEntry[]): string | undefined {
  const latest = entries
    .map((item) => item.uploadedAt)
    .filter((value): value is string => value !== undefined)
    .sort()
    .at(-1);
  return latest;
}

function normalizeMopsDateTime(value: string): string {
  const match = /^(\d{2,3})\/(\d{2})\/(\d{2})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/.exec(value);
  if (match === null) return value;
  const year = rocYearToGregorianYear(Number.parseInt(match[1] ?? "0", 10));
  const month = match[2] ?? "01";
  const day = match[3] ?? "01";
  const hour = match[4];
  const minute = match[5];
  const second = match[6];
  if (hour === undefined || minute === undefined || second === undefined) return `${year}-${month}-${day}`;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`;
}

function twseMopsDocumentQueryUrl(item: TwseMopsElectronicDocumentEntry): string {
  const url = new URL("https://doc.twse.com.tw/server-java/t57sb01");
  url.searchParams.set("step", "9");
  url.searchParams.set("kind", item.kind);
  url.searchParams.set("co_id", item.stockCode);
  url.searchParams.set("filename", item.filename);
  return url.toString();
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
