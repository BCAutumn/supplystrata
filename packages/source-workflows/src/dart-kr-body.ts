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
  assertDartKrResponseStatus,
  parseDartKrDisclosureListPayload,
  type DartKrDisclosureEntry,
  type DartKrFinalReportsOnly
} from "./dart-kr-disclosure-list.js";

// OpenDART 正文本体下载：document.xml?rcept_no=… 返回原始提出文档（韩文）的 ZIP，内含 XML/HTML 正文
// （사업보고서：사업의 내용 / 주요 제품 및 원재료 / 매출 등），是韩文叙述正文的载体。
// 取列表用韩文主域名（report_nm 为韩文，便于过滤 사업보고서），与 document.xml 同域。
// 注意：document.xml 出错时在 HTTP 200 下返回 XML 错误体 <result><status>013</status>…，而非 ZIP，须按内容判别。
const DART_HOST = "https://opendart.fss.or.kr";
const ANNUAL_REPORT_NAME = /(사업보고서|annual\s*report|business\s*report)/i;
const BODY_FILE = /\.(?:xml|html?)$/i;
const ZIP_MAGIC = [0x50, 0x4b]; // "PK"

export interface DartKrCompanyBodyInput {
  entityId: string;
  corpCode: string;
  year: number;
  finalReportsOnly?: DartKrFinalReportsOnly;
  limit?: number;
  componentId?: string;
  scopeKind?: "company" | "component";
  scopeId?: string;
}

export function validateDartKrCompanyBodyInput(input: DartKrCompanyBodyInput): void {
  if (!/^\d{8}$/.test(input.corpCode)) throw new Error(`OpenDART corpCode must be 8 digits: ${input.corpCode}`);
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) throw new Error(`OpenDART year is outside supported range: ${input.year}`);
  if (input.entityId.trim().length === 0) throw new Error("OpenDART entityId must not be empty");
  if (input.limit !== undefined && (input.limit < 1 || input.limit > 100)) throw new Error(`OpenDART limit must be between 1 and 100: ${input.limit}`);
  if (input.scopeKind !== undefined && input.scopeKind !== "company" && input.scopeKind !== "component") {
    throw new Error(`Unsupported OpenDART scope kind: ${input.scopeKind}`);
  }
}

export function buildDartKrBodyListUrl(input: DartKrCompanyBodyInput, apiKey: string): string {
  validateDartKrCompanyBodyInput(input);
  const url = new URL(`${DART_HOST}/api/list.json`);
  url.searchParams.set("corp_code", input.corpCode);
  url.searchParams.set("bgn_de", `${input.year}0101`);
  url.searchParams.set("end_de", `${input.year}1231`);
  // pblntf_ty=A：정기공시（含 사업보고서/반기/분기），再按报告名过滤出 사업보고서 正文。
  url.searchParams.set("pblntf_ty", "A");
  url.searchParams.set("sort", "date");
  url.searchParams.set("sort_mth", "desc");
  url.searchParams.set("page_no", "1");
  url.searchParams.set("page_count", String(clampLimit(input.limit)));
  url.searchParams.set("last_reprt_at", input.finalReportsOnly ?? "Y");
  return urlWithCredentialQueryParam(url.toString(), apiKey, "crtfc_key", "OpenDART");
}

export function buildDartKrDocumentUrl(receiptNumber: string, apiKey: string): string {
  if (!/^\d{14}$/.test(receiptNumber)) throw new Error(`OpenDART rcept_no must be 14 digits: ${receiptNumber}`);
  const url = new URL(`${DART_HOST}/api/document.xml`);
  url.searchParams.set("rcept_no", receiptNumber);
  return urlWithCredentialQueryParam(url.toString(), apiKey, "crtfc_key", "OpenDART");
}

export function isDartKrAnnualReportName(reportName: string): boolean {
  // 사업보고서 = 年度报告。排除半期/분기/요약/정정(更正) 等非年度正文件。
  if (!ANNUAL_REPORT_NAME.test(reportName)) return false;
  return !/(반기|분기|요약|정정|첨부정정|기재정정|반기보고서|분기보고서|half|quarter)/i.test(reportName);
}

