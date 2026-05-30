import { Buffer } from "node:buffer";
import { type FetchTask, type NormalizedDocument, type RawDocument } from "@supplystrata/core";
import { parsePdf } from "@supplystrata/parsers-pdf";

// 巨潮资讯网（cninfo）是中国证监会指定的沪深官方信息披露平台。公告查询接口：
//   POST http://www.cninfo.com.cn/new/hisAnnouncement/query  (application/x-www-form-urlencoded)
// 年度报告分类固定为 category_ndbg_szsh；正文为 PDF，下载地址 = static 域名 + 返回的 adjunctUrl。
// 中国年报是 PDF（不像 EDINET 的 iXBRL），因此正文归一化走 pdftotext → language=zh。
const CNINFO_QUERY_URL = "http://www.cninfo.com.cn/new/hisAnnouncement/query";
const CNINFO_STATIC_BASE = "http://static.cninfo.com.cn/";
export const CNINFO_ANNUAL_REPORT_CATEGORY = "category_ndbg_szsh";

// 巨潮维护的沪深上市公司清单（code → 真实 orgId）。约定式 gssh/gssz+0+code 只对部分主板成立，
// 通过该映射拿到准确 orgId 可避免查询为空。沪市用 sse_stock.json，深市用 szse_stock.json。
const CNINFO_STOCK_LIST_URLS: Record<CninfoExchange, string> = {
  sse: "http://www.cninfo.com.cn/new/data/sse_stock.json",
  szse: "http://www.cninfo.com.cn/new/data/szse_stock.json"
};

export type CninfoExchange = "sse" | "szse";

export interface CninfoCompanyFilingsInput {
  stockCode: string;
  exchange?: CninfoExchange;
  orgId?: string;
  entityId?: string;
  componentId?: string;
  scopeKind?: "company" | "component";
  scopeId?: string;
  // 公告时间范围 YYYY-MM-DD~YYYY-MM-DD。缺省时不限制（由 limit 控制条数）。
  seDate?: string;
  limit?: number;
}

export interface CninfoAnnouncement {
  announcementId?: string;
  announcementTitle: string;
  adjunctUrl: string;
  secCode?: string;
  secName?: string;
  orgId?: string;
  announcementTimeMs?: number;
}

export interface CninfoAnnouncementsResponse {
  announcements: CninfoAnnouncement[];
  totalRecordNum?: number;
}

export function cninfoExchangeFromStockCode(stockCode: string): CninfoExchange {
  if (/^(6|9)/.test(stockCode)) return "sse";
  if (/^(0|2|3)/.test(stockCode)) return "szse";
  throw new Error(`Cannot derive cninfo exchange from stock code ${stockCode} (only Shanghai/Shenzhen supported)`);
}

export function cninfoColumn(exchange: CninfoExchange): string {
  return exchange === "sse" ? "sse" : "szse";
}

// orgId 优先用调用方/实体身份提供的真实值；缺省时退回 gssh/gssz + 0 + 6 位代码的约定式构造（沪深主板多数可用）。
// 构造错误时查询返回空（与 EDINET 同样按"空属正常"处理），不会写出脏文档。
export function cninfoOrgId(stockCode: string, exchange: CninfoExchange, explicitOrgId?: string): string {
  if (explicitOrgId !== undefined && explicitOrgId.trim().length > 0) return explicitOrgId.trim();
  const prefix = exchange === "sse" ? "gssh" : "gssz";
  return `${prefix}0${stockCode}`;
}

export function buildCninfoQueryUrl(): string {
  return CNINFO_QUERY_URL;
}

export function buildCninfoStockListUrl(exchange: CninfoExchange): string {
  return CNINFO_STOCK_LIST_URLS[exchange];
}

// 解析巨潮上市公司清单 JSON（{ stockList: [{ code, orgId, zwjc }] }）成 code → orgId 映射。
export function parseCninfoStockList(bytes: Uint8Array): Map<string, string> {
  const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  const root = requireRecord(parsed, "cninfo stock list response");
  const rawList = root["stockList"];
  const map = new Map<string, string>();
  if (!Array.isArray(rawList)) return map;
  for (const item of rawList) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const code = optionalString(row["code"]);
    const orgId = optionalString(row["orgId"]) ?? optionalString(row["orgid"]);
    if (code !== undefined && orgId !== undefined) map.set(code, orgId);
  }
  return map;
}

