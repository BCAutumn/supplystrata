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
import { EDINET_CREDENTIALS } from "./source-check-credentials.js";
import type { DatabaseStore } from "@supplystrata/db";

const EDINET_DOCUMENT_LIST_TYPES = [1, 2] as const;

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

interface EdinetDocumentListResponse {
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

const edinetAdapterBase: SourceAdapter<EdinetDailyFilingsInput, Uint8Array> = {
  id: "edinet",
  tier: "P1",
  description: "Japan EDINET official daily disclosure list monitor",
  tos_url: "https://disclosure2.edinet-fsa.go.jp/",
  rate_limit: { requests: 2, per_seconds: 1 },
  async *plan(input: EdinetDailyFilingsInput, ctx: AdapterContext): AsyncIterable<FetchTask> {
    validateEdinetDailyFilingsInput(input);
    const apiKey = requireAdapterCredential(ctx, "EDINET_API_KEY", "EDINET");
    yield {
      task_id: `edinet-daily-filings-${input.date}`,
      url: buildEdinetDocumentsListUrl(input, apiKey),
      expected_format: "json",
      params: {
        ...(input.entityId === undefined ? {} : { entity_id: input.entityId }),
        ...(input.componentId === undefined ? {} : { component_id: input.componentId }),
        ...(input.scopeKind === undefined ? {} : { scope_kind: input.scopeKind }),
        ...(input.scopeId === undefined ? {} : { scope_id: input.scopeId }),
        ...(input.edinetCodes === undefined ? {} : { edinet_codes: [...input.edinetCodes] }),
        ...(input.secCodes === undefined ? {} : { sec_codes: [...input.secCodes] }),
        ...(input.docTypeCodes === undefined ? {} : { doc_type_codes: [...input.docTypeCodes] })
      },
      hint: {
        ...(input.entityId === undefined ? {} : { entity_id: input.entityId }),
        // EDINET 第一版只抓官方提交目录。正文 ZIP/PDF 解析后续再接，避免目录项直接触发关系抽取。
        document_type: "company_registry",
        period: input.date
      }
    };
  },
  async fetch(task: FetchTask, ctx: AdapterContext): Promise<RawDocument<Uint8Array>> {
    const body = await fetchBytesWithTimeout(task.url, {
      userAgent: ctx.userAgent,
      timeoutMs: 12_000,
      sourceLabel: "EDINET",
      headers: { Accept: "application/json" }
    });
    const payload = parseEdinetDocumentListPayload(body);
    assertEdinetResponseStatus(payload, task.url);
    const date = firstSearchParam(task.url, "date");
    if (date === undefined) throw new Error(`EDINET task URL is missing date for ${task.task_id}`);
    return persistRawDocumentSnapshot({
      ctx,
      sourceAdapterId: "edinet",
      url: task.url,
      body,
      metadata: taskMetadata(task, payload),
      storageKeyForSha256: (sha256) => `official-disclosure/edinet/${date}/${sha256}.json`
    });
  },
  async normalize(raw: RawDocument<Uint8Array>): Promise<NormalizedDocument> {
    return normalizeEdinetDocumentList(raw);
  }
};

export const edinetAdapter = createRateLimitedSourceAdapter(edinetAdapterBase);

export const edinetDailyFilingsSourceCheckConnector: SourceCheckConnector<DatabaseStore, SourceCheckSummary> = {
  source_adapter_id: "edinet",
  target_kind: "daily-filings",
  config_schema: edinetConfigSchema(),
  credential_requirements: EDINET_CREDENTIALS,
  run(store, target, context) {
    return runSourceAdapterCheck(store, {
      adapter: edinetAdapter,
      adapterInput: edinetDailyFilingsInputFromConfig(target.target_config),
      context: createEdinetAdapterContext(context.adapter_context_input),
      options: {
        checkTargetId: target.check_target_id,
        failureCausedBy: "source-check.edinet",
        ...(context.logger === undefined ? {} : { logger: context.logger })
      }
    });
  }
};

export function createEdinetAdapterContext(input: CreateAdapterContextInput): AdapterContext {
  return createAdapterContext(input);
}

export function buildEdinetDocumentsListUrl(input: EdinetDailyFilingsInput, apiKey: string): string {
  validateEdinetDailyFilingsInput(input);
  const url = new URL("https://api.edinet-fsa.go.jp/api/v2/documents.json");
  url.searchParams.set("date", input.date);
  url.searchParams.set("type", String(input.listType ?? 2));
  url.searchParams.set("Subscription-Key", apiKey);
  return url.toString();
}

export function extractEdinetDocumentEntries(raw: RawDocument<Uint8Array>): EdinetDocumentEntry[] {
  const filters = filtersFromMetadata(raw.metadata);
  return filterEdinetEntries(parseEdinetDocumentListPayload(raw.body).results, filters);
}

function normalizeEdinetDocumentList(raw: RawDocument<Uint8Array>): NormalizedDocument {
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

function taskMetadata(task: FetchTask, payload: EdinetDocumentListResponse): Record<string, unknown> {
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

export function edinetDailyFilingsInputFromConfig(config: Record<string, unknown>): EdinetDailyFilingsInput {
  const label = "EDINET source check target";
  const listType = optionalEdinetDocumentListType(config, label);
  const entityId = optionalConfigString(config, "entity_id", label);
  const componentId = optionalConfigString(config, "component_id", label);
  const scopeKind = optionalScopeKind(config, label);
  const scopeId = optionalConfigString(config, "scope_id", label);
  const edinetCodes = optionalStringArray(config, "edinet_codes", label);
  const secCodes = optionalStringArray(config, "sec_codes", label);
  const docTypeCodes = optionalStringArray(config, "doc_type_codes", label);
  return {
    date: requireIsoDate(requireConfigString(config, "date", label), `${label} date`),
    ...(listType === undefined ? {} : { listType }),
    ...(entityId === undefined ? {} : { entityId }),
    ...(componentId === undefined ? {} : { componentId }),
    ...(scopeKind === undefined ? {} : { scopeKind }),
    ...(scopeId === undefined ? {} : { scopeId }),
    ...(edinetCodes === undefined ? {} : { edinetCodes }),
    ...(secCodes === undefined ? {} : { secCodes }),
    ...(docTypeCodes === undefined ? {} : { docTypeCodes })
  };
}

function edinetConfigSchema(): SourceCheckConfigSchema {
  return {
    fields: [
      { key: "date", type: "string", required: true, description: "EDINET filing date in YYYY-MM-DD format." },
      { key: "type", type: "positive_integer", required: false, description: "EDINET documents list type. Supported values: 1 or 2." },
      { key: "entity_id", type: "string", required: false, description: "Primary SupplyStrata entity id for company-specific EDINET targets." },
      { key: "component_id", type: "string", required: false, description: "Component target id used by readiness and source-target coverage." },
      {
        key: "scope_kind",
        type: "string",
        required: false,
        description: "Research scope kind that requested this EDINET list.",
        allowed_values: ["company", "component"]
      },
      { key: "scope_id", type: "string", required: false, description: "Research scope id that requested this EDINET list." },
      { key: "edinet_codes", type: "string_array", required: false, description: "Optional EDINET filer codes to keep from the daily list." },
      { key: "sec_codes", type: "string_array", required: false, description: "Optional Japanese securities codes to keep from the daily list." },
      { key: "doc_type_codes", type: "string_array", required: false, description: "Optional EDINET document type codes to keep from the daily list." }
    ]
  };
}

function validateEdinetDailyFilingsInput(input: EdinetDailyFilingsInput): void {
  requireIsoDate(input.date, "EDINET date");
  if (input.listType !== undefined && !isEdinetDocumentListType(input.listType)) throw new Error(`Unsupported EDINET documents list type: ${input.listType}`);
  if (input.scopeKind !== undefined && input.scopeKind !== "company" && input.scopeKind !== "component")
    throw new Error(`Unsupported EDINET scope kind: ${input.scopeKind}`);
  for (const code of input.edinetCodes ?? []) requireNonEmptyString(code, "EDINET edinet code");
  for (const code of input.secCodes ?? []) requireNonEmptyString(code, "EDINET securities code");
  for (const code of input.docTypeCodes ?? []) requireNonEmptyString(code, "EDINET document type code");
}

function parseEdinetDocumentListPayload(bytes: Uint8Array): EdinetDocumentListResponse {
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

function assertEdinetResponseStatus(payload: EdinetDocumentListResponse, sourceUrl: string): void {
  if (payload.status === "200") return;
  throw new Error(`EDINET API error ${payload.status} for ${sourceUrl}: ${payload.message}`);
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

function optionalEdinetDocumentListType(config: Record<string, unknown>, label: string): EdinetDocumentListType | undefined {
  const value = optionalConfigPositiveInteger(config, "type", label);
  if (value === undefined) return undefined;
  if (!isEdinetDocumentListType(value)) throw new Error(`${label} type must be 1 or 2`);
  return value;
}

function optionalScopeKind(config: Record<string, unknown>, label: string): "company" | "component" | undefined {
  const value = config["scope_kind"];
  if (value === undefined) return undefined;
  if (value !== "company" && value !== "component") throw new Error(`${label} scope_kind must be company or component`);
  return value;
}

function optionalConfigString(config: Record<string, unknown>, key: string, label: string): string | undefined {
  const value = config[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} ${key} must be a non-empty string`);
  return value;
}

function optionalStringArray(config: Record<string, unknown>, key: string, label: string): string[] | undefined {
  if (config[key] === undefined) return undefined;
  return [...new Set(requireConfigStringArray(config, key, label))];
}

function requireIsoDate(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must use YYYY-MM-DD format`);
  return value;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEdinetDocumentListType(value: number): value is EdinetDocumentListType {
  return EDINET_DOCUMENT_LIST_TYPES.some((item) => item === value);
}
