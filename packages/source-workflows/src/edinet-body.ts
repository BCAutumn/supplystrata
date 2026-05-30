import { Buffer } from "node:buffer";
import { unzipSync } from "fflate";
import { type FetchTask, type NormalizedDocument, type RawDocument } from "@supplystrata/core";
import {
  fetchBytesWithTimeout,
  persistRawDocumentSnapshot,
  requireAdapterCredential,
  urlWithCredentialQueryParam,
  type AdapterContext
} from "@supplystrata/source-adapter-runtime";
import { extractReadableHtmlText, normalizeTextDocument } from "@supplystrata/source-normalizers";
import {
  assertEdinetResponseStatus,
  filterEdinetDocumentEntries,
  parseEdinetDocumentListPayload,
  validateEdinetDailyFilingsInput,
  type EdinetDailyFilingsInput,
  type EdinetDocumentEntry
} from "./edinet-document-list.js";

// EDINET v2 正文本体下载：type=1 返回"提出本文書＋監査報告書"的 ZIP，内含 iXBRL（PublicDoc/*.htm），
// 这是有価証券報告書叙述正文（事業の内容 / 事業等のリスク / 主要な設備 等）的载体。
// 注意：type=1 同样可能在 HTTP 200 下返回 JSON `{"metadata":{"status":"404"}}`（该文档不支持本体下载），
// 必须按内容判别，不能只看 HTTP 状态。
const EDINET_BODY_DOWNLOAD_TYPE = 1;

// 默认只跟读叙述型定期报告：120=有価証券報告書, 140=四半期報告書, 160=半期報告書。
// 调用方可通过 docTypeCodes 覆盖。其它类型（大量持股报告等）不在正文抽取范围内。
export const EDINET_DEFAULT_BODY_DOC_TYPE_CODES = ["120", "140", "160"] as const;

const PUBLIC_DOC_HTML = /PublicDoc\/.*\.html?$/i;
const ANY_HTML = /\.html?$/i;
const ZIP_MAGIC = [0x50, 0x4b]; // "PK"

export interface EdinetCompanyFilingsInput extends EdinetDailyFilingsInput {
  limit?: number;
}

export function buildEdinetDocumentBodyUrl(docId: string, apiKey: string): string {
  const url = new URL(`https://api.edinet-fsa.go.jp/api/v2/documents/${encodeURIComponent(docId)}`);
  url.searchParams.set("type", String(EDINET_BODY_DOWNLOAD_TYPE));
  return urlWithCredentialQueryParam(url.toString(), apiKey, "Subscription-Key", "EDINET");
}

// 在 daily 列表里选出本次要抓正文的文档：先按 code/类型过滤，再要求 xbrlFlag=1（type=1 ZIP 才有正文）。
export function selectEdinetBodyEntries(payload: ReturnType<typeof parseEdinetDocumentListPayload>, input: EdinetCompanyFilingsInput): EdinetDocumentEntry[] {
  const docTypeCodes = input.docTypeCodes ?? [...EDINET_DEFAULT_BODY_DOC_TYPE_CODES];
  const filtered = filterEdinetDocumentEntries(payload.results, {
    ...(input.edinetCodes === undefined ? {} : { edinetCodes: input.edinetCodes }),
    ...(input.secCodes === undefined ? {} : { secCodes: input.secCodes }),
    docTypeCodes
  });
  const withXbrl = filtered.filter((entry) => entry.xbrlFlag === "1");
  const limit = input.limit === undefined ? withXbrl.length : Math.max(0, input.limit);
  return withXbrl.slice(0, limit);
}

