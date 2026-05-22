import { Buffer } from "node:buffer";
import { type FetchTask, type NormalizedDocument, type RawDocument } from "@supplystrata/core";
import {
  createAdapterContext,
  createRateLimitedSourceAdapter,
  fetchBytesWithTimeout,
  persistRawDocumentSnapshot,
  requireAdapterCredential,
  type AdapterContext,
  type CreateAdapterContextInput,
  type SourceAdapter
} from "@supplystrata/source-adapter-runtime";
import { normalizeTextDocument } from "@supplystrata/source-normalizers";
import {
  optionalConfigPositiveInteger,
  requireConfigString,
  requireConfigStringArray,
  type SourceCheckConfigSchema,
  type SourceCheckConnector
} from "@supplystrata/source-connectors";
import { runSourceAdapterCheck, type SourceCheckSummary } from "./source-check-runner.js";
import { OPENDART_CREDENTIALS } from "./source-check-credentials.js";
import { sourceWorkflowAdapterContextInputFromEnv } from "./adapter-context.js";
import type { DatabaseStore } from "@supplystrata/db";

const DART_DISCLOSURE_TYPES = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] as const;
const DART_CORP_CLASSES = ["Y", "K", "N", "E"] as const;
const DART_FINAL_REPORT_FLAGS = ["Y", "N"] as const;

export type DartKrDisclosureType = (typeof DART_DISCLOSURE_TYPES)[number];
export type DartKrCorpClass = (typeof DART_CORP_CLASSES)[number];
export type DartKrFinalReportsOnly = (typeof DART_FINAL_REPORT_FLAGS)[number];

export interface DartKrCompanyFilingsInput {
  entityId: string;
  corpCode: string;
  year: number;
  disclosureTypes: readonly DartKrDisclosureType[];
  corpClass?: DartKrCorpClass;
  finalReportsOnly?: DartKrFinalReportsOnly;
  limit?: number;
}

interface DartKrDisclosureListResponse {
  status: string;
  message: string;
  pageNo?: number;
  pageCount?: number;
  totalCount?: number;
  totalPage?: number;
  disclosureType?: DartKrDisclosureType;
  list: DartKrDisclosureEntry[];
}

export interface DartKrDisclosureEntry {
  corpClass?: DartKrCorpClass;
  corpName: string;
  corpCode: string;
  stockCode?: string;
  reportName: string;
  receiptNumber: string;
  filerName?: string;
  receiptDate: string;
  note?: string;
}

const dartKrAdapterBase: SourceAdapter<DartKrCompanyFilingsInput, Uint8Array> = {
  id: "dart-kr",
  tier: "P1",
  description: "OpenDART official disclosure list monitor for Korean listed companies",
  tos_url: "https://opendart.fss.or.kr/",
  rate_limit: { requests: 2, per_seconds: 1 },
  async *plan(input: DartKrCompanyFilingsInput, ctx: AdapterContext): AsyncIterable<FetchTask> {
    validateDartKrCompanyFilingsInput(input);
    const apiKey = requireAdapterCredential(ctx, "OPENDART_API_KEY", "OpenDART");
    for (const disclosureType of dedupeDisclosureTypes(input.disclosureTypes)) {
      yield {
        task_id: `dart-kr-${input.corpCode}-${input.year}-${disclosureType}`,
        url: buildDartKrDisclosureListUrl(input, disclosureType, apiKey),
        expected_format: "json",
        hint: {
          entity_id: input.entityId,
          // 这里抓的是监管披露目录元数据，不是正文解析结果；先按 company_registry 落地，避免误触发关系抽取。
          document_type: "company_registry",
          period: `${input.year}-12-31`
        }
      };
    }
  },
  async fetch(task: FetchTask, ctx: AdapterContext): Promise<RawDocument<Uint8Array>> {
    const body = await fetchBytesWithTimeout(task.url, {
      userAgent: ctx.userAgent,
      timeoutMs: 12_000,
      sourceLabel: "OpenDART",
      headers: { Accept: "application/json" }
    });
    const payload = parseDartKrDisclosureListPayload(body);
    assertDartKrResponseStatus(payload, task.url);
    const metadata = taskMetadata(task, payload);
    const corpCode = stringMetadataValue(metadata["corp_code"]);
    const year = stringMetadataValue(metadata["source_year"]);
    const disclosureType = stringMetadataValue(metadata["disclosure_type"]);
    if (corpCode === undefined || year === undefined || disclosureType === undefined) {
      throw new Error(`OpenDART task metadata is missing required routing keys for ${task.task_id}`);
    }
    return persistRawDocumentSnapshot({
      ctx,
      sourceAdapterId: "dart-kr",
      url: task.url,
      body,
      metadata,
      storageKeyForSha256: (sha256) => `official-disclosure/dart-kr/${corpCode}/${year}/${disclosureType}/${sha256}.json`
    });
  },
  async normalize(raw: RawDocument<Uint8Array>): Promise<NormalizedDocument> {
    return normalizeDartKrDisclosureListDocument(raw);
  }
};