export function findCninfoOrgId(stockList: Map<string, string>, stockCode: string): string | undefined {
  return stockList.get(stockCode);
}

export function buildCninfoQueryBody(input: CninfoCompanyFilingsInput, pageNum = 1, pageSize = 30): string {
  validateCninfoInput(input);
  const exchange = input.exchange ?? cninfoExchangeFromStockCode(input.stockCode);
  const orgId = cninfoOrgId(input.stockCode, exchange, input.orgId);
  const params = new URLSearchParams({
    pageNum: String(pageNum),
    pageSize: String(pageSize),
    column: cninfoColumn(exchange),
    tabName: "fulltext",
    plate: "",
    stock: `${input.stockCode},${orgId}`,
    searchkey: "",
    secid: "",
    category: CNINFO_ANNUAL_REPORT_CATEGORY,
    trade: "",
    seDate: input.seDate ?? "",
    sortName: "",
    sortType: "",
    isHLtitle: "true"
  });
  return params.toString();
}

export function parseCninfoAnnouncementsPayload(bytes: Uint8Array): CninfoAnnouncementsResponse {
  const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  const root = requireRecord(parsed, "cninfo announcements response");
  const rawList = root["announcements"];
  // 空结果时 cninfo 返回 announcements: null —— 归一为空数组。
  const announcements = Array.isArray(rawList) ? rawList.map((item, index) => parseAnnouncement(item, index)).filter((item): item is CninfoAnnouncement => item !== undefined) : [];
  const totalRecordNum = optionalNumber(root["totalRecordNum"]) ?? optionalNumber(root["totalAnnouncement"]);
  return { announcements, ...(totalRecordNum === undefined ? {} : { totalRecordNum }) };
}

// 只保留中文年度报告正文：标题含"年度报告"，排除摘要 / 已取消 / 英文版 / 更正提示等非正文件。
export function selectCninfoAnnualReports(announcements: readonly CninfoAnnouncement[], input: CninfoCompanyFilingsInput): CninfoAnnouncement[] {
  const matched = announcements.filter((item) => isChineseAnnualReportBody(item.announcementTitle) && /\.pdf$/i.test(item.adjunctUrl));
  const limit = input.limit === undefined ? matched.length : Math.max(0, input.limit);
  return matched.slice(0, limit);
}

export function isChineseAnnualReportBody(title: string): boolean {
  if (!title.includes("年度报告") && !title.includes("年报")) return false;
  return !/(摘要|取消|英文|english|已取消|更正公告|催告)/i.test(title);
}

export function cninfoPdfUrl(adjunctUrl: string): string {
  return `${CNINFO_STATIC_BASE}${adjunctUrl.replace(/^\/+/, "")}`;
}

export function cninfoAnnouncementTask(announcement: CninfoAnnouncement, input: CninfoCompanyFilingsInput): FetchTask {
  const period = announcement.announcementTimeMs === undefined ? undefined : new Date(announcement.announcementTimeMs).toISOString().slice(0, 10);
  return {
    task_id: `cninfo-annual-${announcement.announcementId ?? announcement.adjunctUrl.replace(/[^\dA-Za-z]/g, "").slice(-16)}`,
    url: cninfoPdfUrl(announcement.adjunctUrl),
    expected_format: "pdf",
    params: {
      stock_code: input.stockCode,
      announcement_title: announcement.announcementTitle,
      ...(announcement.announcementId === undefined ? {} : { announcement_id: announcement.announcementId }),
      ...(announcement.secName === undefined ? {} : { sec_name: announcement.secName }),
      ...(input.entityId === undefined ? {} : { entity_id: input.entityId }),
      ...(input.componentId === undefined ? {} : { component_id: input.componentId }),
      ...(input.scopeKind === undefined ? {} : { scope_kind: input.scopeKind }),
      ...(input.scopeId === undefined ? {} : { scope_id: input.scopeId })
    },
    hint: {
      ...(input.entityId === undefined ? {} : { entity_id: input.entityId }),
      // 中文年报正文进入与 SEC/EDINET 同一套规则抽取（按文档类型判定资格），由 zh profile 产边。
      document_type: "annual_report",
      ...(period === undefined ? {} : { period })
    }
  };
}

