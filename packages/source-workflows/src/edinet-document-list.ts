import { Buffer } from "node:buffer";
import { type FetchTask, type NormalizedDocument, type RawDocument } from "@supplystrata/core";
import { urlWithCredentialQueryParam } from "@supplystrata/source-adapter-runtime";
import { normalizeTextDocument } from "@supplystrata/source-normalizers";

export const EDINET_DOCUMENT_LIST_TYPES = [1, 2] as const;

export type EdinetDocumentListType = (typeof EDINET_DOCUMENT_LIST_TYPES)[number];

export interface EdinetDailyFilingsInput {
  date: string;
  listType?: EdinetDocumentListType;
  entityId?: string;
  componentId?: string;
  scopeKind?: "company" | "component";
  scopeId?: string;
  edinetCodes?: readonly string[];
  secCodes?: readonly string[];
  docTypeCodes?: readonly string[];
}

export interface EdinetDocumentListResponse {
  status: string;
  message: string;
  count?: number;
  results: EdinetDocumentEntry[];
}

export interface EdinetDocumentEntry {
  docId: string;
  edinetCode?: string;
  secCode?: string;
  jcn?: string;
  filerName: string;
  docTypeCode?: string;
  docDescription?: string;
  periodStart?: string;
  periodEnd?: string;
  submitDateTime?: string;
  xbrlFlag?: string;
  pdfFlag?: string;
  englishDocFlag?: string;
  csvFlag?: string;
}

export function buildEdinetDocumentsListUrl(input: EdinetDailyFilingsInput, apiKey: string): string {
  validateEdinetDailyFilingsInput(input);
  const url = new URL("https://api.edinet-fsa.go.jp/api/v2/documents.json");
  url.searchParams.set("date", input.date);
  url.searchParams.set("type", String(input.listType ?? 2));
  return urlWithCredentialQueryParam(url.toString(), apiKey, "Subscription-Key", "EDINET");
}

export function extractEdinetDocumentEntries(raw: RawDocument<Uint8Array>): EdinetDocumentEntry[] {
  const filters = filtersFromMetadata(raw.metadata);
  return filterEdinetEntries(parseEdinetDocumentListPayload(raw.body).results, filters);
}

// 给正文 body 适配器复用：在 daily 列表里按 edinet_code / sec_code / doc_type_code 选出目标文档。
export function filterEdinetDocumentEntries(
  entries: readonly EdinetDocumentEntry[],
  filters: { edinetCodes?: readonly string[]; secCodes?: readonly string[]; docTypeCodes?: readonly string[] }
): EdinetDocumentEntry[] {
  return filterEdinetEntries(entries, {
    edinetCodes: filters.edinetCodes ?? [],
    secCodes: filters.secCodes ?? [],
    docTypeCodes: filters.docTypeCodes ?? []
  });
}

export function normalizeEdinetDocumentList(raw: RawDocument<Uint8Array>): NormalizedDocument {
  const payload = parseEdinetDocumentListPayload(raw.body);
  const filters = filtersFromMetadata(raw.metadata);
  const entries = filterEdinetEntries(payload.results, filters);
  const primaryEntityId = stringMetadataValue(raw.metadata["primary_entity_id"]);
  const componentId = stringMetadataValue(raw.metadata["component_id"]);
  const sourceDate = stringMetadataValue(raw.metadata["source_date"]);
  return normalizeTextDocument({
    raw,
    documentType: "company_registry",
    parserVersion: "edinet-document-list-v1",
    text: formatEdinetDocumentList({ ...payload, results: entries }, raw.url, filters),
    ...(primaryEntityId === undefined ? {} : { primaryEntityId }),
    ...(sourceDate === undefined ? {} : { sourceDate }),
    extraMetadata: {
      api_status: payload.status,
      api_message: payload.message,
      matched_document_count: entries.length,
      total_document_count: payload.results.length,
      ...(payload.count === undefined ? {} : { resultset_count: payload.count }),
      ...(componentId === undefined ? {} : { component_id: componentId })
    }
  });
}

export function parseEdinetDocumentListPayload(bytes: Uint8Array): EdinetDocumentListResponse {
  const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  const root = requireRecord(parsed, "EDINET document list response");
  const metadata = requireRecord(root["metadata"], "EDINET metadata");
  const status = requireString(metadata["status"], "EDINET metadata.status");
  const message = requireString(metadata["message"], "EDINET metadata.message");
  const resultset = optionalRecord(metadata["resultset"]);
  const count = optionalNumber(resultset?.["count"]);
  const resultsValue = root["results"];
  const results = Array.isArray(resultsValue) ? resultsValue.map((item, index) => parseEdinetDocumentEntry(item, index)) : [];
  return {
    status,
    message,
    ...(count === undefined ? {} : { count }),
    results
  };
}