export const dartKrAdapter = createRateLimitedSourceAdapter(dartKrAdapterBase);

export const dartKrCompanyFilingsSourceCheckConnector: SourceCheckConnector<DatabaseStore, SourceCheckSummary> = {
  source_adapter_id: "dart-kr",
  target_kind: "company-filings",
  config_schema: dartKrConfigSchema(),
  credential_requirements: OPENDART_CREDENTIALS,
  run(store, target, context) {
    return runSourceAdapterCheck(store, {
      adapter: dartKrAdapter,
      adapterInput: dartKrCompanyFilingsInputFromConfig(target.target_config),
      context: createDartKrAdapterContext(context.adapter_context_input),
      options: {
        checkTargetId: target.check_target_id,
        failureCausedBy: "source-check.dart-kr",
        ...(context.logger === undefined ? {} : { logger: context.logger })
      }
    });
  }
};

export function createDartKrAdapterContext(input: CreateAdapterContextInput = sourceWorkflowAdapterContextInputFromEnv()): AdapterContext {
  return createAdapterContext(input);
}

export function buildDartKrDisclosureListUrl(input: DartKrCompanyFilingsInput, disclosureType: DartKrDisclosureType, apiKey: string): string {
  validateDartKrCompanyFilingsInput(input);
  const url = new URL("https://engopendart.fss.or.kr/engapi/list.json");
  url.searchParams.set("crtfc_key", apiKey);
  url.searchParams.set("corp_code", input.corpCode);
  url.searchParams.set("bgn_de", `${input.year}0101`);
  url.searchParams.set("end_de", `${input.year}1231`);
  url.searchParams.set("pblntf_ty", disclosureType);
  url.searchParams.set("sort", "date");
  url.searchParams.set("sort_mth", "desc");
  url.searchParams.set("page_no", "1");
  url.searchParams.set("page_count", String(clampLimit(input.limit)));
  url.searchParams.set("last_reprt_at", input.finalReportsOnly ?? "Y");
  if (input.corpClass !== undefined) url.searchParams.set("corp_cls", input.corpClass);
  return url.toString();
}

export function extractDartKrDisclosureEntries(raw: RawDocument<Uint8Array>): DartKrDisclosureEntry[] {
  return parseDartKrDisclosureListPayload(raw.body).list;
}

function normalizeDartKrDisclosureListDocument(raw: RawDocument<Uint8Array>): NormalizedDocument {
  const payload = parseDartKrDisclosureListPayload(raw.body);
  const primaryEntityId = stringMetadataValue(raw.metadata["primary_entity_id"]);
  const disclosureType = stringMetadataValue(raw.metadata["disclosure_type"]);
  const sourceDate = latestReceiptDate(payload.list) ?? stringMetadataValue(raw.metadata["source_date"]);
  return normalizeTextDocument({
    raw,
    documentType: "company_registry",
    parserVersion: "dart-kr-disclosure-list-v1",
    text: formatDartKrDisclosureList(payload, raw.url),
    ...(primaryEntityId === undefined ? {} : { primaryEntityId }),
    ...(sourceDate === undefined ? {} : { sourceDate }),
    extraMetadata: {
      api_status: payload.status,
      api_message: payload.message,
      disclosure_type: disclosureType ?? "unknown",
      filing_count: payload.list.length,
      ...(payload.totalCount === undefined ? {} : { total_count: payload.totalCount }),
      ...(payload.pageCount === undefined ? {} : { page_count: payload.pageCount }),
      ...(payload.pageNo === undefined ? {} : { page_no: payload.pageNo })
    }
  });
}