export function edinetBodyTask(entry: EdinetDocumentEntry, apiKey: string, input: EdinetCompanyFilingsInput): FetchTask {
  return {
    task_id: `edinet-body-${entry.docId}`,
    url: buildEdinetDocumentBodyUrl(entry.docId, apiKey),
    expected_format: "xbrl",
    params: {
      doc_id: entry.docId,
      ...(entry.edinetCode === undefined ? {} : { edinet_code: entry.edinetCode }),
      ...(entry.secCode === undefined ? {} : { sec_code: entry.secCode }),
      ...(entry.docTypeCode === undefined ? {} : { doc_type_code: entry.docTypeCode }),
      ...(input.entityId === undefined ? {} : { entity_id: input.entityId }),
      ...(input.componentId === undefined ? {} : { component_id: input.componentId }),
      ...(input.scopeKind === undefined ? {} : { scope_kind: input.scopeKind }),
      ...(input.scopeId === undefined ? {} : { scope_id: input.scopeId })
    },
    hint: {
      ...(input.entityId === undefined ? {} : { entity_id: input.entityId }),
      // 正文进入与 SEC 10-K/20-F 同一套规则抽取（按文档类型判定资格）。日文正文当前由英文规则抽取
      // 得到 0 边但仍可入库、可观测、可 diff；日文 pattern 上线后即可产边。
      document_type: "annual_report",
      ...(entry.periodEnd === undefined ? {} : { period: entry.periodEnd })
    }
  };
}

export async function* planEdinetBodyTasks(input: EdinetCompanyFilingsInput, ctx: AdapterContext): AsyncGenerator<FetchTask> {
  validateEdinetDailyFilingsInput(input);
  const apiKey = requireAdapterCredential(ctx, "EDINET_API_KEY", "EDINET");
  const listUrl = new URL("https://api.edinet-fsa.go.jp/api/v2/documents.json");
  listUrl.searchParams.set("date", input.date);
  listUrl.searchParams.set("type", "2");
  const listBytes = await fetchBytesWithTimeout(urlWithCredentialQueryParam(listUrl.toString(), apiKey, "Subscription-Key", "EDINET"), {
    userAgent: ctx.userAgent,
    timeoutMs: 12_000,
    sourceLabel: "EDINET",
    headers: { Accept: "application/json" }
  });
  const payload = parseEdinetDocumentListPayload(listBytes);
  assertEdinetResponseStatus(payload, listUrl.toString());
  // 日期型 API：某天没有目标公司的定期报告时，正文计划为空是正常情况，不抛错（避免每日扫描噪声）。
  for (const entry of selectEdinetBodyEntries(payload, input)) {
    yield edinetBodyTask(entry, apiKey, input);
  }
}

export async function fetchEdinetBody(task: FetchTask, ctx: AdapterContext): Promise<RawDocument<Uint8Array>> {
  const body = await fetchBytesWithTimeout(task.url, {
    userAgent: ctx.userAgent,
    timeoutMs: 30_000,
    sourceLabel: "EDINET body",
    headers: { Accept: "application/octet-stream" }
  });
  assertEdinetBodyIsZip(body, task);
  const docId = stringParam(task.params, "doc_id") ?? "unknown";
  return persistRawDocumentSnapshot({
    ctx,
    sourceAdapterId: "edinet",
    url: task.url,
    body,
    metadata: edinetBodyTaskMetadata(task),
    storageKeyForSha256: (sha256) => `official-disclosure/edinet/body/${docId}/${sha256}.zip`
  });
}

export function normalizeEdinetBodyDocument(raw: RawDocument<Uint8Array>): NormalizedDocument {
  if (!looksLikeZip(raw.body)) throw new Error(`EDINET body for ${stringMetadata(raw.metadata, "edinet_doc_id") ?? raw.doc_id} is not a ZIP archive`);
  const files = unzipSync(raw.body);
  const text = extractEdinetNarrativeText(files);
  if (text.trim().length === 0) throw new Error(`EDINET body ${raw.doc_id} contains no readable iXBRL narrative (PublicDoc/*.htm)`);
  const primaryEntityId = stringMetadata(raw.metadata, "primary_entity_id");
  const sourceDate = stringMetadata(raw.metadata, "source_date");
  return normalizeTextDocument({
    raw,
    documentType: "annual_report",
    parserVersion: "edinet-body-v1",
    text,
    language: "ja",
    ...(primaryEntityId === undefined ? {} : { primaryEntityId }),
    ...(sourceDate === undefined ? {} : { sourceDate })
  });
}