export function selectDartKrAnnualReports(entries: readonly DartKrDisclosureEntry[], input: DartKrCompanyBodyInput): DartKrDisclosureEntry[] {
  const matched = entries.filter((entry) => /^\d{14}$/.test(entry.receiptNumber) && isDartKrAnnualReportName(entry.reportName));
  const limit = input.limit === undefined ? matched.length : Math.max(0, input.limit);
  return matched.slice(0, limit);
}

export function dartKrBodyTask(entry: DartKrDisclosureEntry, apiKey: string, input: DartKrCompanyBodyInput): FetchTask {
  return {
    task_id: `dart-kr-body-${entry.receiptNumber}`,
    url: buildDartKrDocumentUrl(entry.receiptNumber, apiKey),
    expected_format: "xbrl",
    params: {
      rcept_no: entry.receiptNumber,
      report_name: entry.reportName,
      ...(entry.corpCode === undefined ? {} : { corp_code: entry.corpCode }),
      ...(input.entityId === undefined ? {} : { entity_id: input.entityId }),
      ...(input.componentId === undefined ? {} : { component_id: input.componentId }),
      ...(input.scopeKind === undefined ? {} : { scope_kind: input.scopeKind }),
      ...(input.scopeId === undefined ? {} : { scope_id: input.scopeId })
    },
    hint: {
      ...(input.entityId === undefined ? {} : { entity_id: input.entityId }),
      // 正文进入与 SEC/EDINET/cninfo 同一套规则抽取（按文档类型判定资格），由 ko profile 产边。
      document_type: "annual_report",
      ...(entry.receiptDate === undefined ? {} : { period: entry.receiptDate })
    }
  };
}

export async function* planDartKrBodyTasks(input: DartKrCompanyBodyInput, ctx: AdapterContext): AsyncGenerator<FetchTask> {
  validateDartKrCompanyBodyInput(input);
  const apiKey = requireAdapterCredential(ctx, "OPENDART_API_KEY", "OpenDART");
  const listUrl = buildDartKrBodyListUrl(input, apiKey);
  const listBytes = await fetchBytesWithTimeout(listUrl, {
    userAgent: ctx.userAgent,
    timeoutMs: 12_000,
    sourceLabel: "OpenDART body list",
    headers: { Accept: "application/json" }
  });
  const payload = parseDartKrDisclosureListPayload(listBytes);
  assertDartKrResponseStatus(payload, listUrl);
  // 该年度没有 사업보고서 时计划为空属正常（status 013），不抛错。
  for (const entry of selectDartKrAnnualReports(payload.list, input)) {
    yield dartKrBodyTask(entry, apiKey, input);
  }
}

export async function fetchDartKrBody(task: FetchTask, ctx: AdapterContext): Promise<RawDocument<Uint8Array>> {
  const body = await fetchBytesWithTimeout(task.url, {
    userAgent: ctx.userAgent,
    timeoutMs: 30_000,
    sourceLabel: "OpenDART body",
    headers: { Accept: "application/octet-stream,application/zip,*/*" }
  });
  assertDartKrBodyIsZip(body, task);
  const rceptNo = stringParam(task.params, "rcept_no") ?? "unknown";
  return persistRawDocumentSnapshot({
    ctx,
    sourceAdapterId: "dart-kr",
    url: task.url,
    body,
    metadata: dartKrBodyTaskMetadata(task),
    storageKeyForSha256: (sha256) => `official-disclosure/dart-kr/body/${rceptNo}/${sha256}.zip`
  });
}