export function assertEdinetResponseStatus(payload: EdinetDocumentListResponse, sourceUrl: string): void {
  if (payload.status === "200") return;
  throw new Error(`EDINET API error ${payload.status} for ${sourceUrl}: ${payload.message}`);
}

export function validateEdinetDailyFilingsInput(input: EdinetDailyFilingsInput): void {
  requireIsoDate(input.date, "EDINET date");
  if (input.listType !== undefined && !isEdinetDocumentListType(input.listType)) throw new Error(`Unsupported EDINET documents list type: ${input.listType}`);
  if (input.scopeKind !== undefined && input.scopeKind !== "company" && input.scopeKind !== "component")
    throw new Error(`Unsupported EDINET scope kind: ${input.scopeKind}`);
  for (const code of input.edinetCodes ?? []) requireNonEmptyString(code, "EDINET edinet code");
  for (const code of input.secCodes ?? []) requireNonEmptyString(code, "EDINET securities code");
  for (const code of input.docTypeCodes ?? []) requireNonEmptyString(code, "EDINET document type code");
}

export function edinetDocumentListTaskMetadata(task: FetchTask, payload: EdinetDocumentListResponse): Record<string, unknown> {
  const date = firstSearchParam(task.url, "date");
  const listType = firstSearchParam(task.url, "type");
  if (date === undefined || listType === undefined) throw new Error(`EDINET task URL is missing required parameters for ${task.task_id}`);
  return {
    task_id: task.task_id,
    document_type: "company_registry",
    source_date: date,
    list_type: listType,
    primary_entity_id: task.hint?.entity_id,
    ...paramsMetadata(task.params),
    api_status: payload.status,
    api_message: payload.message,
    total_document_count: payload.results.length,
    ...(payload.count === undefined ? {} : { resultset_count: payload.count })
  };
}

export function isEdinetDocumentListType(value: number): value is EdinetDocumentListType {
  return EDINET_DOCUMENT_LIST_TYPES.some((item) => item === value);
}