function formatDartKrDisclosureList(payload: DartKrDisclosureListResponse, sourceUrl: string): string {
  const header = [
    `opendart_status: ${payload.status}`,
    `opendart_message: ${payload.message}`,
    payload.disclosureType === undefined ? undefined : `disclosure_type: ${payload.disclosureType}`,
    payload.totalCount === undefined ? undefined : `total_count: ${payload.totalCount}`,
    `source_url: ${sourceUrl}`
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");

  if (payload.list.length === 0) return `${header}\n\nNo disclosures were returned for this OpenDART monitor target.`;

  const filings = payload.list
    .map((item) =>
      [
        `corp_name: ${item.corpName}`,
        `corp_code: ${item.corpCode}`,
        item.stockCode === undefined ? undefined : `stock_code: ${item.stockCode}`,
        item.corpClass === undefined ? undefined : `corp_cls: ${item.corpClass}`,
        `report_name: ${item.reportName}`,
        `receipt_number: ${item.receiptNumber}`,
        `receipt_date: ${item.receiptDate}`,
        item.filerName === undefined ? undefined : `filer_name: ${item.filerName}`,
        item.note === undefined ? undefined : `note: ${item.note}`,
        `viewer_url: ${dartDisclosureViewerUrl(item.receiptNumber)}`
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n")
    )
    .join("\n\n");

  return `${header}\n\n${filings}`;
}

function taskMetadata(task: FetchTask, payload: DartKrDisclosureListResponse): Record<string, unknown> {
  const period = task.hint?.period ?? "unknown";
  const sourceDate = latestReceiptDate(payload.list) ?? period;
  return {
    task_id: task.task_id,
    document_type: "company_registry",
    primary_entity_id: task.hint?.entity_id,
    source_date: sourceDate,
    source_year: period.slice(0, 4),
    corp_code: firstSearchParam(task.url, "corp_code"),
    disclosure_type: firstSearchParam(task.url, "pblntf_ty"),
    last_reprt_at: firstSearchParam(task.url, "last_reprt_at"),
    ...(firstSearchParam(task.url, "corp_cls") === undefined ? {} : { corp_cls: firstSearchParam(task.url, "corp_cls") }),
    api_status: payload.status,
    api_message: payload.message,
    filing_count: payload.list.length,
    ...(payload.totalCount === undefined ? {} : { total_count: payload.totalCount })
  };
}

export function dartKrCompanyFilingsInputFromConfig(config: Record<string, unknown>): DartKrCompanyFilingsInput {
  const label = "OpenDART source check target";
  const year = optionalConfigPositiveInteger(config, "year", label);
  if (year === undefined || year < 2000 || year > 2100) throw new Error(`${label} year must be a supported disclosure year`);
  const corpClass = optionalDartCorpClass(config, label);
  const finalReportsOnly = optionalDartFinalReportsOnly(config, label);
  const limit = optionalConfigPositiveInteger(config, "limit", label);
  return {
    entityId: requireConfigString(config, "entity_id", label),
    corpCode: requireDartCorpCode(config, label),
    year,
    disclosureTypes: requireDartDisclosureTypes(config, label),
    ...(corpClass === undefined ? {} : { corpClass }),
    ...(finalReportsOnly === undefined ? {} : { finalReportsOnly }),
    ...(limit === undefined ? {} : { limit })
  };
}

function dartKrConfigSchema(): SourceCheckConfigSchema {
  return {
    fields: [
      { key: "corp_code", type: "string", required: true, description: "OpenDART corporation code (8 digits)." },
      { key: "entity_id", type: "string", required: true, description: "Primary SupplyStrata entity id for the filer." },
      {
        key: "disclosure_types",
        type: "string_array",
        required: true,
        description: "OpenDART disclosure type groups to monitor.",
        allowed_values: DART_DISCLOSURE_TYPES
      },
      { key: "year", type: "positive_integer", required: true, description: "Disclosure year to monitor." },
      { key: "corp_cls", type: "string", required: false, description: "Optional DART corporation class filter.", allowed_values: DART_CORP_CLASSES },
      {
        key: "final_reports_only",
        type: "string",
        required: false,
        description: "Whether to include only final reports (Y/N).",
        allowed_values: DART_FINAL_REPORT_FLAGS
      },
      { key: "limit", type: "positive_integer", required: false, description: "Maximum disclosures to keep per disclosure type (1-100)." }
    ]
  };
}

function validateDartKrCompanyFilingsInput(input: DartKrCompanyFilingsInput): void {
  if (!/^\d{8}$/.test(input.corpCode)) throw new Error(`OpenDART corpCode must be 8 digits: ${input.corpCode}`);
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) throw new Error(`OpenDART year is outside supported range: ${input.year}`);
  if (input.entityId.trim().length === 0) throw new Error("OpenDART entityId must not be empty");
  if (dedupeDisclosureTypes(input.disclosureTypes).length === 0) throw new Error("OpenDART disclosureTypes must not be empty");
  if (input.corpClass !== undefined && !isDartCorpClass(input.corpClass)) throw new Error(`Unsupported OpenDART corp class: ${input.corpClass}`);
  if (input.finalReportsOnly !== undefined && !isDartFinalReportsOnly(input.finalReportsOnly)) {
    throw new Error(`Unsupported OpenDART finalReportsOnly flag: ${input.finalReportsOnly}`);
  }
  if (input.limit !== undefined && (input.limit < 1 || input.limit > 100)) throw new Error(`OpenDART limit must be between 1 and 100: ${input.limit}`);
}

function parseDartKrDisclosureListPayload(bytes: Uint8Array): DartKrDisclosureListResponse {
  const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  const root = requireRecord(parsed, "OpenDART disclosure list response");
  const status = requireString(root["status"], "OpenDART disclosure list status");
  const message = requireString(root["message"], "OpenDART disclosure list message");
  const disclosureType = optionalDartDisclosureType(firstRecordString(root["list"], "pblntf_ty"));
  const pageNo = optionalNumber(root["page_no"]);
  const pageCount = optionalNumber(root["page_count"]);
  const totalCount = optionalNumber(root["total_count"]);
  const totalPage = optionalNumber(root["total_page"]);
  const listValue = root["list"];
  if (listValue === undefined) {
    return {
      status,
      message,
      ...(pageNo === undefined ? {} : { pageNo }),
      ...(pageCount === undefined ? {} : { pageCount }),
      ...(totalCount === undefined ? {} : { totalCount }),
      ...(totalPage === undefined ? {} : { totalPage }),
      ...(disclosureType === undefined ? {} : { disclosureType }),
      list: []
    };
  }
  if (!Array.isArray(listValue)) throw new Error("OpenDART disclosure list must be an array");
  return {
    status,
    message,
    ...(pageNo === undefined ? {} : { pageNo }),
    ...(pageCount === undefined ? {} : { pageCount }),
    ...(totalCount === undefined ? {} : { totalCount }),
    ...(totalPage === undefined ? {} : { totalPage }),
    ...(disclosureType === undefined ? {} : { disclosureType }),
    list: listValue.map((item, index) => parseDartKrDisclosureEntry(item, index))
  };
}

function parseDartKrDisclosureEntry(value: unknown, index: number): DartKrDisclosureEntry {
  const row = requireRecord(value, `OpenDART disclosure list[${index}]`);
  const corpClass = parseOptionalDartCorpClass(row["corp_cls"]);
  const stockCode = optionalString(row["stock_code"]);
  const filerName = optionalString(row["flr_nm"]);
  const note = optionalString(row["rm"]);
  return {
    ...(corpClass === undefined ? {} : { corpClass }),
    corpName: requireString(row["corp_name"], `OpenDART disclosure list[${index}].corp_name`),
    corpCode: requireString(row["corp_code"], `OpenDART disclosure list[${index}].corp_code`),
    ...(stockCode === undefined ? {} : { stockCode }),
    reportName: requireString(row["report_nm"], `OpenDART disclosure list[${index}].report_nm`),
    receiptNumber: requireString(row["rcept_no"], `OpenDART disclosure list[${index}].rcept_no`),
    ...(filerName === undefined ? {} : { filerName }),
    receiptDate: normalizeReceiptDate(requireString(row["rcept_dt"], `OpenDART disclosure list[${index}].rcept_dt`)),
    ...(note === undefined ? {} : { note })
  };
}

function assertDartKrResponseStatus(payload: DartKrDisclosureListResponse, sourceUrl: string): void {
  if (payload.status === "000" || payload.status === "013") return;
  throw new Error(`OpenDART API error ${payload.status} for ${sourceUrl}: ${payload.message}`);
}

function requireDartCorpCode(config: Record<string, unknown>, label: string): string {
  const corpCode = requireConfigString(config, "corp_code", label);
  if (!/^\d{8}$/.test(corpCode)) throw new Error(`${label} corp_code must be 8 digits`);
  return corpCode;
}

function requireDartDisclosureTypes(config: Record<string, unknown>, label: string): DartKrDisclosureType[] {
  const types: DartKrDisclosureType[] = [];
  for (const item of requireConfigStringArray(config, "disclosure_types", label)) {
    if (!isDartDisclosureType(item)) throw new Error(`Unsupported OpenDART disclosure type: ${item}`);
    types.push(item);
  }
  return dedupeDisclosureTypes(types);
}

function optionalDartCorpClass(config: Record<string, unknown>, label: string): DartKrCorpClass | undefined {
  const value = config["corp_cls"];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !isDartCorpClass(value)) throw new Error(`${label} corp_cls must be one of: ${DART_CORP_CLASSES.join(", ")}`);
  return value;
}