export function normalizeDartKrBodyDocument(raw: RawDocument<Uint8Array>): NormalizedDocument {
  if (!looksLikeZip(raw.body)) throw new Error(`OpenDART body for ${stringMetadata(raw.metadata, "dart_rcept_no") ?? raw.doc_id} is not a ZIP archive`);
  const files = unzipSync(raw.body);
  const text = extractDartKrNarrativeText(files);
  if (text.trim().length === 0) throw new Error(`OpenDART body ${raw.doc_id} contains no readable XML/HTML narrative`);
  const primaryEntityId = stringMetadata(raw.metadata, "primary_entity_id");
  const sourceDate = stringMetadata(raw.metadata, "source_date");
  return normalizeTextDocument({
    raw,
    documentType: "annual_report",
    parserVersion: "dart-kr-body-v1",
    text,
    language: "ko",
    ...(primaryEntityId === undefined ? {} : { primaryEntityId }),
    ...(sourceDate === undefined ? {} : { sourceDate })
  });
}

// 从 ZIP 抽取韩文叙述正文：取所有 .xml/.htm 文件按名排序拼接。DART 文档为 SGML 风格大写标签，
// cheerio 可作 tag soup 解析并取文本。注：当前按 UTF-8 解码，近年 사업보고서 多为 UTF-8；个别旧档若为
// EUC-KR 会乱码 → ko pattern 不匹配产 0 边（降级，不写脏边）。
function extractDartKrNarrativeText(files: Record<string, Uint8Array>): string {
  const names = Object.keys(files)
    .filter((name) => BODY_FILE.test(name))
    .sort((a, b) => a.localeCompare(b));
  const parts: string[] = [];
  for (const name of names) {
    const bytes = files[name];
    if (bytes === undefined) continue;
    const part = extractReadableHtmlText(bytes).trim();
    if (part.length > 0) parts.push(part);
  }
  return parts.join("\n\n");
}

export function dartKrBodyTaskMetadata(task: FetchTask): Record<string, unknown> {
  const rceptNo = stringParam(task.params, "rcept_no");
  if (rceptNo === undefined) throw new Error(`OpenDART body task ${task.task_id} is missing rcept_no`);
  return {
    task_id: task.task_id,
    document_type: "annual_report",
    dart_rcept_no: rceptNo,
    ...(stringParam(task.params, "report_name") === undefined ? {} : { dart_report_name: stringParam(task.params, "report_name") }),
    ...(stringParam(task.params, "corp_code") === undefined ? {} : { corp_code: stringParam(task.params, "corp_code") }),
    ...(task.hint?.entity_id === undefined ? {} : { primary_entity_id: task.hint.entity_id }),
    ...(task.hint?.period === undefined ? {} : { source_date: task.hint.period }),
    ...(stringParam(task.params, "component_id") === undefined ? {} : { component_id: stringParam(task.params, "component_id") }),
    ...(stringParam(task.params, "scope_kind") === undefined ? {} : { scope_kind: stringParam(task.params, "scope_kind") }),
    ...(stringParam(task.params, "scope_id") === undefined ? {} : { scope_id: stringParam(task.params, "scope_id") })
  };
}

function assertDartKrBodyIsZip(body: Uint8Array, task: FetchTask): void {
  if (looksLikeZip(body)) return;
  // document.xml 在"无数据/错误"时返回 XML 错误体 <result><status>013</status><message>…</message></result>。
  const text = Buffer.from(body.subarray(0, 512)).toString("utf8");
  const status = text.match(/<status>\s*(\d+)\s*</)?.[1];
  if (status !== undefined) {
    const message = text.match(/<message>\s*([^<]*)</)?.[1]?.trim() ?? "OpenDART error";
    // 013 = 조회된 데이타가 없습니다（无数据），按"空属正常"由调用方处理；其它 status 视为错误。
    if (status === "000" || status === "013") {
      throw new Error(`OpenDART document download for ${task.task_id} returned status ${status} (${message}) instead of a ZIP body`);
    }
    throw new Error(`OpenDART document API error ${status} for ${task.task_id}: ${message}`);
  }
  throw new Error(`OpenDART document download for ${task.task_id} did not return a ZIP archive`);
}

function clampLimit(value: number | undefined): number {
  if (value === undefined) return 5;
  return Math.max(1, Math.min(100, value));
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