export function cninfoAnnouncementTaskMetadata(task: FetchTask): Record<string, unknown> {
  return {
    task_id: task.task_id,
    document_type: "annual_report",
    ...(stringParam(task.params, "stock_code") === undefined ? {} : { cninfo_stock_code: stringParam(task.params, "stock_code") }),
    ...(stringParam(task.params, "announcement_id") === undefined ? {} : { cninfo_announcement_id: stringParam(task.params, "announcement_id") }),
    ...(stringParam(task.params, "announcement_title") === undefined ? {} : { cninfo_announcement_title: stringParam(task.params, "announcement_title") }),
    ...(task.hint?.entity_id === undefined ? {} : { primary_entity_id: task.hint.entity_id }),
    ...(task.hint?.period === undefined ? {} : { source_date: task.hint.period }),
    ...(stringParam(task.params, "component_id") === undefined ? {} : { component_id: stringParam(task.params, "component_id") }),
    ...(stringParam(task.params, "scope_kind") === undefined ? {} : { scope_kind: stringParam(task.params, "scope_kind") }),
    ...(stringParam(task.params, "scope_id") === undefined ? {} : { scope_id: stringParam(task.params, "scope_id") })
  };
}

export async function normalizeCninfoAnnualReport(raw: RawDocument<Uint8Array>): Promise<NormalizedDocument> {
  const primaryEntityId = stringMetadata(raw.metadata, "primary_entity_id");
  const sourceDate = stringMetadata(raw.metadata, "source_date");
  return parsePdf({
    raw,
    documentType: "annual_report",
    layout: true,
    language: "zh",
    ...(primaryEntityId === undefined ? {} : { primaryEntityId }),
    ...(sourceDate === undefined ? {} : { sourceDate })
  });
}

export function validateCninfoInput(input: CninfoCompanyFilingsInput): void {
  if (!/^\d{6}$/.test(input.stockCode)) throw new Error(`cninfo stock code must be 6 digits, got ${input.stockCode}`);
  if (input.exchange !== undefined && input.exchange !== "sse" && input.exchange !== "szse") {
    throw new Error(`Unsupported cninfo exchange: ${input.exchange}`);
  }
  if (input.seDate !== undefined && !/^\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2}$/.test(input.seDate)) {
    throw new Error(`cninfo seDate must use YYYY-MM-DD~YYYY-MM-DD format, got ${input.seDate}`);
  }
  if (input.scopeKind !== undefined && input.scopeKind !== "company" && input.scopeKind !== "component") {
    throw new Error(`Unsupported cninfo scope kind: ${input.scopeKind}`);
  }
}

function parseAnnouncement(value: unknown, index: number): CninfoAnnouncement | undefined {
  const row = requireRecord(value, `cninfo announcements[${index}]`);
  const adjunctUrl = optionalString(row["adjunctUrl"]);
  const announcementTitle = optionalString(row["announcementTitle"]);
  if (adjunctUrl === undefined || announcementTitle === undefined) return undefined;
  const announcementId = optionalString(row["announcementId"]);
  const secCode = optionalString(row["secCode"]);
  const secName = stripHighlight(optionalString(row["secName"]));
  const orgId = optionalString(row["orgId"]);
  const announcementTimeMs = optionalNumber(row["announcementTime"]);
  return {
    announcementTitle: stripHighlight(announcementTitle) ?? announcementTitle,
    adjunctUrl,
    ...(announcementId === undefined ? {} : { announcementId }),
    ...(secCode === undefined ? {} : { secCode }),
    ...(secName === undefined ? {} : { secName }),
    ...(orgId === undefined ? {} : { orgId }),
    ...(announcementTimeMs === undefined ? {} : { announcementTimeMs })
  };
}

// cninfo 在 isHLtitle=true 时会给标题套 <em> 高亮标签，归一化时去掉。
function stripHighlight(value: string | undefined): string | undefined {
  return value?.replace(/<\/?em>/gi, "");
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

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new Error(`${label} must be an object`);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