function optionalDartFinalReportsOnly(config: Record<string, unknown>, label: string): DartKrFinalReportsOnly | undefined {
  const value = config["final_reports_only"];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !isDartFinalReportsOnly(value)) {
    throw new Error(`${label} final_reports_only must be one of: ${DART_FINAL_REPORT_FLAGS.join(", ")}`);
  }
  return value;
}

function dedupeDisclosureTypes(types: readonly DartKrDisclosureType[]): DartKrDisclosureType[] {
  return [...new Set(types)];
}

function clampLimit(value: number | undefined): number {
  if (value === undefined) return 20;
  return Math.max(1, Math.min(100, value));
}

function dartDisclosureViewerUrl(receiptNumber: string): string {
  return `https://englishdart.fss.or.kr/dsbh001/main.do?rcpNo=${encodeURIComponent(receiptNumber)}`;
}

function latestReceiptDate(items: readonly DartKrDisclosureEntry[]): string | undefined {
  const latest = items
    .map((item) => item.receiptDate)
    .sort()
    .at(-1);
  return latest;
}

function firstSearchParam(url: string, key: string): string | undefined {
  return new URL(url).searchParams.get(key) ?? undefined;
}

function normalizeReceiptDate(value: string): string {
  if (!/^\d{8}$/.test(value)) return value;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function firstRecordString(value: unknown, key: string): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const first: unknown = value[0];
  if (!isRecord(first)) return undefined;
  return optionalString(first[key]);
}

function stringMetadataValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDartDisclosureType(value: string): value is DartKrDisclosureType {
  return DART_DISCLOSURE_TYPES.some((item) => item === value);
}

function optionalDartDisclosureType(value: string | undefined): DartKrDisclosureType | undefined {
  return value !== undefined && isDartDisclosureType(value) ? value : undefined;
}

function isDartCorpClass(value: string): value is DartKrCorpClass {
  return DART_CORP_CLASSES.some((item) => item === value);
}

function parseOptionalDartCorpClass(value: unknown): DartKrCorpClass | undefined {
  return typeof value === "string" && isDartCorpClass(value) ? value : undefined;
}

function isDartFinalReportsOnly(value: string): value is DartKrFinalReportsOnly {
  return DART_FINAL_REPORT_FLAGS.some((item) => item === value);
}