function formatEdinetDocumentList(payload: EdinetDocumentListResponse, sourceUrl: string, filters: EdinetDocumentFilters): string {
  const header = [
    `edinet_status: ${payload.status}`,
    `edinet_message: ${payload.message}`,
    payload.count === undefined ? undefined : `resultset_count: ${payload.count}`,
    `matched_document_count: ${payload.results.length}`,
    filters.edinetCodes.length === 0 ? undefined : `edinet_code_filter: ${filters.edinetCodes.join(", ")}`,
    filters.secCodes.length === 0 ? undefined : `sec_code_filter: ${filters.secCodes.join(", ")}`,
    filters.docTypeCodes.length === 0 ? undefined : `doc_type_code_filter: ${filters.docTypeCodes.join(", ")}`,
    `source_url: ${sourceUrl}`
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");

  if (payload.results.length === 0) return `${header}\n\nNo EDINET documents matched this monitor target.`;

  const documents = payload.results
    .map((item) =>
      [
        `doc_id: ${item.docId}`,
        item.edinetCode === undefined ? undefined : `edinet_code: ${item.edinetCode}`,
        item.secCode === undefined ? undefined : `sec_code: ${item.secCode}`,
        item.jcn === undefined ? undefined : `jcn: ${item.jcn}`,
        `filer_name: ${item.filerName}`,
        item.docTypeCode === undefined ? undefined : `doc_type_code: ${item.docTypeCode}`,
        item.docDescription === undefined ? undefined : `doc_description: ${item.docDescription}`,
        item.periodStart === undefined ? undefined : `period_start: ${item.periodStart}`,
        item.periodEnd === undefined ? undefined : `period_end: ${item.periodEnd}`,
        item.submitDateTime === undefined ? undefined : `submit_date_time: ${item.submitDateTime}`,
        item.xbrlFlag === undefined ? undefined : `xbrl_flag: ${item.xbrlFlag}`,
        item.pdfFlag === undefined ? undefined : `pdf_flag: ${item.pdfFlag}`,
        item.englishDocFlag === undefined ? undefined : `english_doc_flag: ${item.englishDocFlag}`,
        item.csvFlag === undefined ? undefined : `csv_flag: ${item.csvFlag}`,
        `document_api_url: ${edinetDocumentDownloadUrl(item.docId)}`
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n")
    )
    .join("\n\n");

  return `${header}\n\n${documents}`;
}

function parseEdinetDocumentEntry(value: unknown, index: number): EdinetDocumentEntry {
  const row = requireRecord(value, `EDINET results[${index}]`);
  const edinetCode = optionalString(row["edinetCode"]);
  const secCode = optionalString(row["secCode"]);
  const jcn = optionalString(row["JCN"]);
  const docTypeCode = optionalString(row["docTypeCode"]);
  const docDescription = optionalString(row["docDescription"]);
  const periodStart = optionalString(row["periodStart"]);
  const periodEnd = optionalString(row["periodEnd"]);
  const submitDateTime = optionalString(row["submitDateTime"]);
  const xbrlFlag = optionalString(row["xbrlFlag"]);
  const pdfFlag = optionalString(row["pdfFlag"]);
  const englishDocFlag = optionalString(row["englishDocFlag"]);
  const csvFlag = optionalString(row["csvFlag"]);
  return {
    docId: requireString(row["docID"], `EDINET results[${index}].docID`),
    ...(edinetCode === undefined ? {} : { edinetCode }),
    ...(secCode === undefined ? {} : { secCode }),
    ...(jcn === undefined ? {} : { jcn }),
    filerName: requireString(row["filerName"], `EDINET results[${index}].filerName`),
    ...(docTypeCode === undefined ? {} : { docTypeCode }),
    ...(docDescription === undefined ? {} : { docDescription }),
    ...(periodStart === undefined ? {} : { periodStart }),
    ...(periodEnd === undefined ? {} : { periodEnd }),
    ...(submitDateTime === undefined ? {} : { submitDateTime }),
    ...(xbrlFlag === undefined ? {} : { xbrlFlag }),
    ...(pdfFlag === undefined ? {} : { pdfFlag }),
    ...(englishDocFlag === undefined ? {} : { englishDocFlag }),
    ...(csvFlag === undefined ? {} : { csvFlag })
  };
}

interface EdinetDocumentFilters {
  edinetCodes: readonly string[];
  secCodes: readonly string[];
  docTypeCodes: readonly string[];
}

function filtersFromMetadata(metadata: Record<string, unknown>): EdinetDocumentFilters {
  return {
    edinetCodes: stringArrayMetadataValue(metadata["edinet_codes"]),
    secCodes: stringArrayMetadataValue(metadata["sec_codes"]),
    docTypeCodes: stringArrayMetadataValue(metadata["doc_type_codes"])
  };
}

function filterEdinetEntries(entries: readonly EdinetDocumentEntry[], filters: EdinetDocumentFilters): EdinetDocumentEntry[] {
  return entries.filter((entry) => {
    if (filters.edinetCodes.length > 0 && (entry.edinetCode === undefined || !filters.edinetCodes.includes(entry.edinetCode))) return false;
    if (filters.secCodes.length > 0 && (entry.secCode === undefined || !filters.secCodes.includes(entry.secCode))) return false;
    if (filters.docTypeCodes.length > 0 && (entry.docTypeCode === undefined || !filters.docTypeCodes.includes(entry.docTypeCode))) return false;
    return true;
  });
}

function paramsMetadata(params: FetchTask["params"]): Record<string, unknown> {
  if (params === undefined) return {};
  return {
    ...(stringParam(params, "component_id") === undefined ? {} : { component_id: stringParam(params, "component_id") }),
    ...(stringParam(params, "scope_kind") === undefined ? {} : { scope_kind: stringParam(params, "scope_kind") }),
    ...(stringParam(params, "scope_id") === undefined ? {} : { scope_id: stringParam(params, "scope_id") }),
    ...(stringArrayParam(params, "edinet_codes") === undefined ? {} : { edinet_codes: stringArrayParam(params, "edinet_codes") }),
    ...(stringArrayParam(params, "sec_codes") === undefined ? {} : { sec_codes: stringArrayParam(params, "sec_codes") }),
    ...(stringArrayParam(params, "doc_type_codes") === undefined ? {} : { doc_type_codes: stringArrayParam(params, "doc_type_codes") })
  };
}

function edinetDocumentDownloadUrl(docId: string): string {
  return `https://api.edinet-fsa.go.jp/api/v2/documents/${encodeURIComponent(docId)}`;
}

function firstSearchParam(url: string, key: string): string | undefined {
  return new URL(url).searchParams.get(key) ?? undefined;
}

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

function stringArrayParam(params: Record<string, unknown>, key: string): string[] | undefined {
  const value = params[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function stringMetadataValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArrayMetadataValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim().length > 0) output.push(item);
  }
  return output;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requireNonEmptyString(value: string, label: string): void {
  if (value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function requireIsoDate(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must use YYYY-MM-DD format`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