// 从 ZIP 里抽出叙述正文：优先 PublicDoc 下的 iXBRL HTM（监査報告書、表紙等也可能是 htm，但 PublicDoc 是正文主体）。
// 没有 PublicDoc 时退回任意 htm。按文件名排序保证多文件拼接的确定性。
function extractEdinetNarrativeText(files: Record<string, Uint8Array>): string {
  const names = Object.keys(files).sort((a, b) => a.localeCompare(b));
  const publicDoc = names.filter((name) => PUBLIC_DOC_HTML.test(name));
  const selected = publicDoc.length > 0 ? publicDoc : names.filter((name) => ANY_HTML.test(name));
  const parts: string[] = [];
  for (const name of selected) {
    const bytes = files[name];
    if (bytes === undefined) continue;
    const part = extractReadableHtmlText(bytes).trim();
    if (part.length > 0) parts.push(part);
  }
  return parts.join("\n\n");
}

function edinetBodyTaskMetadata(task: FetchTask): Record<string, unknown> {
  const docId = stringParam(task.params, "doc_id");
  if (docId === undefined) throw new Error(`EDINET body task ${task.task_id} is missing doc_id`);
  return {
    task_id: task.task_id,
    document_type: "annual_report",
    edinet_doc_id: docId,
    ...(task.hint?.entity_id === undefined ? {} : { primary_entity_id: task.hint.entity_id }),
    ...(task.hint?.period === undefined ? {} : { source_date: task.hint.period }),
    ...(stringParam(task.params, "edinet_code") === undefined ? {} : { edinet_code: stringParam(task.params, "edinet_code") }),
    ...(stringParam(task.params, "sec_code") === undefined ? {} : { sec_code: stringParam(task.params, "sec_code") }),
    ...(stringParam(task.params, "doc_type_code") === undefined ? {} : { edinet_doc_type_code: stringParam(task.params, "doc_type_code") }),
    ...(stringParam(task.params, "component_id") === undefined ? {} : { component_id: stringParam(task.params, "component_id") }),
    ...(stringParam(task.params, "scope_kind") === undefined ? {} : { scope_kind: stringParam(task.params, "scope_kind") }),
    ...(stringParam(task.params, "scope_id") === undefined ? {} : { scope_id: stringParam(task.params, "scope_id") })
  };
}

function assertEdinetBodyIsZip(body: Uint8Array, task: FetchTask): void {
  if (looksLikeZip(body)) return;
  // EDINET 在"该文档无本体下载"时会在 200 下返回 JSON 错误体而不是 ZIP。
  const text = Buffer.from(body.subarray(0, 256)).toString("utf8").trim();
  if (text.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(Buffer.from(body).toString("utf8"));
      assertEdinetResponseStatus(parseEdinetErrorEnvelope(parsed), task.url);
    } catch (error) {
      throw new Error(`EDINET body download for ${task.task_id} returned a non-ZIP error response: ${(error as Error).message}`);
    }
  }
  throw new Error(`EDINET body download for ${task.task_id} did not return a ZIP archive`);
}

function parseEdinetErrorEnvelope(parsed: unknown): { status: string; message: string; results: [] } {
  if (typeof parsed === "object" && parsed !== null && "metadata" in parsed) {
    const metadata = (parsed as { metadata?: unknown }).metadata;
    if (typeof metadata === "object" && metadata !== null) {
      const status = (metadata as { status?: unknown }).status;
      const message = (metadata as { message?: unknown }).message;
      return { status: typeof status === "string" ? status : "unknown", message: typeof message === "string" ? message : "EDINET error", results: [] };
    }
  }
  return { status: "unknown", message: "EDINET error", results: [] };
}

function looksLikeZip(body: Uint8Array): boolean {
  return body.length >= 2 && body[0] === ZIP_MAGIC[0] && body[1] === ZIP_MAGIC[1];
}

function stringParam(params: FetchTask["params"], key: string): string | undefined {
  if (params === undefined) return undefined;
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

function stringMetadata(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" ? value : undefined;
}
